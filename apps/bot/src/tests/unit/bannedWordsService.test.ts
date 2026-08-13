/**
 * Tests unitaires pour containsBannedWord et isNicknameProblematic.
 *
 * Vérifie que la détection combinée (token exact + frontières Unicode + substring long)
 * fonctionne de manière générique, et que les sécurités anti-boucle (automod)
 * fonctionnent correctement.
 */

import { describe, it, expect } from 'bun:test';
import { containsBannedWord } from '../../services/moderation/bannedWordsService.js';
import { isNicknameProblematic } from '../../services/moderation/nicknameModerationService.js';

describe('containsBannedWord - Détection automatique', () => {
  // ---------------------------------------------------------------------------
  // Faux positifs à NE PAS flagguer (doit retourner false)
  // ---------------------------------------------------------------------------
  describe('Faux positifs (ne doit PAS flagguer)', () => {
    const fauxPositifs = [
      { text: 'cacao', banned: ['caca'], reason: 'caca est un sous-mot' },
      { text: 'Xavier', banned: ['xav'], reason: 'xav est un sous-mot' },
      { text: 'assassin', banned: ['ass'], reason: 'ass est un sous-mot' },
      { text: 'classique', banned: ['lass'], reason: 'lass est un sous-mot' },
      { text: 'cocasse', banned: ['caca'], reason: 'caca est un sous-mot' },
      { text: 'patapon', banned: ['pat'], reason: 'pat est un sous-mot' },
      { text: 'r2d2', banned: ['r', 'd'], reason: 'les chiffres ne sont pas des séparateurs' },
      { text: 'super2man', banned: ['man'], reason: 'les chiffres ne sont pas des séparateurs' },
      { text: 'bidon', banned: ['bi'], reason: 'mot banni court (< 4c) en bord de pseudo' },
      { text: '', banned: ['caca'], reason: 'pseudo vide' },
      { text: '   ', banned: ['caca'], reason: "pseudo composé uniquement d'espaces" },
      { text: 'caca', banned: ['', '   '], reason: 'mots bannis vides' },
    ];

    for (const { text, banned, reason } of fauxPositifs) {
      it(`ignore "${text}" avec la liste [${banned.join(', ')}] (${reason})`, () => {
        expect(containsBannedWord(text, banned)).toBe(false);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Vrais positifs (DOIT flagguer / retourner true)
  // ---------------------------------------------------------------------------
  describe('Vrais positifs (DOIT flagguer)', () => {
    const vraisPositifs = [
      { text: 'caca', banned: ['caca'], reason: 'mot exact' },
      { text: 'caca lol', banned: ['caca'], reason: 'début de mot composé' },
      { text: 'super caca', banned: ['caca'], reason: 'fin de mot composé' },
      { text: 'le-caca-lol', banned: ['caca'], reason: 'séparateur tiret' },
      { text: 'pseudo_caca', banned: ['caca'], reason: 'séparateur underscore' },
      { text: 'caca123', banned: ['caca'], reason: 'frontière de chiffre (non-lettre)' },
      { text: 'CACA', banned: ['caca'], reason: 'insensible à la casse' },
      { text: 'caca!lol', banned: ['caca'], reason: 'frontière de ponctuation' },
      { text: 'ass-boy', banned: ['ass'], reason: 'séparateur tiret' },
      { text: 'je suis caca', banned: ['sale', 'caca', 'merde'], reason: 'un mot de la liste correspond' },
    ];

    for (const { text, banned, reason } of vraisPositifs) {
      it(`flaggue "${text}" avec la liste [${banned.join(', ')}] (${reason})`, () => {
        expect(containsBannedWord(text, banned)).toBe(true);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Substring match pour mots longs (≥ 6c)
  // ---------------------------------------------------------------------------
  describe('Substring match mots longs (seuil ≥ 6c)', () => {
    const substringCases = [
      { text: 'connerieman', banned: ['connerie'], expected: true, reason: 'connerie (8c ≥ 6) est un mot long' },
      { text: 'leputaindetruc', banned: ['putain'], expected: true, reason: 'putain (6c ≥ 6) est un mot long' },
      { text: 'sonofbitch0139', banned: ['bitch'], expected: false, reason: 'bitch (5c < 6) est sous le seuil' },
      { text: 'fichier', banned: ['chier'], expected: false, reason: 'chier (5c < 6) est sous le seuil' },
      { text: 'supermerdedu', banned: ['merde'], expected: false, reason: 'merde (5c < 6) est sous le seuil' },
      { text: 'cacao', banned: ['caca'], expected: false, reason: 'caca (4c < 6) est sous le seuil' },
      { text: 'cacahuète', banned: ['caca'], expected: false, reason: 'caca (4c < 6) est sous le seuil' },
    ];

    for (const { text, banned, expected, reason } of substringCases) {
      it(`${expected ? 'flaggue' : 'ignore'} "${text}" avec la liste [${banned.join(', ')}] (${reason})`, () => {
        expect(containsBannedWord(text, banned)).toBe(expected);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Cas limites / Spécificités
  // ---------------------------------------------------------------------------
  describe('Cas limites', () => {
    const edgeCases = [
      { text: 'éléphant', banned: ['éléphant'], expected: true, reason: 'caractères accentués' },
      { text: 'réélection', banned: ['ré'], expected: false, reason: 'mot court avec accents' },
      { text: 'caca', banned: [], expected: false, reason: 'liste de mots vide' },
      { text: 'caca', banned: ['  caca  '], expected: true, reason: 'mot banni avec espaces superflus' },
    ];

    for (const { text, banned, expected, reason } of edgeCases) {
      it(`${expected ? 'flaggue' : 'ignore'} "${text}" avec la liste [${banned.join(', ')}] (${reason})`, () => {
        expect(containsBannedWord(text, banned)).toBe(expected);
      });
    }
  });
});

describe('isNicknameProblematic - Sécurités & Whitelist', () => {
  it('ignore le pseudo de remplacement exact (SAFE_NICKNAME)', () => {
    expect(isNicknameProblematic('pseudo non conforme | automod', ['con', 'caca'])).toBe(false);
    expect(isNicknameProblematic('  Pseudo Non Conforme | AutoMod  ', ['con', 'caca'])).toBe(false);
  });

  it('ne bypass pas les variations contenant "automod" ou "pseudo non conforme" si elles contiennent des mots bannis', () => {
    expect(isNicknameProblematic('caca automod', ['caca'])).toBe(true);
    expect(isNicknameProblematic('pseudo non conforme caca', ['caca'])).toBe(true);
  });

  it('ignore les pseudos de la whitelist du serveur', () => {
    expect(isNicknameProblematic('cacao_meow', ['caca'], { whitelist: ['cacao_meow'] })).toBe(false);
    expect(isNicknameProblematic('fichier.py', ['chier'], { whitelist: ['fichier.py'] })).toBe(false);
  });

  it('ignore les membres exemptés (bypass)', () => {
    expect(isNicknameProblematic('caca', ['caca'], { userId: '123456', bypassUserIds: ['123456'] })).toBe(false);
  });

  it('flaggue les pseudos réellement problématiques', () => {
    expect(isNicknameProblematic('caca', ['caca'])).toBe(true);
    expect(isNicknameProblematic('le-caca-lol', ['caca'])).toBe(true);
  });

  it('ne flaggue pas les pseudos propres', () => {
    expect(isNicknameProblematic('pseudo_propre', ['caca'])).toBe(false);
  });
});
