import {
  ChannelType,
  DiscordAPIError,
  OverwriteType,
  RESTJSONErrorCodes,
  PermissionFlagsBits,
  PermissionsBitField,
  type Guild,
  type NonThreadGuildBasedChannel,
  type PermissionOverwriteOptions,
  type PermissionsString,
} from 'discord.js';
import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

type OverwriteState = 'allow' | 'deny' | 'neutral';
type OverwriteSnapshot = Partial<Record<PermissionsString, OverwriteState>>;

export type LockableChannel = Exclude<NonThreadGuildBasedChannel, { type: ChannelType.GuildCategory }>;
export type LockOutcome = 'locked' | 'already' | 'failed';
export type UnlockOutcome = 'unlocked' | 'gone' | 'failed';

const TEXT_PERMISSIONS: PermissionsString[] = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
];
const VOICE_PERMISSIONS: PermissionsString[] = ['Connect', 'Speak', 'SendMessages', 'AddReactions'];

export function isLockable(channel: NonThreadGuildBasedChannel): channel is LockableChannel {
  return channel.type !== ChannelType.GuildCategory;
}

function lockedPermissionsFor(channel: LockableChannel): PermissionsString[] {
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice
    ? VOICE_PERMISSIONS
    : TEXT_PERMISSIONS;
}

function readOverwrite(channel: LockableChannel, id: string, permissions: PermissionsString[]): OverwriteSnapshot {
  const overwrite = channel.permissionOverwrites.cache.get(id);
  return Object.fromEntries(permissions.map((perm) => [
    perm,
    overwrite?.allow.has(perm) ? 'allow' : overwrite?.deny.has(perm) ? 'deny' : 'neutral',
  ]));
}

/**
 * Rend à une cible (@everyone ou le bot) l'état d'origine des permissions touchées,
 * sans toucher aux autres. Une surcharge qui redevient vide est supprimée : c'est
 * équivalent pour Discord, et un salon synchronisé avec sa catégorie le redevient.
 */
async function restoreOverwrite(
  channel: LockableChannel,
  id: string,
  type: OverwriteType,
  was: OverwriteSnapshot,
  reason: string,
): Promise<void> {
  const permissions = Object.keys(was) as PermissionsString[];
  const touched = PermissionsBitField.resolve(permissions);
  const allowBack = PermissionsBitField.resolve(permissions.filter((perm) => was[perm] === 'allow'));
  const denyBack = PermissionsBitField.resolve(permissions.filter((perm) => was[perm] === 'deny'));

  const current = channel.permissionOverwrites.cache.get(id);
  const finalAllow = ((current?.allow.bitfield ?? 0n) & ~touched) | allowBack;
  const finalDeny = ((current?.deny.bitfield ?? 0n) & ~touched) | denyBack;

  if (finalAllow === 0n && finalDeny === 0n) {
    // Suppression sans consulter le cache : juste après une écriture, il peut ne pas
    // encore contenir la surcharge que le bot vient de créer.
    await channel.permissionOverwrites.delete(id, reason).catch((err) => {
      if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownPermissionOverwrite)) throw err;
    });
    return;
  }

  const options: PermissionOverwriteOptions = Object.fromEntries(permissions.map((perm) => [
    perm,
    was[perm] === 'allow' ? true : was[perm] === 'deny' ? false : null,
  ]));
  await channel.permissionOverwrites.edit(id, options, { reason, type });
}

export async function lockChannel(
  channel: LockableChannel,
  lockedById: string,
  reason: string | null,
): Promise<LockOutcome> {
  const guild = channel.guild;
  const key = { guildId_channelId: { guildId: guild.id, channelId: channel.id } };
  if (await prisma.channelLockdown.findUnique({ where: key })) return 'already';

  const me = guild.members.me;
  if (!me) return 'failed';

  // Discord refuse à un bot non administrateur de poser ou retirer une permission
  // qu'il n'a pas lui-même dans le salon : on s'en tient à celles qu'il possède.
  const botPermissions = me.permissionsIn(channel);
  if (!botPermissions.has(PermissionFlagsBits.ManageRoles)) return 'failed';
  const permissions = lockedPermissionsFor(channel).filter((perm) => botPermissions.has(perm));
  if (permissions.length === 0) return 'failed';

  const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  const everyoneWas = readOverwrite(channel, guild.id, permissions);
  const botWas = isAdmin ? null : readOverwrite(channel, me.id, permissions);

  // Trace écrite avant toute modification : un arrêt en plein verrouillage laisse
  // de quoi déverrouiller, au lieu d'un salon fermé sans mémoire de son état.
  try {
    await prisma.channelLockdown.create({
      data: {
        guildId: guild.id,
        channelId: channel.id,
        everyoneWas: everyoneWas as Prisma.InputJsonObject,
        botWas: botWas ? (botWas as Prisma.InputJsonObject) : undefined,
        reason,
        lockedById,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return 'already';
    throw err;
  }

  const auditReason = `Lockdown${reason ? ` : ${reason}` : ''}`;
  try {
    // Le bot se garde d'abord les permissions : sans ça, le refus posé à @everyone
    // l'atteindrait aussi, et il ne pourrait plus rouvrir le salon.
    if (botWas) {
      await channel.permissionOverwrites.edit(
        me.id,
        Object.fromEntries(permissions.map((perm) => [perm, true])),
        { reason: auditReason, type: OverwriteType.Member },
      );
    }
    await channel.permissionOverwrites.edit(
      guild.id,
      Object.fromEntries(permissions.map((perm) => [perm, false])),
      { reason: auditReason, type: OverwriteType.Role },
    );
    return 'locked';
  } catch (err) {
    logger.error('Lockdown', `Verrouillage impossible de ${channel.id} sur ${guild.id}`, err);
    await unlockChannel(guild, channel.id).catch(() => null);
    return 'failed';
  }
}

export async function unlockChannel(guild: Guild, channelId: string): Promise<UnlockOutcome> {
  const key = { guildId_channelId: { guildId: guild.id, channelId } };
  const record = await prisma.channelLockdown.findUnique({ where: key });
  if (!record) return 'gone';

  const channel = guild.channels.cache.get(channelId);
  if (!channel || channel.isThread() || !isLockable(channel)) {
    await prisma.channelLockdown.delete({ where: key }).catch(() => null);
    return 'gone';
  }

  const reason = 'Fin du lockdown';
  try {
    await restoreOverwrite(channel, guild.id, OverwriteType.Role, record.everyoneWas as unknown as OverwriteSnapshot, reason);
    const me = guild.members.me;
    if (record.botWas && me) {
      await restoreOverwrite(channel, me.id, OverwriteType.Member, record.botWas as unknown as OverwriteSnapshot, reason);
    }
  } catch (err) {
    logger.error('Lockdown', `Déverrouillage impossible de ${channelId} sur ${guild.id}`, err);
    return 'failed';
  }

  await prisma.channelLockdown.delete({ where: key }).catch(() => null);
  return 'unlocked';
}

export async function listLockedChannelIds(guildId: string): Promise<string[]> {
  const rows = await prisma.channelLockdown.findMany({ where: { guildId }, select: { channelId: true } });
  return rows.map((row) => row.channelId);
}
