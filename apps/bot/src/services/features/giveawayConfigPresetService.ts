/**
 * Sauvegardes nommées des réglages giveaway d'un serveur.
 *
 * L'onglet Configuration n'écrit qu'une ligne par serveur : une apparence de
 * fin d'année remplacée par la suivante était perdue, et il fallait ressaisir
 * couleurs, gabarits et conditions de mémoire pour y revenir. Une sauvegarde
 * fige l'état d'un instant sous un nom, et la page la réapplique d'un clic.
 */
import type { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { normalizeGiveawayConfigPatch, type GiveawayConfigPatch } from './giveawayConfigService.js';

export interface GiveawayConfigPreset {
  id: string;
  guildId: string;
  name: string;
  settings: GiveawayConfigPatch;
  createdAt: Date;
  updatedAt: Date;
}

type PresetRow = {
  id: string;
  guildId: string;
  name: string;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const MAX_NAME_LENGTH = 80;

function toPreset(row: PresetRow): GiveawayConfigPreset {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    // Relue et non servie telle quelle : une sauvegarde peut dater d'avant un
    // resserrage de la validation, et ce qui n'y survit plus disparaît ici
    // plutôt que de repartir vers les colonnes.
    settings: normalizeGiveawayConfigPatch(
      row.settings && typeof row.settings === 'object' ? row.settings as Record<string, unknown> : {},
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizePresetName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`Le nom de la sauvegarde doit contenir entre 1 et ${MAX_NAME_LENGTH} caractères.`);
  }
  return name;
}

/** La plus récente d'abord : on réapplique presque toujours la dernière mise de côté. */
export async function listGiveawayConfigPresets(guildId: string): Promise<GiveawayConfigPreset[]> {
  const rows = await prisma.giveawayConfigPreset.findMany({
    where: { guildId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((row) => toPreset(row as unknown as PresetRow));
}

async function assertNameFree(guildId: string, name: string, exceptId?: string): Promise<void> {
  const existing = await prisma.giveawayConfigPreset.findFirst({
    where: {
      guildId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new Error('Une sauvegarde porte déjà ce nom sur ce serveur.');
}

export async function createGiveawayConfigPreset(
  guildId: string,
  name: string,
  settings: Record<string, unknown>,
): Promise<GiveawayConfigPreset> {
  const cleanName = normalizePresetName(name);
  await assertNameFree(guildId, cleanName);

  const row = await prisma.giveawayConfigPreset.create({
    data: {
      guildId,
      name: cleanName,
      settings: normalizeGiveawayConfigPatch(settings) as Prisma.InputJsonValue,
    },
  });
  return toPreset(row as unknown as PresetRow);
}

/**
 * Réécrit une sauvegarde existante.
 *
 * Geste demandé explicitement : l'enregistrement ordinaire en crée une, il ne
 * touche jamais à celles déjà en place. Sans `settings`, seul le nom change,
 * ce qui sert au renommage depuis la liste.
 */
export async function updateGiveawayConfigPreset(
  guildId: string,
  presetId: string,
  name: string,
  settings?: Record<string, unknown>,
): Promise<GiveawayConfigPreset> {
  const cleanName = normalizePresetName(name);

  const current = await prisma.giveawayConfigPreset.findFirst({
    where: { id: presetId, guildId },
    select: { id: true },
  });
  if (!current) throw new Error('Sauvegarde introuvable sur ce serveur.');
  await assertNameFree(guildId, cleanName, presetId);

  const row = await prisma.giveawayConfigPreset.update({
    where: { id: presetId },
    data: {
      name: cleanName,
      ...(settings
        ? { settings: normalizeGiveawayConfigPatch(settings) as Prisma.InputJsonValue }
        : {}),
    },
  });
  return toPreset(row as unknown as PresetRow);
}

export async function deleteGiveawayConfigPreset(guildId: string, presetId: string): Promise<boolean> {
  const deleted = await prisma.giveawayConfigPreset.deleteMany({ where: { id: presetId, guildId } });
  return deleted.count > 0;
}
