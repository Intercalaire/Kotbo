/**
 * Paris nominatifs entre deux membres, réglés en points de clan.
 *
 * Un membre défie quelqu'un sur un sujet libre et une mise ; l'adversaire
 * accepte, et seul un arbitre tranche - administrateur, ou porteur d'un des
 * rôles désignés dans l'onglet Paris. Le pari fonctionne à l'intérieur
 * d'un clan comme entre deux clans : les points vivent sur la ligne de
 * contribution (clan, membre, saison), donc un transfert entre deux membres du
 * même clan laisse le total du clan inchangé, tandis qu'un transfert entre deux
 * clans le déplace réellement.
 *
 * Les mises sont prélevées à l'acceptation, pas au verdict. Sans ce prélèvement,
 * un perdant dont le score a fondu entre-temps (fin de saison, retrait
 * administratif) ne pourrait plus payer, et le gagnant recevrait des points qui
 * n'ont jamais existé.
 *
 * Quand le mode dette est ouvert, la part de mise que le solde ne couvre pas
 * devient une dette de points de clan, remboursée sur les gains futurs. Cette
 * part reste de la valeur réelle dans le pot : le gagnant touche la mise
 * annoncée, endetté ou non.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  userMention,
  type ButtonInteraction,
  type Channel,
  type ChatInputCommandInteraction,
  type Client,
  type Guild as DiscordGuild,
  type GuildMember,
  type Message,
  type NewsChannel,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import type { ClanBet } from '@prisma/client';
import {
  BET_SUBJECT_MAX_LENGTH,
  buildBetThreadName,
  checkStake,
  computeBetPot,
  normalizeBetSubject,
  normalizeClanBetSettings,
  planStakeFunding,
  type ClanBetSettings,
} from '@kotbo/shared';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { COLORS_RAW } from '../../utils/embeds.js';
import { isModuleEnabled } from '../core/moduleGate.js';
import { isStaffServerGuild } from '../staff/staffServerService.js';
import { creditClanContribution, logClanContribution } from './clanService.js';
import { cancelClanPointDebt, getClanPointDebt, openClanPointDebt } from './clanDebtService.js';
import { getAllLinkedUserIds } from '../moderation/altAccountService.js';

const DEFAULT_BET_CHANNEL_NAME = 'faire-des-paris';
const DEFAULT_ANNOUNCEMENT_CHANNEL_NAME = 'annonce-paris';

export type BetStatus =
  | 'PENDING'
  | 'LOCKED'
  | 'ACTIVE'
  | 'RESOLVED'
  | 'REFUNDED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED';

/** États dans lesquels un pari occupe encore une place dans le quota d'un membre. */
const OPEN_STATUSES: BetStatus[] = ['PENDING', 'LOCKED', 'ACTIVE'];

/** Salons où le bot sait publier un pari et y ouvrir un fil. */
type BetTextChannel = TextChannel | NewsChannel;

const frenchNumber = (value: number) => value.toLocaleString('fr-FR');

// ─── Réglages du serveur ─────────────────────────────────────────────────────

const BET_SETTINGS_SELECT = {
  betsEnabled: true,
  betChannelId: true,
  betAnnouncementChannelId: true,
  betMinStake: true,
  betMaxStake: true,
  betMaxOpenPerMember: true,
  betAcceptWindowHours: true,
  betAllowDebt: true,
  betMaxDebt: true,
  betDebtResetOnSeason: true,
  betResolverRoleIds: true,
} as const;

export async function getClanBetSettings(guildId: string): Promise<ClanBetSettings> {
  const row = await prisma.guild.findUnique({ where: { id: guildId }, select: BET_SETTINGS_SELECT });
  return normalizeClanBetSettings(row);
}

/**
 * Les paris sont disponibles quand leur propre interrupteur est ouvert **et**
 * que le module de clans tourne : la mise est un point de clan, un pari sans
 * clans n'aurait rien à déplacer.
 */
async function isBettingOpen(guildId: string, settings: ClanBetSettings): Promise<boolean> {
  if (!settings.betsEnabled) return false;
  return isModuleEnabled(guildId, 'clans');
}

// ─── Accès aux points de clan ────────────────────────────────────────────────

type ClanRef = { id: string; name: string; roleId: string };

/**
 * Identifiant sous lequel les points d'un membre sont comptés. Un membre ayant
 * un double compte validé n'a qu'une seule ligne de contribution : débiter sous
 * son identifiant du moment en créerait une seconde, à côté de son score réel.
 */
async function canonicalUserId(guildId: string, userId: string): Promise<string> {
  const linked = await getAllLinkedUserIds(guildId, userId).catch(() => [userId]);
  return linked.slice().sort()[0] ?? userId;
}

async function readClanPoints(guildId: string, clanId: string, userId: string, season: number): Promise<number> {
  const row = await prisma.clanMemberContribution.findUnique({
    where: { guildId_clanId_userId_season: { guildId, clanId, userId, season } },
    select: { xp: true },
  });
  return Math.max(0, row?.xp ?? 0);
}

function findMemberClan(clans: ClanRef[], member: GuildMember): ClanRef | null {
  const role = member.roles.cache.find((entry) => clans.some((clan) => clan.roleId === entry.id));
  if (!role) return null;
  return clans.find((clan) => clan.roleId === role.id) ?? null;
}

/**
 * Points déjà promis par un membre dans des paris proposés mais pas encore
 * acceptés.
 *
 * Sans cette réserve, un membre à 100 points peut ouvrir cinq défis à 100 : il a
 * bien les points pour chacun pris isolément, mais pas pour les tenir tous. Les
 * paris acceptés ne comptent pas ici - leurs points sont déjà prélevés, ils ont
 * quitté le solde.
 *
 * Compte les deux rôles : être défié engage autant que défier, puisque accepter
 * prélèvera la mise.
 */
async function committedInPendingBets(guildId: string, userId: string): Promise<number> {
  const pending = await prisma.clanBet.findMany({
    where: {
      guildId,
      status: 'PENDING',
      OR: [{ challengerId: userId }, { opponentId: userId }],
    },
    select: { stake: true },
  });
  return pending.reduce((sum, bet) => sum + bet.stake, 0);
}

type BetContext = { season: number; clans: ClanRef[] };

async function loadBetContext(guildId: string): Promise<BetContext | null> {
  const guildConfig = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { clansEnabled: true, currentClanSeason: true },
  });
  if (!guildConfig?.clansEnabled) return null;

  const clans = await prisma.clan.findMany({
    where: { guildId },
    select: { id: true, name: true, roleId: true },
  });
  if (clans.length === 0) return null;

  return { season: guildConfig.currentClanSeason, clans };
}

/**
 * Déplace des points de clan et journalise le mouvement pour le flux public.
 * Retourne le montant réellement inscrit, qui peut être inférieur au montant
 * demandé quand le plafond de saison s'applique.
 */
async function moveClanPoints(params: {
  guildId: string;
  clanId: string;
  userId: string;
  season: number;
  amount: number;
  skipDebt?: boolean;
}): Promise<{ granted: number; debtRepaid: number }> {
  const { granted, debtRepaid } = await creditClanContribution(params);

  // Le flux public reçoit le gain **brut**, pas le solde net : le remboursement
  // est journalisé séparément par `creditClanContribution`, en négatif. Loguer
  // le net ici ferait disparaître les deux lignes dans une seule, et le montant
  // affiché sur le site ne correspondrait plus à celui annoncé sur Discord.
  await logClanContribution(params.guildId, params.clanId, params.userId, granted + debtRepaid, 'BET', params.season);
  return { granted, debtRepaid };
}

// ─── Salons ──────────────────────────────────────────────────────────────────

export function asBetChannel(channel: Channel | null | undefined): BetTextChannel | null {
  if (!channel) return null;
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) return channel;
  return null;
}

function findChannelByName(guild: DiscordGuild, name: string): BetTextChannel | null {
  // Le repli par nom accepte les mêmes types que le réglage explicite : un
  // « annonce-paris » créé en salon d'annonces Discord serait sinon introuvable
  // alors que le bot sait parfaitement y écrire.
  const channel = guild.channels.cache.find((entry) => entry.name === name && asBetChannel(entry) !== null);
  return asBetChannel(channel);
}

async function resolveConfiguredChannel(
  guild: DiscordGuild,
  channelId: string | null,
  fallbackName: string,
): Promise<BetTextChannel | null> {
  if (channelId) {
    const configured = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);
    const channel = asBetChannel(configured);
    if (channel) return channel;
  }
  return findChannelByName(guild, fallbackName);
}

export async function resolveBetChannel(guild: DiscordGuild, settings: ClanBetSettings): Promise<BetTextChannel | null> {
  return resolveConfiguredChannel(guild, settings.betChannelId, DEFAULT_BET_CHANNEL_NAME);
}

/**
 * Salon du récapitulatif. Repli sur le salon des paris : une annonce publiée au
 * mauvais endroit reste préférable à un verdict qui disparaît sans trace.
 */
async function resolveAnnouncementChannel(guild: DiscordGuild, settings: ClanBetSettings): Promise<BetTextChannel | null> {
  const announcement = await resolveConfiguredChannel(
    guild,
    settings.betAnnouncementChannelId,
    DEFAULT_ANNOUNCEMENT_CHANNEL_NAME,
  );
  return announcement ?? await resolveBetChannel(guild, settings);
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

function statusLine(bet: ClanBet): { text: string; color: number } {
  switch (bet.status as BetStatus) {
    case 'PENDING':
      return {
        text: `⏳ En attente de la réponse de ${userMention(bet.opponentId)} · expire <t:${Math.floor(bet.expiresAt.getTime() / 1000)}:R>`,
        color: COLORS_RAW.warning,
      };
    case 'LOCKED':
      return { text: '⏳ Traitement en cours...', color: COLORS_RAW.warning };
    case 'ACTIVE':
      return {
        text: `🔥 Pari en cours · **${frenchNumber(computeBetPot(bet))} points** en jeu\nSeul un arbitre peut le clore.`,
        color: COLORS_RAW.primary,
      };
    case 'RESOLVED': {
      // `winnerId` est toujours renseigné sur un pari tranché, mais une ligne
      // corrigée à la main pourrait ne pas l'avoir : `userMention('')` afficherait
      // « <@> » dans le salon.
      const winner = bet.winnerId ? userMention(bet.winnerId) : 'Le gagnant';
      const repaid = bet.winnerDebtRepaid > 0
        ? `\n💳 dont ${frenchNumber(bet.winnerDebtRepaid)} partis en remboursement de sa dette.`
        : '';
      return {
        text: `🏆 ${winner} remporte **${frenchNumber(computeBetPot(bet))} points de clan**.${repaid}`,
        color: COLORS_RAW.success,
      };
    }
    case 'REFUNDED':
      // Sans `resolvedById`, l'annulation vient de la clôture de saison et non
      // d'un geste humain : l'annoncer comme une décision d'arbitre ferait
      // chercher un responsable qui n'existe pas.
      return {
        text: bet.resolvedById
          ? '↩️ Pari annulé par un arbitre : les mises ont été rendues.'
          : '↩️ Pari clos à la fin de la saison : les mises ont été rendues.',
        color: COLORS_RAW.dark,
      };
    case 'DECLINED':
      return { text: '❌ Proposition refusée.', color: COLORS_RAW.danger };
    case 'CANCELLED':
      return { text: '🚫 Proposition retirée par son auteur.', color: COLORS_RAW.dark };
    case 'EXPIRED':
      return { text: '🕓 Proposition expirée sans réponse.', color: COLORS_RAW.dark };
    default:
      return { text: bet.status, color: COLORS_RAW.dark };
  }
}

function buildBetEmbed(bet: ClanBet, clanNames: { challenger?: string | null; opponent?: string | null }): EmbedBuilder {
  const status = statusLine(bet);
  const clanSuffix = (name?: string | null) => (name ? ` — *${name}*` : '');
  const debtNote = (amount: number) => (amount > 0 ? ` · 💳 ${frenchNumber(amount)} à crédit` : '');

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Pari : ${bet.subject}`.slice(0, 256))
    .setColor(status.color)
    .setDescription(status.text)
    .addFields(
      { name: 'Mise', value: `${frenchNumber(bet.stake)} points de clan **chacun**`, inline: true },
      { name: 'Saison', value: `${bet.season}`, inline: true },
      {
        name: 'Parieurs',
        value: `${userMention(bet.challengerId)}${clanSuffix(clanNames.challenger)}${debtNote(bet.challengerDebt)}\n`
          + `${userMention(bet.opponentId)}${clanSuffix(clanNames.opponent)}${debtNote(bet.opponentDebt)}`,
      },
    )
    .setFooter({ text: `ID : ${bet.id}` })
    .setTimestamp(bet.createdAt);

  if (bet.status === 'ACTIVE' && (bet.challengerDebt > 0 || bet.opponentDebt > 0)) {
    embed.addFields({
      name: '💳 Mise à crédit',
      value: 'Une partie de la mise est engagée à crédit : elle sera prélevée sur les prochains points de clan gagnés.',
    });
  }

  return embed;
}

/**
 * Les messages du bot partent en Components V2 : une édition qui ne repasse pas
 * les composants les efface. Cette fonction est donc la seule source des
 * boutons, et elle renvoie une liste vide pour les paris clos.
 */
function buildBetComponents(bet: ClanBet): ActionRowBuilder<ButtonBuilder>[] {
  // Le bouton d'annulation est affiché à tout le monde : le droit est vérifié au
  // clic. Le masquer supposerait de connaître les rôles de chaque lecteur au
  // moment du rendu, ce que l'édition d'un message ne permet pas.
  const voidButton = new ButtonBuilder()
    .setCustomId(`bet:void:${bet.id}`)
    .setLabel('Annuler (admin)')
    .setEmoji('↩️')
    .setStyle(ButtonStyle.Secondary);

  if (bet.status === 'PENDING') {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bet:accept:${bet.id}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bet:decline:${bet.id}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bet:cancel:${bet.id}`).setLabel('Retirer').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
        voidButton,
      ),
    ];
  }

  if (bet.status === 'ACTIVE') {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bet:resolve:${bet.id}`).setLabel('Désigner le gagnant (admin)').setEmoji('⚖️').setStyle(ButtonStyle.Primary),
        voidButton,
      ),
    ];
  }

  return [];
}

async function clanNamesFor(bet: ClanBet): Promise<{ challenger?: string | null; opponent?: string | null }> {
  const ids = [bet.challengerClanId, bet.opponentClanId].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return {};

  const clans = await prisma.clan.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(clans.map((clan) => [clan.id, clan.name]));
  return {
    challenger: bet.challengerClanId ? byId.get(bet.challengerClanId) : null,
    opponent: bet.opponentClanId ? byId.get(bet.opponentClanId) : null,
  };
}

/** Réécrit l'annonce d'un pari. Best-effort : un message supprimé ne doit pas faire échouer le règlement. */
async function refreshBetMessage(client: Client, bet: ClanBet): Promise<void> {
  if (!bet.messageId) return;
  try {
    const guild = client.guilds.cache.get(bet.guildId) ?? await client.guilds.fetch(bet.guildId);
    const channel = guild.channels.cache.get(bet.channelId) ?? await guild.channels.fetch(bet.channelId);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(bet.messageId);
    const names = await clanNamesFor(bet);
    await message.edit({ embeds: [buildBetEmbed(bet, names)], components: buildBetComponents(bet) });
  } catch (err) {
    logger.warn('ClanBet', `Annonce du pari ${bet.id} non rafraîchie :`, err);
  }
}

/** Clôt le fil de discussion d'un pari réglé, après y avoir laissé le verdict. */
async function closeBetThread(client: Client, bet: ClanBet, verdict: string): Promise<void> {
  if (!bet.threadId) return;
  try {
    const channel = await client.channels.fetch(bet.threadId);
    if (!channel?.isThread()) return;
    await channel.send(verdict).catch(() => undefined);
    await channel.setLocked(true).catch(() => undefined);
    await channel.setArchived(true).catch(() => undefined);
  } catch (err) {
    logger.warn('ClanBet', `Fil du pari ${bet.id} non clôturé :`, err);
  }
}

function betMessageLink(bet: ClanBet): string | null {
  if (!bet.messageId) return null;
  return `https://discord.com/channels/${bet.guildId}/${bet.channelId}/${bet.messageId}`;
}

/**
 * Récapitulatif public une fois le verdict rendu. Publié dans le salon
 * d'annonces, séparé du salon où les paris se négocient : le premier sert
 * d'historique lisible, le second est bruyant.
 */
async function announceBetOutcome(client: Client, bet: ClanBet): Promise<void> {
  try {
    const guild = client.guilds.cache.get(bet.guildId) ?? await client.guilds.fetch(bet.guildId);
    const settings = await getClanBetSettings(bet.guildId);
    const channel = await resolveAnnouncementChannel(guild, settings);
    if (!channel) return;

    const names = await clanNamesFor(bet);
    const pot = computeBetPot(bet);
    const resolved = bet.status === 'RESOLVED';
    const loserId = bet.winnerId === bet.challengerId ? bet.opponentId : bet.challengerId;
    const loserDebt = bet.winnerId === bet.challengerId ? bet.opponentDebt : bet.challengerDebt;

    const embed = new EmbedBuilder()
      .setTitle(resolved ? '🏆 Résultat du pari' : '↩️ Pari annulé')
      .setColor(resolved ? COLORS_RAW.success : COLORS_RAW.dark)
      .setDescription(`**${bet.subject}**`)
      .addFields(
        {
          name: 'Parieurs',
          value: `${userMention(bet.challengerId)}${names.challenger ? ` — *${names.challenger}*` : ''}\n`
            + `${userMention(bet.opponentId)}${names.opponent ? ` — *${names.opponent}*` : ''}`,
        },
        { name: 'Mise', value: `${frenchNumber(bet.stake)} points chacun`, inline: true },
        {
          name: resolved ? 'Gagnant' : 'Issue',
          value: resolved && bet.winnerId
            ? `${userMention(bet.winnerId)} · **+${frenchNumber(pot)} points**`
              + (bet.winnerDebtRepaid > 0
                ? `\n💳 dont ${frenchNumber(bet.winnerDebtRepaid)} en remboursement `
                  + `· ${frenchNumber(pot - bet.winnerDebtRepaid)} au classement`
                : '')
            : 'Mises rendues aux deux parieurs',
          inline: true,
        },
      )
      .setFooter({ text: `Saison ${bet.season} · ID : ${bet.id}` })
      .setTimestamp(bet.resolvedAt ?? new Date());

    if (resolved && bet.winnerId) {
      embed.addFields({
        name: 'Perdant',
        value: `${userMention(loserId)} · **-${frenchNumber(bet.stake)} points**`
          + (loserDebt > 0 ? `\n💳 dont ${frenchNumber(loserDebt)} restant dus` : ''),
        inline: true,
      });
    }
    if (bet.resolvedById) {
      embed.addFields({ name: 'Tranché par', value: userMention(bet.resolvedById), inline: true });
    }

    const link = betMessageLink(bet);
    const components = link
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Voir le pari').setStyle(ButtonStyle.Link).setURL(link),
        )]
      : [];

    await channel.send({ embeds: [embed], components });
  } catch (err) {
    logger.error('ClanBet', `Annonce du résultat du pari ${bet.id} impossible :`, err);
  }
}

// ─── Commande ────────────────────────────────────────────────────────────────

async function replyEphemeral(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
}

function describeStakeRejection(check: Exclude<ReturnType<typeof checkStake>, { ok: true }>): string {
  switch (check.reason) {
    case 'not-integer':
      return 'La mise doit être un nombre entier de points de clan.';
    case 'below-min':
      return `La mise minimale sur ce serveur est de ${frenchNumber(check.min)} point(s) de clan.`;
    default:
      return `La mise maximale sur ce serveur est de ${frenchNumber(check.max)} points de clan.`;
  }
}

export async function handleBetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    await replyEphemeral(interaction, '❌ Cette commande doit être utilisée sur un serveur.');
    return;
  }
  const guildId = interaction.guildId;

  if (await isStaffServerGuild(guildId)) {
    await replyEphemeral(interaction, '❌ Les paris ne sont pas disponibles sur un serveur staff.');
    return;
  }

  const settings = await getClanBetSettings(guildId);
  if (!(await isBettingOpen(guildId, settings))) {
    await replyEphemeral(interaction, '❌ Les paris sont désactivés sur ce serveur.');
    return;
  }

  const opponentUser = interaction.options.getUser('adversaire', true);
  const subject = normalizeBetSubject(interaction.options.getString('sujet', true));
  const stakeCheck = checkStake(interaction.options.getInteger('mise', true), settings);

  if (!stakeCheck.ok) {
    await replyEphemeral(interaction, `❌ ${describeStakeRejection(stakeCheck)}`);
    return;
  }
  if (!subject) {
    await replyEphemeral(interaction, '❌ Le sujet du pari ne peut pas être vide.');
    return;
  }
  if (subject.length > BET_SUBJECT_MAX_LENGTH) {
    await replyEphemeral(interaction, `❌ Le sujet ne peut pas dépasser ${BET_SUBJECT_MAX_LENGTH} caractères.`);
    return;
  }
  if (opponentUser.bot) {
    await replyEphemeral(interaction, '❌ Impossible de parier contre un bot.');
    return;
  }
  if (opponentUser.id === interaction.user.id) {
    await replyEphemeral(interaction, '❌ Impossible de parier contre soi-même.');
    return;
  }

  // Le salon dédié n'est imposé que s'il existe : un serveur qui n'a ni réglage
  // ni salon nommé « faire-des-paris » doit pouvoir utiliser la commande.
  const betChannel = await resolveBetChannel(guild, settings);
  if (betChannel && betChannel.id !== interaction.channelId) {
    await replyEphemeral(interaction, `❌ Les paris se lancent dans ${betChannel.toString()}.`);
    return;
  }
  const targetChannel = betChannel ?? asBetChannel(interaction.channel);
  if (!targetChannel) {
    await replyEphemeral(interaction, '❌ Aucun salon utilisable pour publier le pari.');
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const context = await loadBetContext(guildId);
  if (!context) {
    await replyEphemeral(interaction, "❌ Aucun clan n'est configuré sur ce serveur.");
    return;
  }

  const challengerMember = await guild.members.fetch(interaction.user.id).catch(() => null);
  const opponentMember = await guild.members.fetch(opponentUser.id).catch(() => null);
  if (!challengerMember || !opponentMember) {
    await replyEphemeral(interaction, '❌ Les deux parieurs doivent être membres du serveur.');
    return;
  }

  const challengerClan = findMemberClan(context.clans, challengerMember);
  const opponentClan = findMemberClan(context.clans, opponentMember);
  if (!challengerClan) {
    await replyEphemeral(interaction, "❌ Tu n'appartiens à aucun clan : impossible de miser des points de clan.");
    return;
  }
  if (!opponentClan) {
    await replyEphemeral(interaction, `❌ ${opponentUser.toString()} n'appartient à aucun clan.`);
    return;
  }

  const openCount = await prisma.clanBet.count({
    where: {
      guildId,
      status: { in: OPEN_STATUSES },
      OR: [{ challengerId: interaction.user.id }, { opponentId: interaction.user.id }],
    },
  });
  if (openCount >= settings.betMaxOpenPerMember) {
    await replyEphemeral(
      interaction,
      `❌ Tu as déjà ${settings.betMaxOpenPerMember} pari(s) en cours : termine-les avant d'en lancer un autre.`,
    );
    return;
  }

  // Solvabilité vérifiée dès la proposition, et revérifiée à l'acceptation : ici
  // c'est pour ne pas afficher publiquement un pari que son auteur ne peut pas
  // tenir.
  const challengerKey = await canonicalUserId(guildId, interaction.user.id);
  const points = await readClanPoints(guildId, challengerClan.id, challengerKey, context.season);
  const committed = await committedInPendingBets(guildId, interaction.user.id);
  const funding = planStakeFunding({
    stake: stakeCheck.stake,
    availablePoints: points - committed,
    allowDebt: settings.betAllowDebt,
    maxDebt: settings.betMaxDebt,
    currentDebt: await getClanPointDebt(guildId, challengerKey),
  });
  if (!funding.ok) {
    await replyEphemeral(interaction, `❌ ${describeFundingRejection(funding, settings, committed)}`);
    return;
  }

  const bet = await prisma.clanBet.create({
    data: {
      guildId,
      channelId: targetChannel.id,
      challengerId: interaction.user.id,
      opponentId: opponentUser.id,
      challengerClanId: challengerClan.id,
      opponentClanId: opponentClan.id,
      subject,
      stake: stakeCheck.stake,
      season: context.season,
      challengerPlannedDebt: funding.fromDebt,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + settings.betAcceptWindowHours * 3_600_000),
    },
  });

  let published: Message | null = null;
  try {
    published = await targetChannel.send({
      content: `${opponentUser.toString()}, ${interaction.user.toString()} te défie !`,
      embeds: [buildBetEmbed(bet, { challenger: challengerClan.name, opponent: opponentClan.name })],
      components: buildBetComponents(bet),
    });

    const thread = await published.startThread({
      name: buildBetThreadName(subject),
      autoArchiveDuration: 1440,
      reason: 'Fil de discussion du pari.',
    }).catch((err: unknown) => {
      logger.warn('ClanBet', `Fil non créé pour le pari ${bet.id} :`, err);
      return null;
    });

    await prisma.clanBet.update({
      where: { id: bet.id },
      data: { messageId: published.id, threadId: thread?.id ?? null },
    });
  } catch (err) {
    // Un pari sans annonce n'a aucun bouton pour être accepté ni refusé : il ne
    // doit pas rester en base à occuper le quota de son auteur.
    await published?.delete().catch(() => undefined);
    await prisma.clanBet.delete({ where: { id: bet.id } }).catch(() => undefined);
    logger.error('ClanBet', `Publication du pari ${bet.id} impossible :`, err);
    await replyEphemeral(interaction, '❌ Impossible de publier le pari dans ce salon.');
    return;
  }

  const creditNote = funding.fromDebt > 0
    ? ` ⚠️ ${frenchNumber(funding.fromDebt)} point(s) seront engagés à crédit si le pari est accepté.`
    : '';
  await replyEphemeral(interaction, `✅ Pari proposé à ${opponentUser.toString()} (ID : \`${bet.id}\`).${creditNote}`);
}

function describeFundingRejection(
  funding: Exclude<ReturnType<typeof planStakeFunding>, { ok: true }>,
  settings: ClanBetSettings,
  committed = 0,
): string {
  if (funding.reason !== 'insufficient-points') {
    return `Plafond de dette atteint : ${frenchNumber(funding.currentDebt)} point(s) déjà dus sur ${frenchNumber(funding.maxDebt)} autorisés.`;
  }

  // Distinguer « tu n'as pas les points » de « tu les as déjà promis ailleurs » :
  // c'est le cas qui surprend, puisque le solde affiché au classement, lui, n'a
  // pas bougé.
  const reserved = committed > 0
    ? ` (${frenchNumber(committed)} déjà engagé(s) dans des paris en attente)`
    : '';
  const credit = settings.betAllowDebt
    ? ''
    : " Le mode dette n'est pas activé sur ce serveur : impossible de miser des points que tu n'as pas.";

  return `Mise trop élevée : ${frenchNumber(funding.available)} point(s) de clan disponible(s) cette saison${reserved}.${credit}`;
}

// ─── Boutons ─────────────────────────────────────────────────────────────────

/**
 * Prend un pari dans un état donné pour le passer en `LOCKED`.
 *
 * L'écriture conditionnelle est le verrou : deux clics simultanés sur
 * « Accepter » entrent tous les deux dans le handler, mais un seul voit
 * `count === 1` et va prélever les points.
 */
async function claimBet(betId: string, from: BetStatus): Promise<ClanBet | null> {
  const claimed = await prisma.clanBet.updateMany({
    where: { id: betId, status: from },
    data: { status: 'LOCKED' },
  });
  if (claimed.count === 0) return null;
  return prisma.clanBet.findUnique({ where: { id: betId } });
}

async function releaseBet(betId: string, status: BetStatus): Promise<ClanBet | null> {
  return prisma.clanBet.update({ where: { id: betId }, data: { status } }).catch(() => null);
}

export async function handleBetButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, betId] = interaction.customId.split(':');
  if (!action || !betId || !interaction.guildId) return;

  const settings = await getClanBetSettings(interaction.guildId);
  if (!(await isBettingOpen(interaction.guildId, settings))) {
    await replyEphemeral(interaction, '❌ Les paris sont désactivés sur ce serveur.');
    return;
  }

  const bet = await prisma.clanBet.findUnique({ where: { id: betId } });
  if (!bet || bet.guildId !== interaction.guildId) {
    await replyEphemeral(interaction, '❌ Pari introuvable.');
    return;
  }

  switch (action) {
    case 'accept':
      await acceptBet(interaction, bet, settings);
      return;
    case 'decline':
      await declineBet(interaction, bet);
      return;
    case 'cancel':
      await cancelBet(interaction, bet);
      return;
    case 'resolve':
      await promptBetResolution(interaction, bet, settings);
      return;
    case 'void':
      await promptBetVoid(interaction, bet, settings);
      return;
    case 'voidok':
      await confirmBetVoid(interaction, bet, settings);
      return;
    default:
      await replyEphemeral(interaction, '❌ Action de pari inconnue.');
  }
}

/**
 * Engage la mise d'un parieur : points d'abord, crédit ensuite.
 * Retourne ce qui a été réellement prélevé et ce qui a été mis à crédit.
 *
 * Un échec après le prélèvement rend les points avant de remonter : sinon le
 * parieur perdrait sa mise sans qu'aucun pari ne soit ouvert en face.
 */
async function stakeFor(params: {
  guildId: string;
  clanId: string;
  userKey: string;
  season: number;
  fromPoints: number;
  fromDebt: number;
}): Promise<{ escrow: number; debt: number }> {
  const escrow = params.fromPoints > 0
    ? -(await moveClanPoints({
        guildId: params.guildId,
        clanId: params.clanId,
        userId: params.userKey,
        season: params.season,
        amount: -params.fromPoints,
      })).granted
    : 0;

  if (params.fromDebt > 0) {
    try {
      await openClanPointDebt({ guildId: params.guildId, userId: params.userKey, amount: params.fromDebt, source: 'BET' });
    } catch (err) {
      await unstakeFor({
        guildId: params.guildId,
        clanId: params.clanId,
        userKey: params.userKey,
        season: params.season,
        escrow,
        debt: 0,
      });
      throw err;
    }
  }

  return { escrow, debt: params.fromDebt };
}

/** Rend à un parieur ce qui lui a été pris : les points reviennent, le crédit s'efface. */
async function unstakeFor(params: {
  guildId: string;
  clanId: string | null;
  userKey: string;
  season: number;
  escrow: number;
  debt: number;
}): Promise<void> {
  if (params.clanId && params.escrow > 0) {
    // `skipDebt` : rendre une mise annulée n'est pas un gain. Sans ça, les points
    // rendus iraient solder une dette que l'annulation vient d'effacer.
    await moveClanPoints({
      guildId: params.guildId,
      clanId: params.clanId,
      userId: params.userKey,
      season: params.season,
      amount: params.escrow,
      skipDebt: true,
    }).catch((err: unknown) => {
      logger.error('ClanBet', `Remboursement de la mise de ${params.userKey} impossible :`, err);
      return { granted: 0, debtRepaid: 0 };
    });
  }
  if (params.debt > 0) {
    await cancelClanPointDebt(params.guildId, params.userKey, params.debt).catch(() => 0);
  }
}

async function acceptBet(interaction: ButtonInteraction, bet: ClanBet, settings: ClanBetSettings): Promise<void> {
  if (interaction.user.id !== bet.opponentId) {
    await replyEphemeral(interaction, '❌ Seule la personne défiée peut accepter ce pari.');
    return;
  }
  if (bet.status !== 'PENDING') {
    await replyEphemeral(interaction, "❌ Ce pari n'attend plus de réponse.");
    return;
  }
  if (bet.expiresAt.getTime() <= Date.now()) {
    await replyEphemeral(interaction, '❌ Cette proposition a expiré.');
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const claimed = await claimBet(bet.id, 'PENDING');
  if (!claimed) {
    await replyEphemeral(interaction, "❌ Ce pari vient d'être traité.");
    return;
  }

  const context = await loadBetContext(bet.guildId);
  const guild = interaction.guild;
  if (!context || !guild) {
    await releaseBet(bet.id, 'PENDING');
    await replyEphemeral(interaction, '❌ Les clans ne sont plus disponibles sur ce serveur.');
    return;
  }

  // La saison a pu tourner entre la proposition et l'acceptation : les points
  // misés sont ceux de la saison en cours, pas ceux d'un classement clos.
  const season = context.season;
  const challengerMember = await guild.members.fetch(bet.challengerId).catch(() => null);
  const opponentMember = await guild.members.fetch(bet.opponentId).catch(() => null);
  const challengerClan = challengerMember ? findMemberClan(context.clans, challengerMember) : null;
  const opponentClan = opponentMember ? findMemberClan(context.clans, opponentMember) : null;

  if (!challengerClan || !opponentClan) {
    await releaseBet(bet.id, 'PENDING');
    await replyEphemeral(interaction, "❌ Les deux parieurs doivent appartenir à un clan au moment de l'acceptation.");
    return;
  }

  const challengerKey = await canonicalUserId(bet.guildId, bet.challengerId);
  const opponentKey = await canonicalUserId(bet.guildId, bet.opponentId);

  // Pas de réserve sur les propositions en attente ici, contrairement à la
  // création : deux propositions qui se réservent mutuellement ne pourraient
  // plus jamais être acceptées, ni l'une ni l'autre. À l'acceptation, seul le
  // solde réel compte - premier arrivé, premier servi.
  const challengerFunding = planStakeFunding({
    stake: bet.stake,
    availablePoints: await readClanPoints(bet.guildId, challengerClan.id, challengerKey, season),
    allowDebt: settings.betAllowDebt,
    maxDebt: settings.betMaxDebt,
    currentDebt: await getClanPointDebt(bet.guildId, challengerKey),
  });
  if (!challengerFunding.ok) {
    await releaseBet(bet.id, 'PENDING');
    await replyEphemeral(interaction, `❌ ${userMention(bet.challengerId)} ne peut plus tenir cette mise.`);
    return;
  }

  // Son solde a pu fondre depuis la proposition - retrait administratif, autre
  // pari accepté entre-temps. L'endetter au-delà de ce que le bot lui a annoncé
  // reviendrait à lui faire signer un crédit qu'il n'a jamais vu passer : le
  // pari retourne en attente, à lui de renflouer ou de le retirer.
  if (challengerFunding.fromDebt > bet.challengerPlannedDebt) {
    await releaseBet(bet.id, 'PENDING');
    const extra = challengerFunding.fromDebt - bet.challengerPlannedDebt;
    await replyEphemeral(
      interaction,
      `❌ Le solde de ${userMention(bet.challengerId)} a baissé depuis sa proposition : `
      + `il lui manque ${frenchNumber(extra)} point(s) de plus que ce qui lui avait été annoncé. `
      + 'Le pari reste en attente : il doit regagner des points ou le retirer.',
    );
    await notifyChallengerOfShortfall(interaction.client, bet, extra);
    return;
  }

  const opponentFunding = planStakeFunding({
    stake: bet.stake,
    availablePoints: await readClanPoints(bet.guildId, opponentClan.id, opponentKey, season),
    allowDebt: settings.betAllowDebt,
    maxDebt: settings.betMaxDebt,
    currentDebt: await getClanPointDebt(bet.guildId, opponentKey),
  });
  if (!opponentFunding.ok) {
    await releaseBet(bet.id, 'PENDING');
    await replyEphemeral(interaction, `❌ ${describeFundingRejection(opponentFunding, settings)}`);
    return;
  }

  let challenger = { escrow: 0, debt: 0 };
  let opponent = { escrow: 0, debt: 0 };
  try {
    challenger = await stakeFor({
      guildId: bet.guildId, clanId: challengerClan.id, userKey: challengerKey, season,
      fromPoints: challengerFunding.fromPoints, fromDebt: challengerFunding.fromDebt,
    });
    opponent = await stakeFor({
      guildId: bet.guildId, clanId: opponentClan.id, userKey: opponentKey, season,
      fromPoints: opponentFunding.fromPoints, fromDebt: opponentFunding.fromDebt,
    });
  } catch (err) {
    // Un prélèvement à moitié fait laisserait un parieur amputé sans contrepartie.
    await unstakeFor({
      guildId: bet.guildId,
      clanId: challengerClan.id,
      userKey: challengerKey,
      season,
      escrow: challenger.escrow,
      debt: challenger.debt,
    });
    await releaseBet(bet.id, 'PENDING');
    logger.error('ClanBet', `Prélèvement des mises du pari ${bet.id} impossible :`, err);
    await replyEphemeral(interaction, '❌ Impossible de prélever les mises, le pari reste en attente.');
    return;
  }

  const active = await prisma.clanBet.update({
    where: { id: bet.id },
    data: {
      status: 'ACTIVE',
      season,
      challengerClanId: challengerClan.id,
      opponentClanId: opponentClan.id,
      challengerEscrow: challenger.escrow,
      opponentEscrow: opponent.escrow,
      challengerDebt: challenger.debt,
      opponentDebt: opponent.debt,
    },
  });

  await refreshBetMessage(interaction.client, active);

  const creditNote = opponent.debt > 0
    ? ` ⚠️ ${frenchNumber(opponent.debt)} point(s) engagés à crédit : ils seront prélevés sur tes prochains gains.`
    : '';
  await replyEphemeral(interaction, `✅ Pari accepté : ${frenchNumber(bet.stake)} points sont engagés de chaque côté.${creditNote}`);
}

/**
 * Prévient l'auteur dans le fil du pari.
 *
 * Le refus d'acceptation part en éphémère à l'adversaire : sans ce message,
 * l'auteur verrait son pari rester « en attente » sans jamais savoir qu'une
 * acceptation a échoué à cause de son solde.
 */
async function notifyChallengerOfShortfall(client: Client, bet: ClanBet, missing: number): Promise<void> {
  if (!bet.threadId) return;
  try {
    const channel = await client.channels.fetch(bet.threadId);
    if (!channel?.isThread()) return;
    await channel.send(
      `⚠️ ${userMention(bet.challengerId)} - une acceptation vient d'échouer : il te manque `
      + `${frenchNumber(missing)} point(s) de clan par rapport à ta proposition. `
      + 'Regagne des points ou retire le pari.',
    );
  } catch (err) {
    logger.warn('ClanBet', `Avertissement de solde non transmis pour le pari ${bet.id} :`, err);
  }
}

async function declineBet(interaction: ButtonInteraction, bet: ClanBet): Promise<void> {
  if (interaction.user.id !== bet.opponentId) {
    await replyEphemeral(interaction, '❌ Seule la personne défiée peut refuser ce pari.');
    return;
  }
  const claimed = await claimBet(bet.id, 'PENDING');
  if (!claimed) {
    await replyEphemeral(interaction, "❌ Ce pari n'attend plus de réponse.");
    return;
  }

  const declined = await releaseBet(bet.id, 'DECLINED');
  if (declined) await refreshBetMessage(interaction.client, declined);
  await replyEphemeral(interaction, '❌ Pari refusé.');
}

async function cancelBet(interaction: ButtonInteraction, bet: ClanBet): Promise<void> {
  if (interaction.user.id !== bet.challengerId) {
    await replyEphemeral(interaction, "❌ Seul l'auteur du pari peut le retirer.");
    return;
  }
  const claimed = await claimBet(bet.id, 'PENDING');
  if (!claimed) {
    await replyEphemeral(interaction, '❌ Ce pari a déjà été accepté ou clos.');
    return;
  }

  const cancelled = await releaseBet(bet.id, 'CANCELLED');
  if (cancelled) await refreshBetMessage(interaction.client, cancelled);
  await replyEphemeral(interaction, '🚫 Proposition retirée.');
}

/**
 * Droit de trancher : administrateurs, plus les rôles désignés dans l'onglet
 * Paris. Sans cette liste, confier l'arbitrage à une équipe animation obligerait
 * à lui donner les pleins pouvoirs sur le serveur.
 */
function describeResolverRight(settings: ClanBetSettings, action: string): string {
  // Annoncer « seul un administrateur » alors que des rôles arbitres existent
  // enverrait la personne réclamer un droit qu'elle a peut-être déjà ailleurs.
  const roles = settings.betResolverRoleIds.length > 0
    ? ' ou porter un des rôles autorisés à gérer les paris'
    : '';
  return `❌ Il faut être administrateur${roles} pour ${action}.`;
}

function canResolveBets(interaction: ButtonInteraction | StringSelectMenuInteraction, settings: ClanBetSettings): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (settings.betResolverRoleIds.length === 0) return false;

  const member = interaction.member;
  if (!member) return false;
  const roleIds = Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
  return roleIds.some((roleId) => settings.betResolverRoleIds.includes(roleId));
}

/**
 * Menu de verdict, réservé aux arbitres. Le choix passe par un select éphémère
 * plutôt que par deux boutons publics : le nom des parieurs y est lisible, et un
 * clic de trop ne s'affiche pas dans le salon.
 */
async function promptBetResolution(interaction: ButtonInteraction, bet: ClanBet, settings: ClanBetSettings): Promise<void> {
  if (!canResolveBets(interaction, settings)) {
    await replyEphemeral(interaction, describeResolverRight(settings, 'clore un pari'));
    return;
  }
  if (bet.status !== 'ACTIVE') {
    await replyEphemeral(interaction, "❌ Ce pari n'est pas en cours.");
    return;
  }

  const guild = interaction.guild;
  const challenger = await guild?.members.fetch(bet.challengerId).catch(() => null);
  const opponent = await guild?.members.fetch(bet.opponentId).catch(() => null);
  const pot = frenchNumber(computeBetPot(bet));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`bet:winner:${bet.id}`)
    .setPlaceholder('Qui a gagné ce pari ?')
    .addOptions(
      {
        label: (challenger?.displayName ?? bet.challengerId).slice(0, 100),
        description: `Remporte ${pot} points de clan`.slice(0, 100),
        value: 'challenger',
        emoji: '🏆',
      },
      {
        label: (opponent?.displayName ?? bet.opponentId).slice(0, 100),
        description: `Remporte ${pot} points de clan`.slice(0, 100),
        value: 'opponent',
        emoji: '🏆',
      },
    );

  await interaction.reply({
    content: `**${bet.subject}**\nQui remporte ce pari ? Pour l'annuler sans gagnant, utilise « Annuler (admin) ».`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * Annulation par un arbitre, en deux temps.
 *
 * Le remboursement est irréversible et efface un pari que les deux parieurs ont
 * accepté : un clic isolé ne doit pas suffire, d'autant que le bouton est
 * affiché sous les yeux de tout le salon.
 */
async function promptBetVoid(interaction: ButtonInteraction, bet: ClanBet, settings: ClanBetSettings): Promise<void> {
  if (!canResolveBets(interaction, settings)) {
    await replyEphemeral(interaction, describeResolverRight(settings, 'annuler un pari'));
    return;
  }
  if (bet.status !== 'ACTIVE' && bet.status !== 'PENDING') {
    await replyEphemeral(interaction, "❌ Ce pari est déjà clos.");
    return;
  }

  const detail = bet.status === 'ACTIVE'
    ? `Chaque parieur récupère sa mise de ${frenchNumber(bet.stake)} point(s), part à crédit comprise.`
    : "Cette proposition n'a encore rien prélevé : elle sera simplement retirée.";

  await interaction.reply({
    content: `**${bet.subject}**\n${detail}\nConfirmer l'annulation ?`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bet:voidok:${bet.id}`).setLabel('Confirmer l\'annulation').setEmoji('↩️').setStyle(ButtonStyle.Danger),
      ),
    ],
    flags: [MessageFlags.Ephemeral],
  });
}

async function confirmBetVoid(interaction: ButtonInteraction, bet: ClanBet, settings: ClanBetSettings): Promise<void> {
  if (!canResolveBets(interaction, settings)) {
    await replyEphemeral(interaction, describeResolverRight(settings, 'annuler un pari'));
    return;
  }

  // L'état a pu changer entre l'affichage de la confirmation et le clic. `LOCKED`
  // est exclu explicitement : un pari en cours de traitement ne doit pas être
  // repris ici, sinon deux règlements se marcheraient dessus.
  if (bet.status !== 'ACTIVE' && bet.status !== 'PENDING') {
    await replyEphemeral(interaction, '❌ Ce pari est déjà clos ou en cours de traitement.');
    return;
  }

  await interaction.deferUpdate();

  const claimed = await claimBet(bet.id, bet.status as BetStatus);
  if (!claimed) {
    await interaction.editReply({ content: "❌ Ce pari vient d'être traité.", components: [] });
    return;
  }

  // Une proposition n'a rien prélevé : elle est retirée, pas remboursée.
  const settled = bet.status === 'ACTIVE'
    ? await refundBet(claimed, interaction.user.id)
    : await releaseBet(bet.id, 'CANCELLED');

  if (!settled) {
    await interaction.editReply({ content: "❌ Annulation impossible.", components: [] });
    return;
  }

  await refreshBetMessage(interaction.client, settled);
  if (settled.status === 'REFUNDED') {
    await announceBetOutcome(interaction.client, settled);
    await closeBetThread(interaction.client, settled, '↩️ Pari annulé par un administrateur : les mises ont été rendues.');
  }

  await interaction.editReply({
    content: settled.status === 'REFUNDED'
      ? '✅ Pari annulé, chaque parieur a récupéré sa mise.'
      : '✅ Proposition retirée.',
    components: [],
  });
}

export async function handleBetWinnerSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const betId = interaction.customId.split(':')[2];
  const choice = interaction.values[0];
  if (!betId || !choice || !interaction.guildId) return;

  const settings = await getClanBetSettings(interaction.guildId);
  if (!canResolveBets(interaction, settings)) {
    await replyEphemeral(interaction, describeResolverRight(settings, 'clore un pari'));
    return;
  }

  await interaction.deferUpdate();

  const bet = await prisma.clanBet.findUnique({ where: { id: betId } });
  if (!bet || bet.guildId !== interaction.guildId) {
    await interaction.editReply({ content: '❌ Pari introuvable.', components: [] });
    return;
  }

  const claimed = await claimBet(bet.id, 'ACTIVE');
  if (!claimed) {
    await interaction.editReply({ content: '❌ Ce pari a déjà été clos.', components: [] });
    return;
  }

  const settled = choice === 'refund'
    ? await refundBet(claimed, interaction.user.id)
    : await payoutBet(claimed, choice === 'challenger' ? claimed.challengerId : claimed.opponentId, interaction.user.id);

  await refreshBetMessage(interaction.client, settled);
  await announceBetOutcome(interaction.client, settled);
  await closeBetThread(
    interaction.client,
    settled,
    settled.status === 'RESOLVED' && settled.winnerId
      ? `🏆 Verdict : ${userMention(settled.winnerId)} remporte ${frenchNumber(computeBetPot(settled))} points de clan.`
        + (settled.winnerDebtRepaid > 0 ? ` (dont ${frenchNumber(settled.winnerDebtRepaid)} en remboursement de dette)` : '')
      : '↩️ Pari annulé : les mises ont été rendues.',
  );

  await interaction.editReply({
    content: settled.status === 'RESOLVED'
      ? `✅ Verdict enregistré : ${userMention(settled.winnerId ?? '')} l'emporte.`
      : '✅ Pari annulé, les mises ont été rendues.',
    components: [],
  });
}

/**
 * Verse au gagnant tout l'enjeu, sur la ligne du clan qu'il avait en acceptant.
 * Le perdant garde sa part à crédit : c'est précisément ce qu'il doit.
 */
async function payoutBet(bet: ClanBet, winnerId: string, resolvedById: string): Promise<ClanBet> {
  const winnerClanId = winnerId === bet.challengerId ? bet.challengerClanId : bet.opponentClanId;
  const pot = computeBetPot(bet);
  let debtRepaid = 0;

  if (winnerClanId && pot > 0) {
    const winnerKey = await canonicalUserId(bet.guildId, winnerId);
    // Pas de `skipDebt` : un gagnant endetté rembourse d'abord, c'est un gain.
    const moved = await moveClanPoints({
      guildId: bet.guildId,
      clanId: winnerClanId,
      userId: winnerKey,
      season: bet.season,
      amount: pot,
    }).catch((err: unknown) => {
      logger.error('ClanBet', `Versement du gain du pari ${bet.id} impossible :`, err);
      return { granted: 0, debtRepaid: 0 };
    });
    debtRepaid = moved.debtRepaid;
  }

  return prisma.clanBet.update({
    where: { id: bet.id },
    data: { status: 'RESOLVED', winnerId, resolvedById, resolvedAt: new Date(), winnerDebtRepaid: debtRepaid },
  });
}

/** Rend à chacun ce qui lui a été pris, ni plus ni moins, crédit compris. */
async function refundBet(bet: ClanBet, resolvedById: string | null): Promise<ClanBet> {
  const sides = [
    { clanId: bet.challengerClanId, userId: bet.challengerId, escrow: bet.challengerEscrow, debt: bet.challengerDebt },
    { clanId: bet.opponentClanId, userId: bet.opponentId, escrow: bet.opponentEscrow, debt: bet.opponentDebt },
  ];

  for (const side of sides) {
    const userKey = await canonicalUserId(bet.guildId, side.userId);
    await unstakeFor({
      guildId: bet.guildId,
      clanId: side.clanId,
      userKey,
      season: bet.season,
      escrow: side.escrow,
      debt: side.debt,
    });
  }

  return prisma.clanBet.update({
    where: { id: bet.id },
    data: { status: 'REFUNDED', winnerId: null, resolvedById, resolvedAt: new Date() },
  });
}

// ─── Balayage ────────────────────────────────────────────────────────────────

/**
 * Solde tous les paris ouverts avant la clôture d'une saison.
 *
 * Un pari ne doit jamais enjamber une fin de saison. Les mises sont prélevées
 * sur la ligne de contribution d'une saison donnée ; tranché après la bascule,
 * le pari verserait le gain sur un classement déjà clos, invisible pour tout le
 * monde. Les propositions expirent, les paris en cours sont remboursés - à
 * appeler **avant** le calcul des totaux, pour que la saison se ferme avec les
 * points rendus à leurs propriétaires.
 */
export async function settleOpenBetsForSeason(client: Client, guildId: string, season: number): Promise<number> {
  // Volontairement sans filtre de saison : un pari resté ouvert dont la saison
  // ne correspond plus survivrait à toutes les clôtures suivantes.
  const open = await prisma.clanBet.findMany({
    where: { guildId, status: { in: ['PENDING', 'ACTIVE'] } },
  });

  let settled = 0;
  for (const bet of open) {
    const claimed = await claimBet(bet.id, bet.status as BetStatus);
    if (!claimed) continue;

    // Une proposition n'a rien prélevé : elle expire. Un pari en cours a des
    // mises à rendre, escrow et part à crédit comprises.
    const closed = bet.status === 'ACTIVE'
      ? await refundBet(claimed, null)
      : await releaseBet(bet.id, 'EXPIRED');

    if (!closed) continue;
    settled += 1;
    await refreshBetMessage(client, closed);
    await closeBetThread(
      client,
      closed,
      closed.status === 'REFUNDED'
        ? '🕓 Fin de saison : le pari est clos et les mises ont été rendues.'
        : '🕓 Fin de saison : la proposition est close, aucune mise n\'avait été prélevée.',
    );
  }

  if (settled > 0) {
    logger.info('ClanBet', `${settled} pari(s) soldé(s) à la clôture de la saison ${season} sur ${guildId}.`);
  }
  return settled;
}

/**
 * Clôt les propositions jamais acceptées. Rien n'a été prélevé à ce stade : le
 * balayage ne fait que retirer des boutons qui ne mènent plus à rien.
 */
export async function expireStaleBets(client: Client): Promise<void> {
  const stale = await prisma.clanBet.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    take: 100,
  });

  for (const bet of stale) {
    const claimed = await claimBet(bet.id, 'PENDING');
    if (!claimed) continue;
    const expired = await releaseBet(bet.id, 'EXPIRED');
    if (expired) await refreshBetMessage(client, expired);
  }
}
