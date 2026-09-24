/**
 * Admission d'un membre qui arrive sur le serveur.
 *
 * Plusieurs écouteurs réagissent à une arrivée : rôles automatiques, message de bienvenue,
 * workflows, renommage, synchronisation du staff… Ils tournaient en parallèle du refoulement
 * des comptes trop récents : un compte banni quelques secondes plus tard avait déjà reçu ses
 * rôles, son message de bienvenue et son profil.
 *
 * Les contrôles qui peuvent expulser ou bannir passent donc ici, une seule fois par arrivée,
 * et chaque écouteur attend leur verdict avant d'agir.
 */

import type { GuildMember } from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  getRaidProtectionConfig,
  handleJoinDuringLock,
  handleJoinDuringRaidKick,
  trackJoinAndDetectRaid,
} from './raidProtectionService.js';
import { handleJoinAccountAgeGuard } from './accountAgeGuardService.js';

/** Durée pendant laquelle le verdict d'une arrivée reste partagé entre les écouteurs. */
const VERDICT_TTL_MS = 60_000;

const verdicts = new Map<string, Promise<boolean>>();

/**
 * Vrai si le membre reste sur le serveur, faux s'il vient d'être expulsé ou banni.
 *
 * Le premier appel pour une arrivée lance les contrôles, les suivants attendent le même
 * résultat : la détection de raid ne compte ainsi chaque arrivée qu'une fois. Une erreur
 * laisse entrer le membre, pour ne pas priver d'accueil tout un serveur sur une panne.
 */
export function admitJoiningMember(member: GuildMember): Promise<boolean> {
  const key = `${member.guild.id}:${member.id}`;
  const known = verdicts.get(key);
  if (known) return known;

  const verdict = runAdmissionChecks(member).catch((err: unknown) => {
    logger.error('JoinAdmission', `Contrôles d'arrivée en échec pour ${member.id} :`, err);
    return true;
  });
  verdicts.set(key, verdict);
  const timer = setTimeout(() => {
    if (verdicts.get(key) === verdict) verdicts.delete(key);
  }, VERDICT_TTL_MS);
  timer.unref?.();
  return verdict;
}

async function runAdmissionChecks(member: GuildMember): Promise<boolean> {
  const config = await getRaidProtectionConfig(member.guild.id);
  if (!config) return true;

  // 1. Join lock actif : kick immédiat (filet au-delà de la pause des invitations)
  if (await handleJoinDuringLock(member, config)) return false;

  // 2. Raid mode en action KICK
  if (await handleJoinDuringRaidKick(member, config)) return false;

  // 3. Détection de raid (fenêtre glissante)
  await trackJoinAndDetectRaid(member, config);

  // 4. Ancienneté du compte Discord : après la détection de raid, pour que les comptes
  //    refoulés comptent quand même dans la vague d'arrivées
  if (await handleJoinAccountAgeGuard(member, config)) return false;

  return true;
}
