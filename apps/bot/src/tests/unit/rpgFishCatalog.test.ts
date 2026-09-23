import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FISH,
  normalizeFishInput,
  resolveFishCatalog,
  rollFishSpecies,
  type GuildFishRow,
} from '../../services/features/rpg/rpgFishCatalog.js';

const row = (overrides: Partial<GuildFishRow>): GuildFishRow => ({
  id: 'row',
  name: 'Anguille',
  emoji: '🐍',
  rarity: 'RARE',
  value: 30,
  xp: 12,
  enabled: true,
  ...overrides,
});

describe('catalogue des poissons', () => {
  test('sans personnalisation, le serveur pêche les espèces livrées', () => {
    const catalog = resolveFishCatalog([]);
    expect(catalog).toHaveLength(DEFAULT_FISH.length);
    expect(catalog.every((fish) => fish.scope === 'DEFAULT' && fish.id === null)).toBe(true);
  });

  test('une ligne du serveur remplace l\'espèce livrée du même nom, sans doublon', () => {
    const catalog = resolveFishCatalog([row({ id: 'x', name: 'Sardine', rarity: 'COMMON', value: 99 })]);
    const sardines = catalog.filter((fish) => fish.name === 'Sardine');
    expect(sardines).toHaveLength(1);
    expect(sardines[0]).toMatchObject({ value: 99, scope: 'GUILD', overridesDefault: true, id: 'x' });
  });

  test('les créations du serveur rejoignent leur rareté', () => {
    const catalog = resolveFishCatalog([row({})]);
    const rares = catalog.filter((fish) => fish.rarity === 'RARE').map((fish) => fish.name);
    expect(rares).toContain('Anguille');
    expect(catalog.findIndex((fish) => fish.name === 'Anguille')).toBeLessThan(catalog.findIndex((fish) => fish.rarity === 'EPIC'));
  });

  test('le tirage ignore les espèces désactivées et les raretés vides', () => {
    const catalog = [
      { name: 'A', rarity: 'COMMON', enabled: false },
      { name: 'B', rarity: 'LEGENDARY', enabled: true },
    ];
    expect(rollFishSpecies(catalog, () => 0)?.name).toBe('B');
    expect(rollFishSpecies(catalog, () => 0.999)?.name).toBe('B');
  });

  test('rien à pêcher quand tout est désactivé', () => {
    expect(rollFishSpecies([{ rarity: 'COMMON', enabled: false }])).toBeNull();
  });

  test('la saisie borne les gains et refuse une rareté inconnue', () => {
    expect(normalizeFishInput({ name: ' Carpe ', value: -5, xp: 1e9 })).toEqual({
      ok: true,
      value: { name: 'Carpe', emoji: '🐟', rarity: 'COMMON', value: 0, xp: 10_000, enabled: true },
    });
    expect(normalizeFishInput({ name: 'Carpe', rarity: 'MYTHIC' }).ok).toBe(false);
    expect(normalizeFishInput({ name: '' }).ok).toBe(false);
  });
});
