/**
 * Événements de voyage d'un serveur.
 *
 * Même logique que le bestiaire : les événements livrés de base sont globaux
 * (`guildId: null`) et partagés, personne ne les écrit. Un serveur qui en personnalise un
 * crée une copie locale portant le *même titre*, et c'est elle qui fait foi. Supprimer la
 * copie fait réapparaître l'original.
 *
 * Une copie sans aucun choix sert à retirer un événement livré du tirage : sans choix, il
 * n'aurait de toute façon aucun bouton à proposer au joueur.
 *
 * Tout tirage côté jeu passe par `listPlayableAdventureEvents` : lire directement
 * `prisma.rpgAdventureEvent` ferait tomber les joueurs sur un original masqué.
 */

import type { Prisma, RpgAdventureEvent } from '@prisma/client';
import prisma from '../../../utils/db.js';
import { assertGuildTitle } from './rpgTitleService.js';
import {
  AdventureEventError,
  normalizeAdventureEventInput,
  parseAdventureChoices,
  type AdventureChoice,
  type AdventureEventInput,
} from './rpgAdventureEventPolicy.js';

export {
  ADVENTURE_CHOICE_TEXT_MAX,
  ADVENTURE_CHOICES_MAX,
  ADVENTURE_DESCRIPTION_MAX,
  ADVENTURE_TITLE_MAX,
  AdventureEventError,
  type AdventureEventInput,
} from './rpgAdventureEventPolicy.js';

export type AdventureScope = 'GLOBAL' | 'GUILD';

export interface ResolvedAdventureEvent extends Omit<RpgAdventureEvent, 'choices'> {
  choices: AdventureChoice[];
  scope: AdventureScope;
  /** Copie locale qui masque un événement livré du même titre. */
  overridesGlobal: boolean;
  /** Faux pour un événement retiré du tirage (copie sans choix). */
  enabled: boolean;
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function resolve(rows: RpgAdventureEvent[]): ResolvedAdventureEvent[] {
  const globals = rows.filter((row) => row.guildId === null);
  const locals = rows.filter((row) => row.guildId !== null);
  const masksGlobal = (row: RpgAdventureEvent) => globals.some((global) => sameTitle(global.title, row.title));

  return rows
    .filter((row) => !(row.guildId === null && locals.some((local) => sameTitle(local.title, row.title))))
    .map((row) => {
      const choices = parseAdventureChoices(row.choices);
      return {
        ...row,
        choices,
        scope: row.guildId === null ? ('GLOBAL' as const) : ('GUILD' as const),
        overridesGlobal: row.guildId !== null && masksGlobal(row),
        enabled: choices.length > 0,
      };
    });
}

/** Tous les événements du serveur, retirés du tirage compris. Réservé au dashboard. */
export async function listGuildAdventureEvents(guildId: string): Promise<ResolvedAdventureEvent[]> {
  const rows = await prisma.rpgAdventureEvent.findMany({
    where: { OR: [{ guildId: null }, { guildId }] },
    orderBy: [{ title: 'asc' }],
  });
  return resolve(rows);
}

/** Événements que le tirage d'un voyage peut proposer. */
export async function listPlayableAdventureEvents(guildId: string): Promise<ResolvedAdventureEvent[]> {
  return (await listGuildAdventureEvents(guildId)).filter((event) => event.enabled);
}

async function findOwnedOrGlobal(guildId: string, eventId: string): Promise<RpgAdventureEvent> {
  const event = await prisma.rpgAdventureEvent.findUnique({ where: { id: eventId } });
  if (!event || (event.guildId !== null && event.guildId !== guildId)) {
    throw new AdventureEventError('Événement introuvable.', 404);
  }
  return event;
}

async function findLocalByTitle(guildId: string, title: string, exceptId?: string) {
  return prisma.rpgAdventureEvent.findFirst({
    where: { guildId, title: { equals: title.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
}

/**
 * Crée ou modifie un événement du serveur.
 *
 * Modifier un événement livré en crée la copie locale. Le titre d'une copie reste celui de
 * l'original : c'est lui qui fait le masquage, le changer ferait réapparaître l'original à
 * côté de sa version modifiée.
 */
export async function saveGuildAdventureEvent(
  guildId: string,
  input: AdventureEventInput,
  eventId?: string,
): Promise<{ event: ResolvedAdventureEvent; created: boolean }> {
  const data = normalizeAdventureEventInput(input);
  for (const choice of data.choices) {
    await assertGuildTitle(guildId, choice.titleId).catch((err: Error) => {
      throw new AdventureEventError(err.message, 400);
    });
  }

  const globals = await prisma.rpgAdventureEvent.findMany({ where: { guildId: null }, select: { title: true } });
  const globalTitle = (title: string) => globals.find((global) => sameTitle(global.title, title))?.title ?? null;

  let saved: RpgAdventureEvent;
  let created = false;

  if (eventId) {
    const existing = await findOwnedOrGlobal(guildId, eventId);

    if (existing.guildId === null) {
      const copy = await findLocalByTitle(guildId, existing.title);
      const payload = { ...data, title: existing.title, choices: data.choices as unknown as Prisma.InputJsonValue };
      saved = copy
        ? await prisma.rpgAdventureEvent.update({ where: { id: copy.id }, data: payload })
        : await prisma.rpgAdventureEvent.create({ data: { ...payload, guildId } });
      created = !copy;
    } else {
      const lockedTitle = globalTitle(existing.title);
      const title = lockedTitle ?? data.title;
      if (!lockedTitle) {
        if (globalTitle(title)) {
          throw new AdventureEventError('Ce titre est celui d’un événement livré : personnalisez celui-ci plutôt.', 409);
        }
        if (await findLocalByTitle(guildId, title, existing.id)) {
          throw new AdventureEventError(`Un événement se nomme déjà « ${title} ».`, 409);
        }
      }
      saved = await prisma.rpgAdventureEvent.update({
        where: { id: existing.id },
        data: { ...data, title, choices: data.choices as unknown as Prisma.InputJsonValue },
      });
    }
  } else {
    if (globalTitle(data.title)) {
      throw new AdventureEventError('Ce titre est celui d’un événement livré : personnalisez celui-ci plutôt.', 409);
    }
    if (await findLocalByTitle(guildId, data.title)) {
      throw new AdventureEventError(`Un événement se nomme déjà « ${data.title} ».`, 409);
    }
    saved = await prisma.rpgAdventureEvent.create({
      data: { ...data, guildId, choices: data.choices as unknown as Prisma.InputJsonValue },
    });
    created = true;
  }

  const resolved = (await listGuildAdventureEvents(guildId)).find((event) => event.id === saved.id);
  if (!resolved) throw new AdventureEventError('Événement introuvable après enregistrement.', 500);
  return { event: resolved, created };
}

/**
 * Retire un événement livré du tirage, ou l'y remet.
 *
 * Seuls les événements livrés se désactivent : ceux du serveur se suppriment. Une copie
 * personnalisée doit d'abord être rétablie, pour ne pas jeter ses choix sans prévenir.
 */
export async function setGlobalAdventureEventEnabled(
  guildId: string,
  eventId: string,
  enabled: boolean,
): Promise<{ title: string }> {
  const event = await findOwnedOrGlobal(guildId, eventId);
  const original = event.guildId === null
    ? event
    : await prisma.rpgAdventureEvent.findFirst({ where: { guildId: null, title: { equals: event.title, mode: 'insensitive' } } });
  if (!original) throw new AdventureEventError('Seuls les événements livrés se désactivent : supprimez plutôt celui-ci.', 400);

  const copy = await findLocalByTitle(guildId, original.title);

  if (enabled) {
    if (copy && parseAdventureChoices(copy.choices).length === 0) {
      await prisma.rpgAdventureEvent.delete({ where: { id: copy.id } });
    }
    return { title: original.title };
  }

  if (copy && parseAdventureChoices(copy.choices).length > 0) {
    throw new AdventureEventError('Cet événement est personnalisé : rétablissez l’original avant de le désactiver.', 409);
  }
  if (!copy) {
    await prisma.rpgAdventureEvent.create({
      data: {
        guildId,
        title: original.title,
        description: original.description,
        emoji: original.emoji,
        choices: [] as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { title: original.title };
}

/** Supprime un événement du serveur. Supprimer une copie rétablit l'événement livré. */
export async function deleteGuildAdventureEvent(
  guildId: string,
  eventId: string,
): Promise<{ title: string; restoredGlobal: boolean }> {
  const event = await findOwnedOrGlobal(guildId, eventId);
  if (event.guildId === null) {
    throw new AdventureEventError('Un événement livré ne se supprime pas : désactivez-le.', 400);
  }

  const restoredGlobal = Boolean(
    await prisma.rpgAdventureEvent.findFirst({ where: { guildId: null, title: { equals: event.title, mode: 'insensitive' } } }),
  );
  await prisma.rpgAdventureEvent.delete({ where: { id: event.id } });
  return { title: event.title, restoredGlobal };
}
