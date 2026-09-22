/**
 * Garde-fou contre la redivergence des types d'objet RPG.
 *
 * Quatre declarations ont longtemps decrit la meme chose sans jamais se
 * croiser : le catalogue livre, la route d'ecriture, le schema zod de l'outil
 * MCP et le commentaire du schema Prisma. Aucune n'etait verifiee a
 * l'execution, si bien qu'un type ajoute d'un seul cote ne se voyait nulle
 * part - le parcours de configuration envoyait des ACCESSORY et des MATERIAL
 * que la route n'annoncait pas, et l'outil MCP acceptait un USABLE qui ne
 * correspondait a rien.
 *
 * RPG_ITEM_TYPES fait desormais foi. Ces tests echouent si une declaration
 * s'en ecarte.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EQUIPPABLE_RPG_ITEM_TYPES,
  RPG_ITEM_TYPES,
  getEnchantment,
  isRpgItemType,
} from '@kotbo/contracts';
import { RPG_ITEMS } from '../../services/features/rpg/rpgContent.js';
import { itemTypeIcon } from '../../services/features/rpg/rpgIcons.js';
import { isEquipmentSlot, slotForItemType } from '../../services/features/rpg/rpgEquipment.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('types d objet RPG', () => {
  test('le catalogue livre n utilise que des types connus', () => {
    const unknown = [...new Set(RPG_ITEMS.map((item) => item.type))].filter(
      (type) => !isRpgItemType(type),
    );
    expect(unknown, `Types absents de RPG_ITEM_TYPES : ${unknown.join(', ')}`).toEqual([]);
  });

  test('le schema zod de l outil MCP est aligne sur la liste de reference', () => {
    // L'outil construit son enum a partir de RPG_ITEM_TYPES : ce test protege
    // contre un retour a une liste ecrite a la main, qui est ce qui avait
    // laisse passer USABLE.
    const source = readSource('apps/bot/src/api/mcp/tools/write-members-new.ts');
    expect(source).toContain('z.enum(RPG_ITEM_TYPES)');
    expect(source).not.toMatch(/z\.enum\(\[\s*'WEAPON'/);
  });

  test('le commentaire du schema Prisma enumere exactement la liste de reference', () => {
    const schema = readSource('packages/database/prisma/economy.prisma');
    const documented = schema
      .split('\n')
      .find((line) => line.includes('WEAPON |'));

    expect(documented, 'Commentaire de RpgItem.type introuvable').toBeDefined();
    for (const type of RPG_ITEM_TYPES) {
      expect(documented, `${type} absent du commentaire du schema`).toContain(type);
    }
  });

  test('chaque type a une icone qui lui est propre', () => {
    // Un type sans entree retombait sur le sac : deux familles differentes
    // portaient alors le meme glyphe, sans que rien ne le signale.
    const icons = RPG_ITEM_TYPES.map((type) => itemTypeIcon(type));
    expect(new Set(icons).size).toBe(RPG_ITEM_TYPES.length);
  });

  test('les types equipables sont ceux qui ont un emplacement', () => {
    for (const type of RPG_ITEM_TYPES) {
      const slot = slotForItemType(type);
      const equippable = (EQUIPPABLE_RPG_ITEM_TYPES as readonly string[]).includes(type);
      expect(
        Boolean(slot),
        `${type} : emplacement ${slot ?? 'aucun'} alors que equipable vaut ${equippable}`,
      ).toBe(equippable);
    }
  });

  test('tout parchemin livre designe un enchantement connu', () => {
    // Un SCROLL sans enchantement s'achete, se consomme, et ne fait rien. La
    // route refuse desormais d'en creer un ; le catalogue livre doit tenir la
    // meme regle.
    const scrolls = RPG_ITEMS.filter((item) => item.type === 'SCROLL');
    expect(scrolls.length).toBeGreaterThan(0);

    for (const scroll of scrolls) {
      expect(scroll.enchantId, `${scroll.name} ne pose aucun enchantement`).toBeTruthy();
      const enchantment = scroll.enchantId ? getEnchantment(scroll.enchantId) : null;
      expect(enchantment, `${scroll.name} : enchantement « ${scroll.enchantId} » inconnu`).not.toBeNull();
      if (enchantment && scroll.enchantTier !== undefined) {
        expect(scroll.enchantTier).toBeLessThanOrEqual(enchantment.maxTier);
      }
    }
  });

  test('isRpgItemType refuse ce qui ne figure pas dans la liste', () => {
    expect(isRpgItemType('USABLE')).toBe(false);
    expect(isRpgItemType('weapon')).toBe(false);
    expect(isRpgItemType('')).toBe(false);
    expect(isRpgItemType(null)).toBe(false);
  });
});

describe('emplacements d equipement', () => {
  // Les accessoires 2 et 3 etaient refuses par la forge et l'autel, qui tenaient leur
  // propre liste de trois emplacements.
  test('reconnait les cinq emplacements', () => {
    for (const slot of ['weapon', 'armor', 'accessory', 'accessory2', 'accessory3']) {
      expect(isEquipmentSlot(slot)).toBe(true);
    }
  });

  test('refuse les cles heritees et les valeurs inconnues', () => {
    for (const value of ['constructor', 'toString', '__proto__', 'accessory4', '']) {
      expect(isEquipmentSlot(value)).toBe(false);
    }
  });
});
