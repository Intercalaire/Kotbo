import { errorMessage } from '../../utils/errors.js';
import { Client, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, type ButtonInteraction, type ColorResolvable, type Message } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { resolveEmojiShortcodes } from '../../utils/emojis.js';
import { isStaffServerGuild } from '../staff/staffServerService.js';
import { isModuleEnabled } from '../core/moduleGate.js';

// Cooldown map to prevent spamming/double clicks on the join button
const joinCooldowns = new Map<string, number>();

/**
 * Données minimales d'un giveaway nécessaires pour reconstruire son embed.
 * On reconstruit toujours l'embed à partir de la BDD car les messages sont
 * envoyés en Components V2 (voir utils/patchV2.ts) : `message.embeds` est vide,
 * donc on ne peut pas relire l'embed d'origine sur le message pour l'éditer.
 */
interface GiveawayEmbedData {
  id: string;
  prize: string;
  description?: string | null;
  winnerCount: number;
  endsAt: Date;
  rpgXp?: number | null;
  rpgCoins?: number | null;
  rpgItemId?: string | null;
  needValidation?: boolean | null;
}

function buildGiveawayBonusInfo(giveaway: GiveawayEmbedData): string {
  let info = '';
  if ((giveaway.rpgCoins ?? 0) > 0) info += `\n🪙 **Pièces :** +${giveaway.rpgCoins}`;
  if ((giveaway.rpgXp ?? 0) > 0) info += `\n✨ **XP RPG :** +${giveaway.rpgXp}`;
  if (giveaway.rpgItemId) info += `\n📦 **Objet :** ${giveaway.rpgItemId}`;
  if (giveaway.needValidation) info += `\n⚠️ *Validation du staff requise*`;
  return info;
}

/** Embed d'un giveaway toujours en cours (création + inscriptions). */
function buildActiveGiveawayEmbed(giveaway: GiveawayEmbedData, participantCount: number): EmbedBuilder {
  const endsSec = Math.floor(giveaway.endsAt.getTime() / 1000);
  const bonus = buildGiveawayBonusInfo(giveaway);
  const description = `${giveaway.description ? `${giveaway.description}\n\n` : ''}` +
    `Cliquez sur le bouton ci-dessous pour participer !\n` +
    (bonus ? `\n**Récompenses bonus :**${bonus}\n` : '') +
    `\n**Fin :** <t:${endsSec}:R> (<t:${endsSec}:f>)\n` +
    `**Nombre de gagnants :** ${giveaway.winnerCount}\n` +
    `**Participants :** ${participantCount}`;
  return buildGiveawayEmbed(giveaway, description, '#5865F2');
}

/**
 * Ligne du bouton « Rejoindre » d'un giveaway actif.
 * En Components V2, les boutons vivent dans `components` au même titre que
 * l'embed : toute édition qui ne les repasse pas les efface. Il faut donc les
 * réinjecter à chaque `message.edit`.
 */
function buildGiveawayJoinRow(giveawayId: string): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(`giveaway_join:${giveawayId}`)
    .setEmoji('🎉')
    .setLabel('Rejoindre')
    .setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

/** Embed d'un giveaway dans un état terminé/validé (description & couleur fournies). */
function buildGiveawayEmbed(
  giveaway: GiveawayEmbedData,
  description: string,
  color: ColorResolvable
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(resolveEmojiShortcodes(`🎉 GIVEAWAY : ${giveaway.prize} 🎉`))
    .setDescription(resolveEmojiShortcodes(description))
    .setColor(color)
    .setFooter({ text: `ID : ${giveaway.id}` })
    .setTimestamp();
}

/**
 * Crée un nouveau giveaway sur Discord et en BDD
 */
export async function createGiveaway(
  client: Client,
  guildId: string,
  channelId: string,
  prize: string,
  winnerCount: number,
  durationMinutes: number,
  description?: string,
  rpgXp = 0,
  rpgCoins = 0,
  rpgItemId: string | null = null,
  needValidation = false
) {
  if (await isStaffServerGuild(guildId)) {
    throw new Error('Les giveaways ne sont pas disponibles sur un serveur staff.');
  }

  const cleanPrize = prize.trim();
  const cleanDescription = description?.trim() || undefined;
  if (!cleanPrize || cleanPrize.length > 200) {
    throw new Error('Le lot doit contenir entre 1 et 200 caractères.');
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) {
    throw new Error('Le nombre de gagnants doit être compris entre 1 et 20.');
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 525_600) {
    throw new Error('La durée doit être comprise entre 1 minute et 1 an.');
  }
  if (cleanDescription && cleanDescription.length > 2_000) {
    throw new Error('La description ne peut pas dépasser 2 000 caractères.');
  }

  const discordGuild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!discordGuild) {
    throw new Error('Serveur Discord introuvable.');
  }

  const channel = discordGuild.channels.cache.get(channelId)
    || await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error('Le salon sélectionné est introuvable ou le bot ne peut pas y envoyer de message.');
  }

  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  // 1. Sauvegarder dans la BDD pour générer l'ID
  const giveaway = await prisma.giveaway.create({
    data: {
      guildId,
      channelId,
      prize: cleanPrize,
      winnerCount,
      endsAt,
      description: cleanDescription,
      rpgXp,
      rpgCoins,
      rpgItemId,
      needValidation,
      validationStatus: needValidation ? 'PENDING' : 'APPROVED'
    },
  });

  // 2. Créer l'embed et le message Discord
  const embed = buildActiveGiveawayEmbed(giveaway, 0);
  const row = buildGiveawayJoinRow(giveaway.id);

  let publishedMessage: Message | null = null;
  try {
    publishedMessage = await channel.send({ embeds: [embed], components: [row] });
    // Mettre à jour avec le messageId
    await prisma.giveaway.update({
      where: { id: giveaway.id },
      data: { messageId: publishedMessage.id },
    });
  } catch (error) {
    // Ne pas conserver un concours impossible à rejoindre dans le dashboard.
    await publishedMessage?.delete().catch(() => undefined);
    await prisma.giveaway.delete({ where: { id: giveaway.id } }).catch(() => undefined);
    throw new Error(`Impossible de publier le giveaway : ${errorMessage(error)}`);
  }

  return giveaway;
}

/**
 * Gère l'action de clic sur le bouton d'inscription d'un giveaway
 */
export async function handleGiveawayJoin(interaction: ButtonInteraction) {
  const giveawayId = interaction.customId.split(':')[1];
  const userId = interaction.user.id;

  // Anti-double-clic / Anti-spam : Cooldown de 2 secondes par utilisateur et par giveaway
  const cooldownKey = `${userId}:${giveawayId}`;
  const now = Date.now();
  const lastClick = joinCooldowns.get(cooldownKey);

  if (lastClick && now - lastClick < 2000) {
    return interaction.reply({
      content: '⚠️ Veuillez patienter 2 secondes entre chaque clic.',
      flags: [MessageFlags.Ephemeral],
    });
  }
  joinCooldowns.set(cooldownKey, now);

  // Nettoyage automatique du cooldown après 2 secondes
  setTimeout(() => {
    if (joinCooldowns.get(cooldownKey) === now) {
      joinCooldowns.delete(cooldownKey);
    }
  }, 2000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verrouiller la ligne du giveaway pour bloquer les écritures/lectures concurrentes
      await tx.$queryRaw`SELECT 1 FROM giveaways WHERE id = ${giveawayId} FOR UPDATE`;

      // 2. Récupérer les données verrouillées et fraîches
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
      });

      if (!giveaway || giveaway.ended) {
        throw new Error('ENDED_OR_NOT_FOUND');
      }

      const isParticipant = giveaway.participants.includes(userId);
      let updatedParticipants = [...giveaway.participants];
      let responseText = '';

      if (isParticipant) {
        // Se désinscrire
        updatedParticipants = updatedParticipants.filter(id => id !== userId);
        responseText = '😢 Vous vous êtes retiré du giveaway.';
      } else {
        // S'inscrire
        updatedParticipants.push(userId);
        responseText = '🎉 Inscription validée ! Bonne chance !';
      }

      await tx.giveaway.update({
        where: { id: giveawayId },
        data: { participants: updatedParticipants },
      });

      return {
        responseText,
        updatedParticipants,
        giveaway,
      };
    });

    const { responseText, updatedParticipants, giveaway } = result;

    // 4. Mettre à jour l'embed Discord en temps réel
    if (giveaway.messageId) {
      const channel = interaction.channel;
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (message) {
          const updatedEmbed = buildActiveGiveawayEmbed(giveaway, updatedParticipants.length);
          // On repasse le bouton « Rejoindre » : en Components V2 une édition qui
          // ne fournit pas `components` efface les boutons du message.
          await message.edit({
            embeds: [updatedEmbed],
            components: [buildGiveawayJoinRow(giveaway.id)],
          }).catch(() => null);
        }
      }
    }

    return interaction.reply({
      content: responseText,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (err: unknown) {
    if (errorMessage(err) === 'ENDED_OR_NOT_FOUND') {
      return interaction.reply({
        content: '❌ Ce giveaway est terminé !',
        flags: [MessageFlags.Ephemeral],
      });
    }
    logger.error('GiveawayService', 'Erreur lors de handleGiveawayJoin :', err);
    return interaction.reply({
      content: '❌ Une erreur est survenue lors de votre inscription.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

/**
 * Retire un membre de tous les giveaways en cours d'un serveur.
 *
 * Appele quand il quitte le serveur : sans cela il reste dans le tirage et
 * peut gagner un lot qu'il ne pourra pas recevoir, au detriment des membres
 * encore presents.
 *
 * Le verrou de ligne reprend celui de `handleGiveawayJoin` : une inscription
 * simultanee ne doit pas ecraser le retrait, ni l'inverse.
 */
export async function removeMemberFromActiveGiveaways(
  client: Client,
  guildId: string,
  userId: string,
): Promise<number> {
  const affected = await prisma.giveaway.findMany({
    where: { guildId, ended: false, participants: { has: userId } },
    select: { id: true },
  });
  if (affected.length === 0) return 0;

  let removedCount = 0;

  for (const { id } of affected) {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM giveaways WHERE id = ${id} FOR UPDATE`;

        const giveaway = await tx.giveaway.findUnique({ where: { id } });
        // Le giveaway a pu se terminer, ou le membre en sortir, entre la
        // selection et la prise du verrou.
        if (!giveaway || giveaway.ended || !giveaway.participants.includes(userId)) return null;

        const participants = giveaway.participants.filter((participantId) => participantId !== userId);
        await tx.giveaway.update({ where: { id }, data: { participants } });

        return { giveaway, participants };
      });

      if (!updated) continue;
      removedCount += 1;

      // L'embed affiche le nombre de participants : le laisser tel quel
      // afficherait un compteur faux jusqu'au prochain clic.
      const { giveaway, participants } = updated;
      if (!giveaway.messageId) continue;

      const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (!message) continue;

      await message.edit({
        embeds: [buildActiveGiveawayEmbed(giveaway, participants.length)],
        // En Components V2, une edition sans `components` efface les boutons.
        components: [buildGiveawayJoinRow(giveaway.id)],
      }).catch(() => null);
    } catch (err) {
      logger.error(
        'GiveawayService',
        `Impossible de retirer ${userId} du giveaway ${id} :`,
        err,
      );
    }
  }

  return removedCount;
}

/**
 * Termine un giveaway actif et tire les gagnants
 */
export async function endGiveaway(client: Client, giveawayId: string, expectedGuildId?: string) {
  const giveaway = await prisma.giveaway.findFirst({
    where: { id: giveawayId, ...(expectedGuildId ? { guildId: expectedGuildId } : {}) },
  });

  if (!giveaway && expectedGuildId) {
    throw new Error('Giveaway introuvable sur ce serveur.');
  }
  if (!giveaway || giveaway.ended) return;

  const discordGuild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
  if (!discordGuild) return;

  const channel = discordGuild.channels.cache.get(giveaway.channelId)
    || await discordGuild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  // Tirer les gagnants avec pondération de clan
  const winners = await drawWinnersWeighted(giveaway.guildId, giveaway.participants, giveaway.winnerCount, channel);

  const winnersMentions = winners.length > 0 ? winners.map(w => `<@${w}>`).join(', ') : 'Aucun participant.';

  if (giveaway.needValidation) {
    // On marque le giveaway comme terminé AVANT toute opération Discord : la
    // transition d'état doit avoir lieu même si le message n'est plus
    // récupérable, sinon le cron le reclôturerait en boucle chaque minute.
    await prisma.giveaway.update({
      where: { id: giveawayId },
      data: {
        ended: true,
        validationStatus: 'PENDING',
        pendingWinners: winners,
      },
    });

    // Mise à jour du message d'origine (best-effort)
    if (giveaway.messageId) {
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (message) {
        const endedEmbed = buildGiveawayEmbed(
          giveaway,
          `${giveaway.description ? `${giveaway.description}\n\n` : ''}**Gagnants Tirés (En attente de validation) :** ${winnersMentions}\n**Participants :** ${giveaway.participants.length}`,
          '#FAA81A'
        );

        const approveBtn = new ButtonBuilder()
          .setCustomId(`giveaway_val_approve:${giveaway.id}`)
          .setLabel('Valider les gagnants ✅')
          .setStyle(ButtonStyle.Success);

        const rerollBtn = new ButtonBuilder()
          .setCustomId(`giveaway_val_reroll:${giveaway.id}`)
          .setLabel('Relancer (Reroll) 🎲')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rerollBtn);
        await message.edit({ embeds: [endedEmbed], components: [row] }).catch(() => null);
      }
    }

    await channel.send(`⏳ **Le giveaway pour **${giveaway.prize}** (ID: \`${giveaway.id}\`) s'est terminé !** Gagnants tirés : ${winnersMentions}. En attente de validation par un administrateur.`).catch(() => null);
    return;
  }

  // Pas de validation requise, gain direct : on fige l'état et on distribue
  // exactement une fois, indépendamment de la disponibilité du message.
  await prisma.giveaway.update({
    where: { id: giveawayId },
    data: {
      ended: true,
      validationStatus: 'APPROVED',
      winners,
    },
  });

  await distributeGiveawayPrizes(giveaway, winners).catch((err) => {
    logger.error('GiveawayService', 'Error distributing prizes in endGiveaway:', err);
  });

  // Mise à jour du message d'origine (best-effort)
  if (giveaway.messageId) {
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message) {
      const endedEmbed = buildGiveawayEmbed(
        giveaway,
        `${giveaway.description ? `${giveaway.description}\n\n` : ''}**Gagnants :** ${winnersMentions}\n**Participants :** ${giveaway.participants.length}`,
        '#ED4245'
      );

      const disabledButton = new ButtonBuilder()
        .setCustomId(`giveaway_ended:${giveaway.id}`)
        .setEmoji('🎉')
        .setLabel('Terminé')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

      await message.edit({ embeds: [endedEmbed], components: [row] }).catch(() => null);
    }
  }

  // Annoncer le résultat direct
  if (winners.length > 0) {
    const mentions = winners.map(w => `<@${w}>`).join(', ');
    await channel.send(`🎉 Félicitations à ${mentions} qui gagne(nt) **${giveaway.prize}** ! 🏆`).catch(() => null);
  } else {
    await channel.send(`😢 Personne n'a participé au giveaway pour **${giveaway.prize}**, il n'y a donc pas de gagnant.`).catch(() => null);
  }
}

/**
 * Sélectionne un nouveau gagnant (Reroll)
 */
export async function rerollGiveaway(client: Client, giveawayId: string, expectedGuildId?: string) {
  const giveaway = await prisma.giveaway.findFirst({
    where: { id: giveawayId, ...(expectedGuildId ? { guildId: expectedGuildId } : {}) },
  });

  if (!giveaway && expectedGuildId) {
    throw new Error('Giveaway introuvable sur ce serveur.');
  }
  if (!giveaway || !giveaway.ended) return;

  const discordGuild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
  if (!discordGuild) return;

  const channel = discordGuild.channels.cache.get(giveaway.channelId);
  if (!channel?.isTextBased()) return;

  // Filtrer les participants qui ne sont pas déjà gagnants validés
  const candidates = giveaway.participants.filter(id => !giveaway.winners.includes(id));
  if (candidates.length === 0) {
    await channel.send(`❌ Aucun autre participant disponible pour un reroll de **${giveaway.prize}**.`).catch(() => null);
    return;
  }

  const newWinners = await drawWinnersWeighted(giveaway.guildId, candidates, 1, channel);
  const newWinner = newWinners[0];

  if (giveaway.needValidation) {
    // Si validation requise, on met à jour en tant que gagnant en attente
    await prisma.giveaway.update({
      where: { id: giveawayId },
      data: {
        validationStatus: 'PENDING',
        pendingWinners: [newWinner],
      },
    });

    if (giveaway.messageId) {
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (message) {
        const endedEmbed = buildGiveawayEmbed(
          giveaway,
          `${giveaway.description ? `${giveaway.description}\n\n` : ''}**Gagnant Tiré après Reroll (En attente de validation) :** <@${newWinner}>\n**Participants :** ${giveaway.participants.length}`,
          '#FAA81A'
        );

        const approveBtn = new ButtonBuilder()
          .setCustomId(`giveaway_val_approve:${giveaway.id}`)
          .setLabel('Valider le gagnant ✅')
          .setStyle(ButtonStyle.Success);

        const rerollBtn = new ButtonBuilder()
          .setCustomId(`giveaway_val_reroll:${giveaway.id}`)
          .setLabel('Relancer (Reroll) 🎲')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rerollBtn);
        await message.edit({ embeds: [endedEmbed], components: [row] }).catch(() => null);
      }
    }

    await channel.send(`🎲 Reroll effectué ! Nouveau gagnant tiré au sort (En attente de validation) : <@${newWinner}>.`).catch(() => null);
  } else {
    // Pas de validation requise, gain immédiat
    const updatedWinners = [...giveaway.winners, newWinner];

    await prisma.giveaway.update({
      where: { id: giveawayId },
      data: {
        winners: updatedWinners,
        validationStatus: 'APPROVED'
      },
    });

    await distributeGiveawayPrizes(giveaway, [newWinner]).catch((err) => {
      logger.error('GiveawayService', 'Error distributing reroll prizes:', err);
    });

    if (giveaway.messageId) {
      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (message) {
        const winnersMentions = updatedWinners.map(w => `<@${w}>`).join(', ');
        const endedEmbed = buildGiveawayEmbed(
          giveaway,
          `${giveaway.description ? `${giveaway.description}\n\n` : ''}**Gagnants (après reroll) :** ${winnersMentions}\n**Participants :** ${giveaway.participants.length}`,
          '#ED4245'
        );

        const disabledButton = new ButtonBuilder()
          .setCustomId(`giveaway_ended:${giveaway.id}`)
          .setEmoji('🎉')
          .setLabel('Terminé')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

        await message.edit({ embeds: [endedEmbed], components: [row] }).catch(() => null);
      }
    }

    await channel.send(`🎉 Nouveau tirage ! Félicitations à <@${newWinner}> qui gagne également **${giveaway.prize}** ! 🏆`).catch(() => null);
  }
}

/**
 * Valide les gagnants en attente et distribue les prix.
 */
export async function approveGiveawayWinners(client: Client, giveawayId: string) {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
  });

  if (!giveaway || !giveaway.ended || giveaway.validationStatus !== 'PENDING') return;

  const winners = giveaway.pendingWinners;

  // Mettre à jour en BDD
  await prisma.giveaway.update({
    where: { id: giveawayId },
    data: {
      validationStatus: 'APPROVED',
      winners,
      pendingWinners: [],
    },
  });

  // Distribuer les prix
  await distributeGiveawayPrizes(giveaway, winners).catch((err) => {
    logger.error('GiveawayService', 'Error distributing prizes on approval:', err);
  });

  // Mettre à jour le message d'origine
  const discordGuild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
  if (!discordGuild) return;
  const channel = discordGuild.channels.cache.get(giveaway.channelId);
  if (!channel?.isTextBased()) return;

  if (giveaway.messageId) {
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message) {
      const winnersMentions = winners.length > 0 ? winners.map((w: string) => `<@${w}>`).join(', ') : 'Aucun.';
      const endedEmbed = buildGiveawayEmbed(
        giveaway,
        `${giveaway.description ? `${giveaway.description}\n\n` : ''}**Gagnants Validés :** ${winnersMentions}\n**Participants :** ${giveaway.participants.length}`,
        '#57F287' // Vert
      );

      const disabledButton = new ButtonBuilder()
        .setCustomId(`giveaway_ended:${giveaway.id}`)
        .setEmoji('🎉')
        .setLabel('Terminé & Validé')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

      await message.edit({ embeds: [endedEmbed], components: [row] }).catch(() => null);
    }
  }

  // Annoncer le résultat final
  if (winners.length > 0) {
    const mentions = winners.map((w: string) => `<@${w}>`).join(', ');
    await channel.send(`🎉 **Félicitations validées !** ${mentions} gagne(nt) officiellement **${giveaway.prize}** ! 🏆`).catch(() => null);
  } else {
    await channel.send(`😢 Le giveaway pour **${giveaway.prize}** n'a aucun gagnant validé.`).catch(() => null);
  }
}

/**
 * Distribue les récompenses d'un giveaway aux profils des gagnants.
 */
async function distributeGiveawayPrizes(giveaway: {
  guildId: string;
  prize: string;
  rpgXp?: unknown;
  rpgCoins?: unknown;
  rpgItemId?: unknown;
}, winners: string[]) {
  if (winners.length === 0) return;

  const rpgXp = (giveaway.rpgXp as number) || 0;
  const rpgCoins = (giveaway.rpgCoins as number) || 0;
  const rpgItemId = (giveaway.rpgItemId as string | null) || null;

  const { checkLevelUp } = await import('./economyService.js');

  for (const userId of winners) {
    // 1. KotboCoins
    if (rpgCoins > 0) {
      await prisma.rpgProfile.upsert({
        where: { guildId_userId: { guildId: giveaway.guildId, userId } },
        update: { balance: { increment: rpgCoins } },
        create: {
          guildId: giveaway.guildId,
          userId,
          balance: rpgCoins,
          level: 1,
          xp: 0,
          health: 100,
          maxHealth: 100,
          energy: 100,
          attack: 10,
          defense: 10,
          speed: 10
        }
      });
    }

    // 2. XP RPG
    if (rpgXp > 0) {
      await prisma.rpgProfile.upsert({
        where: { guildId_userId: { guildId: giveaway.guildId, userId } },
        update: { xp: { increment: rpgXp } },
        create: {
          guildId: giveaway.guildId,
          userId,
          balance: 0,
          level: 1,
          xp: rpgXp,
          health: 100,
          maxHealth: 100,
          energy: 100,
          attack: 10,
          defense: 10,
          speed: 10
        }
      });
      await checkLevelUp(giveaway.guildId, userId).catch(() => null);
    }

    // 3. Objet RPG
    if (rpgItemId) {
      const item = await prisma.rpgItem.findUnique({
        where: { id: rpgItemId }
      });
      if (item) {
        const profile = await prisma.rpgProfile.upsert({
          where: { guildId_userId: { guildId: giveaway.guildId, userId } },
          update: {},
          create: {
            guildId: giveaway.guildId,
            userId,
            balance: 0,
            level: 1,
            xp: 0,
            health: 100,
            maxHealth: 100,
            energy: 100,
            attack: 10,
            defense: 10,
            speed: 10
          }
        });

        await prisma.rpgInventoryItem.upsert({
          where: {
            rpgProfileId_itemId: {
              rpgProfileId: profile.id,
              itemId: item.id
            }
          },
          update: { quantity: { increment: 1 } },
          create: {
            rpgProfileId: profile.id,
            itemId: item.id,
            quantity: 1
          }
        });
      }
    }
  }
}

/**
 * Vérifie toutes les minutes les concours expirés et les clôture
 */
export async function checkExpiredGiveaways(client: Client) {
  try {
    const expired = await prisma.giveaway.findMany({
      where: {
        ended: false,
        endsAt: { lte: new Date() },
      },
    });

    for (const giveaway of expired) {
      if (!(await isModuleEnabled(giveaway.guildId, 'giveaways'))) continue;
      await endGiveaway(client, giveaway.id);
    }
  } catch (err) {
    logger.error('GiveawayService', 'Erreur lors de la vérification des giveaways expirés :', err);
  }
}

/**
 * Choisit `count` gagnants parmi les candidats en appliquant le bonus de chances
 * du clan gagnant de la saison de clans active.
 */
/**
 * Ne garde que les participants encore membres du serveur.
 *
 * Toute panne de resolution rend la liste inchangee : mieux vaut un tirage
 * parmi des candidats non verifies qu'un giveaway sans gagnant parce que
 * Discord n'a pas repondu.
 */
async function filterStillPresent(
  discordGuild: { members: { fetch: (options: { user: string[] }) => Promise<{ has: (id: string) => boolean; size: number }> } } | null | undefined,
  candidates: string[],
): Promise<string[]> {
  if (!discordGuild || candidates.length === 0) return candidates;

  try {
    const present = await discordGuild.members.fetch({ user: candidates });
    // Zero membre resolu ressemble davantage a un echec de recuperation qu'a
    // un depart general : on ne vide pas le tirage sur ce seul signal.
    if (present.size === 0) return candidates;
    return candidates.filter((userId) => present.has(userId));
  } catch (err) {
    logger.error('GiveawayService', 'Impossible de verifier la presence des participants :', err);
    return candidates;
  }
}

async function drawWinnersWeighted(
  guildId: string,
  candidates: string[],
  count: number,
  channel: any
): Promise<string[]> {
  if (candidates.length === 0 || count <= 0) return [];

  // Filet de sécurité : l'écouteur de départ retire les participants qui
  // quittent le serveur, mais il ne voit rien quand le bot est hors ligne.
  // On revérifie donc la présence au moment du tirage, seul endroit traversé
  // par la clôture comme par le reroll.
  candidates = await filterStillPresent(channel?.guild, candidates);
  if (candidates.length === 0) return [];

  // Récupérer les paramètres de bonus du clan vainqueur
  let winningRoleId: string | null = null;
  try {
    const guildSettings = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { clanRewardGiveaway: true, lastWinningClanId: true },
    });
    if (guildSettings?.clanRewardGiveaway && guildSettings.lastWinningClanId) {
      const winningClan = await prisma.clan.findUnique({
        where: { id: guildSettings.lastWinningClanId },
        select: { roleId: true },
      });
      if (winningClan) {
        winningRoleId = winningClan.roleId;
      }
    }
  } catch (err) {
    logger.error('GiveawayService', 'Erreur lors de la récupération du bonus de giveaway de clan:', err);
  }

  const winners: string[] = [];
  const pool = [...candidates];
  const discordGuild = channel.guild;

  // Si pas de bonus actif, tirage uniforme standard
  if (!winningRoleId || !discordGuild) {
    const actualCount = Math.min(count, pool.length);
    for (let i = 0; i < actualCount; i++) {
      const randIndex = Math.floor(Math.random() * pool.length);
      winners.push(pool[randIndex]);
      pool.splice(randIndex, 1);
    }
    return winners;
  }

  // Tirage pondéré
  const actualCount = Math.min(count, pool.length);
  for (let i = 0; i < actualCount; i++) {
    // Calculer les poids de chaque candidat restant
    const weights: number[] = [];
    let totalWeight = 0;

    for (const userId of pool) {
      const member = discordGuild.members.cache.get(userId);
      // Poids de 2 si le membre est dans le clan vainqueur (a le rôle), sinon 1
      const weight = (member && member.roles.cache.has(winningRoleId)) ? 2 : 1;
      weights.push(weight);
      totalWeight += weight;
    }

    // Sélection aléatoire pondérée
    let randomVal = Math.random() * totalWeight;
    let selectedIndex = 0;

    for (let j = 0; j < pool.length; j++) {
      randomVal -= weights[j];
      if (randomVal <= 0) {
        selectedIndex = j;
        break;
      }
    }

    winners.push(pool[selectedIndex]);
    pool.splice(selectedIndex, 1);
  }

  return winners;
}
