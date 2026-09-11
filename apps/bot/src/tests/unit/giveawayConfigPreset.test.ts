import { describe, expect, test, beforeEach, mock } from 'bun:test';
import path from 'node:path';

/**
 * Sauvegardes nommées des réglages giveaway. Deux promesses tiennent la
 * fonctionnalité : un enregistrement ne touche pas aux sauvegardes déjà en
 * place, et ce qu'on réapplique ne porte que des valeurs encore valides. Une
 * sauvegarde écrite il y a six mois traverse des versions du validateur, et
 * elle repart vers les colonnes de configuration sans repasser par un
 * formulaire.
 */

type PresetRow = { id: string; guildId: string; name: string; settings: unknown; createdAt: Date; updatedAt: Date };

let rows: PresetRow[] = [];
let created: Record<string, unknown> | null = null;
let updated: Record<string, unknown> | null = null;

const row = (over: Partial<PresetRow> = {}): PresetRow => ({
  id: 'p1',
  guildId: '1',
  name: 'Noël',
  settings: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const mockDb = {
  giveawayConfigPreset: {
    findMany: mock(() => Promise.resolve(rows)),
    findFirst: mock((args?: any) => {
      const name = args?.where?.name?.equals;
      const exceptId = args?.where?.id?.not;
      const id = typeof args?.where?.id === 'string' ? args.where.id : null;
      const found = rows.find((entry) => (
        (id === null || entry.id === id)
        && (!name || entry.name.toLowerCase() === String(name).toLowerCase())
        && (!exceptId || entry.id !== exceptId)
      ));
      return Promise.resolve(found ?? null);
    }),
    create: mock((args: any) => {
      created = args.data;
      return Promise.resolve(row({ ...args.data, id: 'new' }));
    }),
    update: mock((args: any) => {
      updated = args.data;
      return Promise.resolve(row({ ...args.data, id: args.where.id }));
    }),
    deleteMany: mock((args: any) => Promise.resolve({
      count: rows.filter((entry) => entry.id === args.where.id && entry.guildId === args.where.guildId).length,
    })),
  },
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const {
  createGiveawayConfigPreset,
  deleteGiveawayConfigPreset,
  listGiveawayConfigPresets,
  updateGiveawayConfigPreset,
} = await import('../../services/features/giveawayConfigPresetService');
const { normalizeGiveawayConfigPatch } = await import('../../services/features/giveawayConfigService');

beforeEach(() => {
  rows = [];
  created = null;
  updated = null;
});

describe('normalizeGiveawayConfigPatch', () => {
  test('ne retient que les clefs reçues', () => {
    const patch = normalizeGiveawayConfigPatch({ minLevel: 5 });

    expect(patch.minLevel).toBe(5);
    expect('minAccountAgeDays' in patch).toBe(false);
    expect('managerRoleIds' in patch).toBe(false);
  });

  test('écarte les valeurs qu\'un réglage ne peut pas prendre', () => {
    const patch = normalizeGiveawayConfigPatch({
      managerRoleIds: ['123456789012345678', 'pas-un-role'],
      defaultChannelId: 'salon',
      clanBonusWeight: 1,
      embedColorActive: 'rouge',
    });

    expect(patch.managerRoleIds).toEqual(['123456789012345678']);
    expect(patch.defaultChannelId).toBeNull();
    // Un poids de 1 n'avantage personne : la case cochée le dirait pourtant.
    expect(patch.clanBonusWeight).toBe(2);
    expect(patch.embedColorActive).toBeUndefined();
  });
});

describe('createGiveawayConfigPreset', () => {
  test('refuse un nom vide', async () => {
    await expect(createGiveawayConfigPreset('1', '   ', {})).rejects.toThrow();
    expect(created).toBeNull();
  });

  test('refuse un nom déjà pris, à la casse près', async () => {
    rows = [row({ name: 'Noël' })];
    await expect(createGiveawayConfigPreset('1', 'noël', {})).rejects.toThrow();
    expect(created).toBeNull();
  });

  test('fige les réglages validés sous le nom demandé', async () => {
    const preset = await createGiveawayConfigPreset('1', '  Été  ', {
      minLevel: 3,
      requiredRoleIds: ['123456789012345678'],
      inconnu: 'ignoré',
    });

    expect(preset.name).toBe('Été');
    expect(created?.name).toBe('Été');
    expect(created?.settings).toEqual({ minLevel: 3, requiredRoleIds: ['123456789012345678'] });
  });
});

describe('updateGiveawayConfigPreset', () => {
  test('renomme sans toucher aux réglages figés', async () => {
    rows = [row({ id: 'p1', name: 'Noël' })];
    await updateGiveawayConfigPreset('1', 'p1', 'Fêtes');

    expect(updated?.name).toBe('Fêtes');
    expect('settings' in (updated ?? {})).toBe(false);
  });

  test('refuse le nom d\'une autre sauvegarde', async () => {
    rows = [row({ id: 'p1', name: 'Noël' }), row({ id: 'p2', name: 'Été' })];
    await expect(updateGiveawayConfigPreset('1', 'p1', 'Été')).rejects.toThrow();
    expect(updated).toBeNull();
  });
});

describe('listGiveawayConfigPresets', () => {
  test('relit les réglages : ce qui n\'est plus valide ne repart pas vers les colonnes', async () => {
    rows = [row({ settings: { minLevel: 4, embedColorActive: 'rouge', defaultChannelId: 'salon' } })];

    const [preset] = await listGiveawayConfigPresets('1');

    expect(preset.settings.minLevel).toBe(4);
    expect(preset.settings.embedColorActive).toBeUndefined();
    expect(preset.settings.defaultChannelId).toBeNull();
  });
});

describe('deleteGiveawayConfigPreset', () => {
  test('ne supprime rien sur un autre serveur', async () => {
    rows = [row({ id: 'p1', guildId: '2' })];
    expect(await deleteGiveawayConfigPreset('1', 'p1')).toBe(false);
  });
});
