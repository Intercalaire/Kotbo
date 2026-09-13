/**
 * Application et retrait des avantages d'un partenariat.
 *
 * Le problème que ce fichier résout : un partenariat qui se termine laissait
 * derrière lui son rôle, son salon, ses exemptions d'automod et son serveur
 * ajouté à la liste des invitations autorisées. Personne ne s'en souvenait six
 * mois plus tard, et la liste des exemptions grossissait sans que quiconque
 * sache à quoi chaque ligne correspondait.
 *
 * D'où `PartnershipBenefitGrant` : chaque application laisse une trace de ce
 * qui a été touché, et surtout de ce qui **préexistait**. Un rôle que la
 * personne avait déjà avant le partenariat est marqué `preExisting` et n'est
 * jamais retiré à la fin - le module rend l'état exactement comme il l'a
 * trouvé, ni plus ni moins.
 *
 * Trois familles d'avantages :
 *   - ceux que ce fichier applique lui-même (rôles, salons, exemptions) ;
 *   - ceux que le service de publication applique (vitrine, publicité épinglée,
 *     annonce), parce qu'ils consistent à poster un message ;
 *   - ceux que d'autres modules consomment (bonus d'XP, prime de bienvenue,
 *     support prioritaire). Ceux-là ne « s'appliquent » pas : ils sont déclarés
 *     actifs, et les modules concernés les lisent par `activeBenefitsFor`.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
} from 'discord.js';
import type { PartnershipBenefit } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent } from './partnershipEvents.js';

/** Avantages posés par ce fichier. Les autres sont déclaratifs (cf. en-tête). */
const SELF_APPLIED = new Set([
  'PARTNER_ROLE',
  'CHANNEL_ACCESS',
  'DEDICATED_CHANNEL',
  'AUTOMOD_EXEMPTION',
  'INVITE_ALLOWED',
  'RAID_WHITELIST',
]);

// ─── Application ─────────────────────────────────────────────────────────────

/**
 * Applique tous les avantages accordés d'un dossier. Chaque avantage est traité
 * isolément : un rôle supprimé entre-temps ne doit pas empêcher la création du
 * salon dédié.
 */
export async function applyPartnershipBenefits(partnershipId: string): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { benefits: true, partner: { include: { contacts: true } } },
  });
  if (!partnership?.guildId) return;

  const client = getClient();
  const guild = await client.guilds.fetch(partnership.guildId).catch(() => null);
  if (!guild) {
    logger.warn('Partenariats : serveur introuvable, avantages non appliques', { partnershipId });
    return;
  }

  const settings = await getPartnershipSettings(partnership.guildId);
  const representatives = partnership.partner.contacts
    .filter((contact) => contact.representative && contact.userId)
    .map((contact) => contact.userId as string);

  for (const benefit of partnership.benefits) {
    if (benefit.direction !== 'GRANTED') continue;
    if (benefit.state === 'APPLIED') continue;

    try {
      await applyBenefit(benefit, {
        guild,
        client,
        representatives,
        partnerGuildId: partnership.partner.partnerGuildId,
        partnershipId,
        defaultRoleId: settings.partnerRoleId,
        dedicatedCategoryId: settings.dedicatedCategoryId,
        partnerName: partnership.partner.displayName,
      });

      await prisma.partnershipBenefit.update({
        where: { id: benefit.id },
        data: { state: 'APPLIED', appliedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Partenariats : avantage non applique", { partnershipId, kind: benefit.kind, error: message });

      await prisma.partnershipBenefit.update({
        where: { id: benefit.id },
        data: { state: 'FAILED', lastError: message.slice(0, 500) },
      });

      await recordPartnershipEvent({
        partnershipId,
        kind: 'benefit_failed',
        summary: `Avantage « ${benefit.kind} » non appliqué : ${message}`,
        payload: { benefitId: benefit.id, kind: benefit.kind },
      });
    }
  }
}

interface ApplyContext {
  guild: Guild;
  client: Client;
  representatives: string[];
  partnerGuildId: string | null;
  partnershipId: string;
  defaultRoleId: string | null;
  dedicatedCategoryId: string | null;
  partnerName: string;
}

async function applyBenefit(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  switch (benefit.kind) {
    case 'PARTNER_ROLE':
      await applyRole(benefit, context);
      return;
    case 'CHANNEL_ACCESS':
      await applyChannelAccess(benefit, context);
      return;
    case 'DEDICATED_CHANNEL':
      await applyDedicatedChannel(benefit, context);
      return;
    case 'AUTOMOD_EXEMPTION':
      await applyAutomodExemption(benefit, context);
      return;
    case 'INVITE_ALLOWED':
      await applyInviteAllowance(benefit, context);
      return;
    case 'RAID_WHITELIST':
      await applyRaidWhitelist(benefit, context);
      return;
    default:
      // Avantage déclaratif : il n'y a rien à poser sur Discord, l'état
      // `APPLIED` suffit à ce que les modules concernés le lisent.
      return;
  }
}

async function applyRole(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  const roleId = benefit.targetRef ?? context.defaultRoleId;
  if (!roleId) throw new Error('Aucun rôle partenaire configuré.');

  const role = await context.guild.roles.fetch(roleId).catch(() => null);
  if (!role) throw new Error(`Rôle ${roleId} introuvable.`);

  for (const userId of context.representatives) {
    const member = await context.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;

    const already = member.roles.cache.has(roleId);
    if (!already) await member.roles.add(role, 'Partenariat actif');

    await recordGrant(benefit.id, userId, 'member', already);
  }
}

async function applyChannelAccess(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  if (!benefit.targetRef) throw new Error('Aucun salon désigné.');

  const channel = await context.guild.channels.fetch(benefit.targetRef).catch(() => null);
  if (!channel || !('permissionOverwrites' in channel)) throw new Error('Salon introuvable.');

  for (const userId of context.representatives) {
    const existing = channel.permissionOverwrites.cache.get(userId);
    const already = existing?.allow.has(PermissionFlagsBits.ViewChannel) ?? false;

    if (!already) {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
      });
    }
    await recordGrant(benefit.id, userId, 'member', already);
  }
}

/**
 * Crée le salon du partenariat. À la fin, il sera archivé - renommé et fermé -
 * plutôt que supprimé : l'historique des échanges avec un partenaire est
 * précisément ce qu'on veut relire avant de retravailler avec lui.
 */
async function applyDedicatedChannel(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: context.partnershipId },
    select: { dedicatedChannelId: true },
  });

  if (partnership?.dedicatedChannelId) {
    const existing = await context.guild.channels.fetch(partnership.dedicatedChannelId).catch(() => null);
    if (existing) {
      await recordGrant(benefit.id, existing.id, 'channel', true);
      return;
    }
  }

  const name = `part-${slugify(context.partnerName)}`.slice(0, 90);
  const channel = await context.guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: context.dedicatedCategoryId ?? undefined,
    reason: `Partenariat avec ${context.partnerName}`,
    permissionOverwrites: [
      { id: context.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...context.representatives.map((userId) => ({
        id: userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ],
  });

  await prisma.partnership.update({
    where: { id: context.partnershipId },
    data: { dedicatedChannelId: channel.id },
  });
  await recordGrant(benefit.id, channel.id, 'channel', false);
}

/**
 * Ajoute le rôle partenaire aux rôles exemptés d'automod.
 *
 * L'exemption porte sur un rôle et non sur des personnes : c'est ainsi que
 * `AutoModConfig` la traite, et cela évite d'y écrire un identifiant par
 * représentant. `preExisting` retient si le rôle y était déjà, pour ne pas
 * rouvrir le filtrage d'un serveur qui l'avait exempté de son côté.
 */
async function applyAutomodExemption(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  const roleId = benefit.targetRef ?? context.defaultRoleId;
  if (!roleId) throw new Error('Aucun rôle partenaire configuré.');

  const config = await prisma.autoModConfig.findUnique({ where: { guildId: context.guild.id } });
  const already = config?.bypassRoles.includes(roleId) ?? false;

  if (!already) {
    await prisma.autoModConfig.upsert({
      where: { guildId: context.guild.id },
      create: { guildId: context.guild.id, bypassRoles: [roleId] },
      update: { bypassRoles: { push: roleId } },
    });
  }
  await recordGrant(benefit.id, roleId, 'role', already);
}

/**
 * Autorise les invitations vers le serveur partenaire.
 *
 * Deux endroits à toucher, parce que deux mécanismes différents filtrent les
 * invitations : le filtre natif d'AutoMod (`inviteFilterAllowedGuilds`, qui
 * raisonne par serveur cible) et la protection anti-raid
 * (`inviteBypassRoleIds`, qui raisonne par rôle de l'auteur).
 */
async function applyInviteAllowance(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  if (context.partnerGuildId) {
    const config = await prisma.autoModConfig.findUnique({ where: { guildId: context.guild.id } });
    const already = config?.inviteFilterAllowedGuilds.includes(context.partnerGuildId) ?? false;

    if (!already) {
      await prisma.autoModConfig.upsert({
        where: { guildId: context.guild.id },
        create: { guildId: context.guild.id, inviteFilterAllowedGuilds: [context.partnerGuildId] },
        update: { inviteFilterAllowedGuilds: { push: context.partnerGuildId } },
      });
    }
    await recordGrant(benefit.id, context.partnerGuildId, 'guild', already);
  }

  const roleId = benefit.targetRef ?? context.defaultRoleId;
  if (!roleId) return;

  const raid = await prisma.raidProtectionConfig.findUnique({ where: { guildId: context.guild.id } });
  const roleAlready = raid?.inviteBypassRoleIds.includes(roleId) ?? false;

  if (!roleAlready) {
    await prisma.raidProtectionConfig.upsert({
      where: { guildId: context.guild.id },
      create: { guildId: context.guild.id, inviteBypassRoleIds: [roleId] },
      update: { inviteBypassRoleIds: { push: roleId } },
    });
  }
  await recordGrant(benefit.id, roleId, 'role', roleAlready);
}

async function applyRaidWhitelist(benefit: PartnershipBenefit, context: ApplyContext): Promise<void> {
  const roleId = benefit.targetRef ?? context.defaultRoleId;
  if (!roleId) throw new Error('Aucun rôle partenaire configuré.');

  const raid = await prisma.raidProtectionConfig.findUnique({ where: { guildId: context.guild.id } });
  const already = raid?.inviteBypassRoleIds.includes(roleId) ?? false;

  if (!already) {
    await prisma.raidProtectionConfig.upsert({
      where: { guildId: context.guild.id },
      create: { guildId: context.guild.id, inviteBypassRoleIds: [roleId] },
      update: { inviteBypassRoleIds: { push: roleId } },
    });
  }
  await recordGrant(benefit.id, roleId, 'role', already);
}

async function recordGrant(
  benefitId: string,
  subjectId: string,
  subjectType: 'member' | 'channel' | 'role' | 'guild',
  preExisting: boolean,
): Promise<void> {
  await prisma.partnershipBenefitGrant.upsert({
    where: { benefitId_subjectId: { benefitId, subjectId } },
    create: { benefitId, subjectId, subjectType, preExisting },
    update: { revokedAt: null, revokeReason: null },
  });
}

// ─── Retrait ─────────────────────────────────────────────────────────────────

/**
 * Retire ce que le module avait posé, et rien d'autre.
 *
 * Les applications marquées `preExisting` sont laissées telles quelles : elles
 * ne viennent pas de nous. Le salon dédié est archivé plutôt que supprimé.
 */
export async function revokePartnershipBenefits(partnershipId: string, reason: string): Promise<void> {
  const partnership = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { benefits: { include: { grants: { where: { revokedAt: null } } } } },
  });
  if (!partnership?.guildId) return;

  const client = getClient();
  const guild = await client.guilds.fetch(partnership.guildId).catch(() => null);
  if (!guild) return;

  for (const benefit of partnership.benefits) {
    if (benefit.state !== 'APPLIED') continue;

    for (const grant of benefit.grants) {
      if (grant.preExisting) {
        await prisma.partnershipBenefitGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date(), revokeReason: reason },
        });
        continue;
      }

      try {
        await revokeGrant(benefit, grant.subjectId, grant.subjectType, guild, partnership.dedicatedChannelId);
      } catch (error) {
        logger.warn('Partenariats : retrait partiel', { partnershipId, kind: benefit.kind, error });
      }

      await prisma.partnershipBenefitGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revokeReason: reason },
      });
    }

    await prisma.partnershipBenefit.update({
      where: { id: benefit.id },
      data: { state: 'REVOKED', revokedAt: new Date() },
    });
  }

  await recordPartnershipEvent({
    partnershipId,
    kind: 'benefits_revoked',
    summary: `Avantages retirés (${reason}).`,
    payload: { reason },
  });
}

async function revokeGrant(
  benefit: PartnershipBenefit,
  subjectId: string,
  subjectType: string,
  guild: Guild,
  dedicatedChannelId: string | null,
): Promise<void> {
  switch (benefit.kind) {
    case 'PARTNER_ROLE': {
      const member = await guild.members.fetch(subjectId).catch(() => null);
      if (member && benefit.targetRef) await member.roles.remove(benefit.targetRef, 'Partenariat terminé');
      else if (member) {
        const settings = await getPartnershipSettings(guild.id);
        if (settings.partnerRoleId) await member.roles.remove(settings.partnerRoleId, 'Partenariat terminé');
      }
      return;
    }
    case 'CHANNEL_ACCESS': {
      if (!benefit.targetRef) return;
      const channel = await guild.channels.fetch(benefit.targetRef).catch(() => null);
      if (channel && 'permissionOverwrites' in channel) {
        await channel.permissionOverwrites.delete(subjectId, 'Partenariat terminé');
      }
      return;
    }
    case 'DEDICATED_CHANNEL': {
      const channel = await guild.channels.fetch(dedicatedChannelId ?? subjectId).catch(() => null);
      if (channel) await archiveChannel(channel);
      return;
    }
    case 'AUTOMOD_EXEMPTION': {
      if (subjectType !== 'role') return;
      await pullFromList('autoModConfig', guild.id, 'bypassRoles', subjectId);
      return;
    }
    case 'INVITE_ALLOWED': {
      if (subjectType === 'guild') await pullFromList('autoModConfig', guild.id, 'inviteFilterAllowedGuilds', subjectId);
      else await pullFromList('raidProtectionConfig', guild.id, 'inviteBypassRoleIds', subjectId);
      return;
    }
    case 'RAID_WHITELIST': {
      await pullFromList('raidProtectionConfig', guild.id, 'inviteBypassRoleIds', subjectId);
      return;
    }
    default:
      return;
  }
}

/**
 * Archive le salon dédié : verrouillé, renommé, sorti de sa catégorie de
 * travail. Supprimer effacerait la seule trace écrite de ce qui s'est dit avec
 * ce partenaire.
 */
async function archiveChannel(channel: GuildBasedChannel): Promise<void> {
  if (!('permissionOverwrites' in channel) || !('setName' in channel)) return;

  await channel.permissionOverwrites
    .edit(channel.guild.roles.everyone.id, { SendMessages: false })
    .catch(() => null);

  if (!channel.name.startsWith('archive-')) {
    await channel.setName(`archive-${channel.name}`.slice(0, 100), 'Partenariat terminé').catch(() => null);
  }
}

/**
 * Retire une valeur d'un tableau de configuration. Prisma ne sait pas retirer
 * d'un scalaire liste : on relit, on filtre, on réécrit. La fenêtre de course
 * est acceptable - ces listes sont modifiées par un humain, rarement, et jamais
 * deux fois dans la même seconde.
 */
async function pullFromList(
  model: 'autoModConfig' | 'raidProtectionConfig',
  guildId: string,
  field: string,
  value: string,
): Promise<void> {
  if (model === 'autoModConfig') {
    const config = await prisma.autoModConfig.findUnique({ where: { guildId } });
    if (!config) return;
    const current = (config as unknown as Record<string, string[]>)[field] ?? [];
    if (!current.includes(value)) return;
    await prisma.autoModConfig.update({
      where: { guildId },
      data: { [field]: current.filter((entry) => entry !== value) },
    });
    return;
  }

  const config = await prisma.raidProtectionConfig.findUnique({ where: { guildId } });
  if (!config) return;
  const current = (config as unknown as Record<string, string[]>)[field] ?? [];
  if (!current.includes(value)) return;
  await prisma.raidProtectionConfig.update({
    where: { guildId },
    data: { [field]: current.filter((entry) => entry !== value) },
  });
}

// ─── Lecture par les autres modules ──────────────────────────────────────────

/**
 * Avantages actifs d'un serveur, pour les modules qui les consomment sans que
 * ce fichier ait à les connaître : bonus d'XP au niveau, prime de bienvenue à
 * l'économie, priorité aux tickets.
 */
export async function activeBenefitsFor(guildId: string, kinds: string[]) {
  return prisma.partnershipBenefit.findMany({
    where: {
      kind: { in: kinds },
      state: 'APPLIED',
      partnership: { guildId, stage: { in: ['ACTIVE', 'RENEWAL'] } },
    },
    include: { partnership: { select: { id: true, partnerId: true } } },
  });
}

/** Les avantages que ce fichier pose lui-même, par opposition aux déclaratifs. */
export function isSelfAppliedBenefit(kind: string): boolean {
  return SELF_APPLIED.has(kind);
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
