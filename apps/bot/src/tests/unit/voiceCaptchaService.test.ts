import { describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { PermissionFlagsBits } from 'discord.js';

const prismaMock = {
  captchaSession: {
    findFirst: mock(async () => null),
    update: mock(async () => ({})),
  },
  raidProtectionConfig: { findMany: mock(async () => []) },
};

const moduleMocks: Array<[string, () => Record<string, unknown>]> = [
  ['../../utils/db', () => ({ default: prismaMock, prisma: prismaMock, prismaRead: prismaMock })],
  ['../../utils/logger', () => ({
    logger: {
      info: mock(() => undefined),
      warn: mock(() => undefined),
      error: mock(() => undefined),
      debug: mock(() => undefined),
    },
  })],
  ['../../services/moderation/raidProtectionService', () => ({
    getRaidProtectionConfig: mock(async () => null),
  })],
];

for (const [relativePath, factory] of moduleMocks) {
  mock.module(path.resolve(import.meta.dir, `${relativePath}.ts`), factory);
  mock.module(path.resolve(import.meta.dir, `${relativePath}.js`), factory);
}

const {
  alphabetFor,
  VOICE_LOCALES,
  VOICE_CODE_LENGTH,
  generateVoiceCode,
  estimateTurnMs,
  checkUnverifiedRoleAccess,
  normalizeVoiceLocale,
} = await import('../../services/moderation/voiceCaptchaService.js');

const UNVERIFIED_ROLE_ID = '444444444444444444';

function voiceChannelDouble(rolePermissions: { view: boolean; connect: boolean } | null) {
  const role = { id: UNVERIFIED_ROLE_ID, name: 'Non-vérifié' };
  return {
    guild: { roles: { cache: new Map(rolePermissions ? [[UNVERIFIED_ROLE_ID, role]] : []) } },
    permissionsFor: () =>
      rolePermissions
        ? {
            has: (flag: bigint) =>
              flag === PermissionFlagsBits.ViewChannel ? rolePermissions.view : rolePermissions.connect,
          }
        : null,
  } as never;
}

describe('alphabets vocaux', () => {
  test("l'anglais évite les symboles qui riment, faute de voix articulée", () => {
    // Le pack anglais n'a que la synthèse : B/C/D/E/G/P/T/V y riment tous et
    // M/N restent proches. Les inclure ferait échouer des membres humains sur
    // une simple ambiguïté sonore. Z reste admis, "zee" ne rimant qu'avec des
    // symboles justement exclus. Le français dispose d'une voix humaine et n'a
    // donc pas cette restriction.
    for (const confusable of 'BCDEGPTVNFIOWY01') {
      expect(alphabetFor('EN')).not.toContain(confusable);
    }
  });

  for (const locale of VOICE_LOCALES) {
    test(`${locale} ne contient aucun doublon`, () => {
      const alphabet = alphabetFor(locale);
      expect(new Set(alphabet).size).toBe(alphabet.length);
    });

    test(`${locale} dispose d'un clip pour chaque symbole`, () => {
      // Invariant central : un symbole tirable sans clip correspondant
      // produirait un code amputé à l'énonciation, donc invalidable.
      const dir = path.resolve(import.meta.dir, `../../../assets/captcha-voice/${locale.toLowerCase()}`);
      const present = new Set(
        readdirSync(dir).filter((f) => f.endsWith('.ogg')).map((f) => f.split('-')[0])
      );

      for (const symbol of alphabetFor(locale)) expect(present).toContain(symbol);
    });
  }
});

describe('normalizeVoiceLocale', () => {
  test('accepte les langues connues, quelle que soit la casse', () => {
    expect(normalizeVoiceLocale('FR')).toBe('FR');
    expect(normalizeVoiceLocale('en')).toBe('EN');
  });

  test('retombe sur le français plutôt que de chercher un pack inexistant', () => {
    // Une valeur inattendue en base ne doit pas priver le serveur du mode vocal.
    expect(normalizeVoiceLocale(null)).toBe('FR');
    expect(normalizeVoiceLocale('ES')).toBe('FR');
  });
});

describe('generateVoiceCode', () => {
  for (const locale of VOICE_LOCALES) {
    test(`produit un code ${locale} de la bonne longueur, dans le bon alphabet`, () => {
      for (let i = 0; i < 200; i++) {
        const code = generateVoiceCode(locale);
        expect(code).toHaveLength(VOICE_CODE_LENGTH);
        for (const symbol of code) expect(alphabetFor(locale)).toContain(symbol);
      }
    });
  }

  test('ne renvoie pas deux fois la même valeur sur un petit échantillon', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateVoiceCode()));
    expect(codes.size).toBeGreaterThan(90);
  });
});

describe('checkUnverifiedRoleAccess', () => {
  const config = { captchaUnverifiedRoleId: UNVERIFIED_ROLE_ID } as never;

  test('accepte un rôle qui voit le salon sans pouvoir s’y connecter', () => {
    const result = checkUnverifiedRoleAccess(voiceChannelDouble({ view: true, connect: false }), config);
    expect(result.ok).toBe(true);
  });

  test('refuse un rôle qui ne voit pas le salon', () => {
    const result = checkUnverifiedRoleAccess(voiceChannelDouble({ view: false, connect: false }), config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('ne voit pas');
  });

  test('refuse un rôle qui peut se connecter librement', () => {
    // Sinon tous les arrivants s'entassent dans le salon et chacun entend le
    // code des autres : l'isolation un par un ne tient plus.
    const result = checkUnverifiedRoleAccess(voiceChannelDouble({ view: true, connect: true }), config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Se connecter');
  });

  test('refuse une configuration sans rôle non-vérifié', () => {
    const result = checkUnverifiedRoleAccess(voiceChannelDouble(null), { captchaUnverifiedRoleId: null } as never);
    expect(result.ok).toBe(false);
  });
});

describe('estimateTurnMs', () => {
  test("reste sous le plafond qui rendrait la file plus longue que le délai d'expiration", () => {
    // 25 membres (limite de file par défaut) doivent tenir sous 10 minutes,
    // valeur par défaut de captchaTimeoutMinutes.
    for (const locale of VOICE_LOCALES) {
      expect(estimateTurnMs(locale) * 25).toBeLessThan(10 * 60 * 1000);
    }
  });
});
