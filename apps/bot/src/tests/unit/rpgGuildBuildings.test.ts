import { describe, expect, test } from 'bun:test';
import {
  GUILD_PERK_CAPS,
  RPG_GUILD_BUILDINGS,
  aggregateGuildPerks,
  currentTier,
  discountedPrice,
  getGuildBuilding,
  maxBuildingLevel,
  nextTier,
} from '../../services/features/rpg/rpgGuildBuildings.js';

describe('catalogue du village de guilde', () => {
  test('les identifiants de bâtiments sont uniques', () => {
    // `buildingId` est la clé stockée en base : un doublon ferait pointer deux bâtiments
    // sur la même ligne de progression.
    const duplicates = RPG_GUILD_BUILDINGS
      .map((building) => building.id)
      .filter((id, index, all) => all.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('chaque bâtiment a au moins un palier, et chacun un effet décrit', () => {
    for (const building of RPG_GUILD_BUILDINGS) {
      expect(building.tiers.length).toBeGreaterThan(0);
      for (const tier of building.tiers) {
        expect(tier.effect.length).toBeGreaterThan(0);
        // Un palier sans avantage coûterait du trésor sans rien changer au jeu.
        expect(Object.keys(tier.perks).length).toBeGreaterThan(0);
      }
    }
  });

  test('coûts et niveaux de guilde croissent de palier en palier', () => {
    for (const building of RPG_GUILD_BUILDINGS) {
      for (let i = 1; i < building.tiers.length; i++) {
        expect(building.tiers[i].cost).toBeGreaterThan(building.tiers[i - 1].cost);
        expect(building.tiers[i].guildLevel).toBeGreaterThanOrEqual(building.tiers[i - 1].guildLevel);
      }
    }
  });

  test('les paliers d un même bâtiment sont croissants sur chaque avantage', () => {
    // Les paliers se REMPLACENT : un palier supérieur moins généreux serait un
    // downgrade payant, exactement l'inverse de ce que le joueur achète.
    for (const building of RPG_GUILD_BUILDINGS) {
      for (let i = 1; i < building.tiers.length; i++) {
        const previous = building.tiers[i - 1].perks;
        const current = building.tiers[i].perks;
        for (const [key, value] of Object.entries(previous)) {
          expect(current[key as keyof typeof current] ?? 0).toBeGreaterThanOrEqual(value as number);
        }
      }
    }
  });

  test('aucun palier ne dépasse à lui seul le plafond de son avantage', () => {
    for (const building of RPG_GUILD_BUILDINGS) {
      for (const tier of building.tiers) {
        for (const [key, cap] of Object.entries(GUILD_PERK_CAPS)) {
          const value = tier.perks[key as keyof typeof tier.perks] ?? 0;
          expect(value).toBeLessThanOrEqual(cap);
        }
      }
    }
  });
});

describe('paliers', () => {
  test('rien de bâti : pas de palier actif, le premier est le suivant', () => {
    const market = getGuildBuilding('market')!;

    expect(currentTier(market, 0)).toBeNull();
    expect(nextTier(market, 0)).toBe(market.tiers[0]);
  });

  test('au maximum : plus de palier suivant', () => {
    const market = getGuildBuilding('market')!;
    const max = maxBuildingLevel(market);

    expect(currentTier(market, max)).toBe(market.tiers[max - 1]);
    expect(nextTier(market, max)).toBeNull();
  });

  test('un niveau stocké au-delà du catalogue retombe sur le dernier palier', () => {
    // Le catalogue peut avoir été réduit depuis la construction : la ligne survit en
    // base, mais elle ne doit pas lire hors du tableau.
    const market = getGuildBuilding('market')!;
    expect(currentTier(market, 99)).toBe(market.tiers[market.tiers.length - 1]);
  });
});

describe('aggregateGuildPerks', () => {
  test('un palier remplace le précédent au lieu de s y ajouter', () => {
    // Échoppe niveau 3 vaut −18 %, pas −5 % −10 % −18 %.
    const perks = aggregateGuildPerks([{ buildingId: 'market', level: 3 }]);
    expect(perks.shopDiscount).toBeCloseTo(0.18, 5);
  });

  test('des bâtiments différents se cumulent', () => {
    const perks = aggregateGuildPerks([
      { buildingId: 'barracks', level: 1 },
      { buildingId: 'vault', level: 1 },
    ]);

    expect(perks.attackFlat).toBe(3);
    expect(perks.defenseFlat).toBe(3);
    expect(perks.coinBonus).toBeCloseTo(0.06, 5);
  });

  test('ignore un bâtiment absent du catalogue', () => {
    const perks = aggregateGuildPerks([{ buildingId: 'batiment_supprime', level: 3 }]);
    expect(perks.shopDiscount).toBe(0);
  });

  test('un niveau zéro n accorde rien', () => {
    const perks = aggregateGuildPerks([{ buildingId: 'market', level: 0 }]);
    expect(perks.shopDiscount).toBe(0);
  });
});

describe('discountedPrice', () => {
  test('sans remise, le prix ne bouge pas', () => {
    expect(discountedPrice(250, 0)).toBe(250);
  });

  test('applique la remise et arrondit', () => {
    expect(discountedPrice(200, 0.18)).toBe(164);
  });

  test('ne descend jamais sous une pièce', () => {
    // Une boutique qui donne n'est plus une boutique.
    expect(discountedPrice(1, GUILD_PERK_CAPS.shopDiscount)).toBe(1);
  });

  test('borne une remise au-delà du plafond', () => {
    const capped = discountedPrice(1000, 0.9);
    expect(capped).toBe(discountedPrice(1000, GUILD_PERK_CAPS.shopDiscount));
  });
});
