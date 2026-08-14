/**
 * Service générique de gestion des mots bannis.
 *
 * Utilisable par plusieurs modules :
 *  - Modération des pseudos (nicknameModeration.ts)
 *  - Modération des messages (future automod)
 *  - Tout autre système nécessitant un filtre de contenu
 *
 * Les mots sont stockés en BDD (table `banned_words`) :
 *  - guildId = null → mots globaux (liste de base, read-only côté dashboard serveur)
 *  - guildId = <id> → mots personnalisés par serveur
 */

import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Regex - caractères invisibles/non affichables
// ---------------------------------------------------------------------------

/**
 * Regex partagée pour détecter les textes composés uniquement de caractères
 * invisibles ou non affichables (espaces zero-width, soft hyphen, BOM, etc.)
 */
export const INVISIBLE_ONLY_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /^[\s\u200B\u200C\u200D\u00AD\uFEFF\u2060\u180E\u00A0\u2000-\u200A\u202F\u205F\u3000]+$/;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type CacheEntry = {
  words: string[];
  expiresAt: number;
};

/** Cache par guildId (ou '__global__' pour les mots globaux) */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

const GLOBAL_KEY = '__global__';

/**
 * Invalide le cache pour un serveur donné.
 * Si aucun guildId n'est fourni, vide entièrement le cache.
 */
export function invalidateBannedWordsCache(guildId?: string): void {
  if (guildId) {
    cache.delete(guildId);
    cache.delete(GLOBAL_KEY); // les mots globaux font partie du résultat, on les re-fetch aussi
    return;
  }
  cache.clear();
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

/** Charge les mots globaux (guildId = null) depuis la BDD, avec cache. */
export async function loadGlobalWords(): Promise<string[]> {
  const cached = cache.get(GLOBAL_KEY);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.words;

  try {
    const rows = await prisma.bannedWord.findMany({
      where: { guildId: null, enabled: true },
      select: { word: true },
    });
    const words = rows.map((r) => r.word.toLowerCase());
    cache.set(GLOBAL_KEY, { words, expiresAt: now + CACHE_TTL_MS });
    return words;
  } catch (err) {
    logger.error('BannedWords', 'Erreur lors du chargement des mots globaux:', err);
    return [];
  }
}

/**
 * Charge la liste fusionnée des mots bannis pour un serveur :
 * mots globaux + mots personnalisés du serveur.
 * Le résultat est mis en cache 60 secondes.
 */
export async function loadBannedWords(guildId: string): Promise<string[]> {
  const cached = cache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.words;

  try {
    const [globalWords, guildRows] = await Promise.all([
      loadGlobalWords(),
      prisma.bannedWord.findMany({
        where: { guildId, enabled: true },
        select: { word: true },
      }),
    ]);

    const guildWords = guildRows.map((r) => r.word.toLowerCase());
    // Dédoublonnage global + serveur
    const merged = [...new Set([...globalWords, ...guildWords])];
    cache.set(guildId, { words: merged, expiresAt: now + CACHE_TTL_MS });
    return merged;
  } catch (err) {
    logger.error('BannedWords', `Erreur lors du chargement pour le serveur ${guildId}:`, err);
    return [];
  }
}

/**
 * Charge uniquement les mots bannis personnalisés d'un serveur (sans les globaux).
 * Utile quand le toggle "mots globaux" est désactivé.
 */
export async function loadCustomWords(guildId: string): Promise<string[]> {
  const cacheKey = `${guildId}__custom`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.words;

  try {
    const rows = await prisma.bannedWord.findMany({
      where: { guildId, enabled: true },
      select: { word: true },
    });
    const words = rows.map((r) => r.word.toLowerCase());
    cache.set(cacheKey, { words, expiresAt: now + CACHE_TTL_MS });
    return words;
  } catch (err) {
    logger.error('BannedWords', `Erreur lors du chargement des mots personnalisés pour ${guildId}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Détection
// ---------------------------------------------------------------------------

/**
 * Caractères alphabétiques Unicode (latin de base + accents courants).
 * Utilisé pour construire des frontières de mots Unicode-aware.
 */
const ALPHA = 'a-zA-ZÀ-ÖØ-öø-ÿ\u0400-\u04FF';

/**
 * Séparateurs utilisés pour la tokenisation du pseudo :
 * espaces, ponctuation et symboles Unicode.
 * Les chiffres sont intentionnellement exclus pour préserver des pseudos
 * comme "r2d2" ou "super2man" en un seul token.
 */
const TOKEN_SPLIT_REGEX = /[\s\p{P}\p{S}]+/u;

/**
 * Longueur minimale d'un mot banni pour que la vérification par regex
 * (frontières de mot) soit appliquée.
 * Les mots plus courts passent uniquement par l'exact token match,
 * ce qui évite des faux positifs sur des abréviations de 1-3 lettres
 * qui pourraient se retrouver en bord de mot accidentellement.
 */
const MIN_REGEX_WORD_LENGTH = 4;

/**
 * Longueur minimale d'un mot banni pour déclencher le substring match
 * (présence directe dans le pseudo, même sans frontière de mot).
 * Seuil à 6 pour éviter les faux positifs sur des mots courts comme
 * "chier" (5c) présent dans "fichier" qui est un terme légitime.
 * Ex : "connerie" (8c) dans "connerieman", "putain" (6c) dans "leputaindetruc".
 */
const MIN_SUBSTRING_WORD_LENGTH = 6;

/**
 * Échappe les caractères spéciaux d'une chaîne pour l'utiliser dans une regex.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Vérifie si un texte contient au moins un mot banni.
 *
 * Stratégie à trois niveaux pour minimiser les faux positifs :
 *
 * 1. **Exact token match** : découpe le pseudo sur les séparateurs (espaces,
 *    tirets, underscores, points - chiffres exclus) et compare chaque token
 *    exactement au mot banni.
 *    → "le-caca_lol" → ["le","caca","lol"] → "caca" matche ✓
 *    → "cacao" → ["cacao"] ≠ "caca" → pas flaggé ✓
 *    → "r2d2" → ["r2d2"] → token préservé ✓
 *
 * 2. **Regex avec frontières Unicode** (mots ≥ 4 caractères) :
 *    vérifie que le mot banni n'est pas précédé ni suivi d'une lettre.
 *    Couvre les cas de mots collés à un non-lettre (ex : "caca!lol", "caca123").
 *    Les mots < 4c sont exclus pour éviter les faux positifs sur abréviations.
 *
 * 3. **Substring match pour mots longs** (mots ≥ 6 caractères) :
 *    un mot de 6+ lettres est assez spécifique pour être considéré intentionnel
 *    même au cœur d'un pseudo composé. Le seuil à 6 évite les faux positifs
 *    sur des mots de 5 lettres comme "chier" présent dans "fichier".
 *    → "connerieman" + "connerie" (8c) → flaggé ✓
 *    → "leputaindetruc" + "putain" (6c) → flaggé ✓
 *    → "fichier" + "chier" (5c) → non déclenché (< 6c) → pas flaggé ✓
 *    → "cacao" + "caca" (4c) → non déclenché (< 6c) → pas flaggé ✓
 *
 * @param text  Le texte à analyser (pseudo, message, etc.)
 * @param words Liste de mots bannis déjà chargée via `loadBannedWords`
 */
export function containsBannedWord(text: string, words: string[]): boolean {
  if (!text || text.trim().length === 0) return false;

  const normalized = text.toLowerCase();
  const tokens = normalized.split(TOKEN_SPLIT_REGEX).filter(Boolean);

  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) continue;

    // 1. Exact token match (le pseudo découpé contient exactement ce mot)
    if (tokens.includes(trimmed)) return true;

    // 2. Regex avec frontières de caractères alphabétiques Unicode.
    //    Uniquement pour les mots de longueur suffisante (≥ 4c).
    if (trimmed.length >= MIN_REGEX_WORD_LENGTH) {
      const pattern = `(?<![${ALPHA}])${escapeRegex(trimmed)}(?![${ALPHA}])`;
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(normalized)) return true;
      } catch {
        // Fallback de sécurité si la regex échoue (mot avec caractères spéciaux)
        if (normalized.includes(trimmed)) return true;
      }
    }

    // 3. Substring match pour les mots bannis longs (≥ 5c).
    //    Un mot aussi long dans un pseudo composé est intentionnel.
    if (trimmed.length >= MIN_SUBSTRING_WORD_LENGTH && normalized.includes(trimmed)) return true;
  }

  return false;
}
