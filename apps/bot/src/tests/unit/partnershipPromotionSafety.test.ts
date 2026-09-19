import { describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

// Le service importe Prisma et le client Discord au chargement. Seule la
// neutralisation du texte est testée : c'est la barrière entre un contenu écrit
// par un partenaire et ce que le bot du serveur finit par poster.
const noop = mock(() => Promise.resolve(null));
const mockDb = new Proxy({}, { get: () => new Proxy({}, { get: () => noop }) });

for (const dbPath of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(__dirname, dbPath), () => ({
    default: mockDb,
    prisma: mockDb,
    prismaRead: mockDb,
  }));
}

for (const clientPath of ['../../utils/client.ts', '../../utils/client.js']) {
  mock.module(path.resolve(__dirname, clientPath), () => ({
    getClient: () => ({ guilds: { fetch: noop } }),
    setClient: () => undefined,
  }));
}

const { defuse } = await import('../../services/partnerships/partnershipPromotionService.js');

/** Espace de largeur nulle inséré par la neutralisation. */
const ZERO_WIDTH = String.fromCharCode(0x200b);

describe('neutralisation du contenu partenaire', () => {
  test('@everyone ne peut plus mentionner', () => {
    const result = defuse('Rejoignez-nous @everyone !');
    expect(result).not.toContain('@everyone');
    expect(result).toContain(`@${ZERO_WIDTH}everyone`);
  });

  test('@here est traité de la même façon', () => {
    expect(defuse('salut @here')).toContain(`@${ZERO_WIDTH}here`);
  });

  test('la casse ne permet pas de contourner', () => {
    expect(defuse('@EveryOne @HERE')).not.toMatch(/@(everyone|here)/i);
  });

  test('une mention de rôle devient un libellé inerte', () => {
    const result = defuse('coucou <@&123456789012345678>');
    expect(result).not.toContain('<@&');
    expect(result).toContain('rôle');
  });

  test('une mention de membre devient un libellé inerte', () => {
    expect(defuse('merci <@123456789012345678>')).not.toContain('<@1');
    expect(defuse('merci <@!123456789012345678>')).not.toContain('<@!');
  });

  test('plusieurs mentions dans le même texte sont toutes neutralisées', () => {
    const result = defuse('@everyone <@&111> <@222> @here');
    expect(result).not.toMatch(new RegExp(`@(everyone|here)(?!${ZERO_WIDTH})`, 'i'));
    expect(result).not.toContain('<@&111>');
    expect(result).not.toContain('<@222>');
  });

  test('le texte ordinaire est laissé intact', () => {
    const texte = 'Serveur francophone, 1 200 membres, entraide et jeux.';
    expect(defuse(texte)).toBe(texte);
  });

  test("une adresse contenant @ n'est pas abîmée", () => {
    expect(defuse('contact : hello@exemple.fr')).toContain('hello@exemple.fr');
  });

  test('un texte vide reste vide', () => {
    expect(defuse('')).toBe('');
  });
});
