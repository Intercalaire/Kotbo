/**
 * Jeux d'argent d'un serveur : quels jeux sont ouverts.
 *
 * L'état vit dans les restrictions de commandes, pas dans la configuration de l'économie :
 * le bot n'a ainsi qu'un seul endroit à consulter avant chaque commande, et la page d'accès
 * aux commandes montre la même chose que le réglage de la page Économie.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import {
  GAMBLING_COMMANDS,
  normalizeCommandRestrictions,
  readCommandsEnabled,
  withGamblingEnabled,
  type GamblingCommand,
} from '../../utils/commandAccess.js';

export type GamblingState = Record<GamblingCommand, boolean>;

async function loadRules(guildId: string) {
  const settings = await prisma.dashboardSettings.findUnique({ where: { guildId }, select: { commandRestrictions: true } });
  return normalizeCommandRestrictions(settings?.commandRestrictions);
}

export async function getGamblingState(guildId: string): Promise<GamblingState> {
  return readCommandsEnabled(await loadRules(guildId), GAMBLING_COMMANDS) as GamblingState;
}

/** Ouvre ou ferme des jeux. Un jeu absent de `games` garde son état. */
export async function setGamblingState(guildId: string, games: Partial<GamblingState>): Promise<GamblingState> {
  const rules = withGamblingEnabled(await loadRules(guildId), games);
  const commandRestrictions = rules as unknown as Prisma.InputJsonValue;
  await prisma.dashboardSettings.upsert({
    where: { guildId },
    update: { commandRestrictions },
    create: { guildId, commandRestrictions },
  });
  return readCommandsEnabled(rules, GAMBLING_COMMANDS) as GamblingState;
}
