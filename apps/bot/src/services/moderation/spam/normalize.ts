/**
 * spam/normalize.ts - Normalisation de contenu et mesure de similarité.
 *
 * Les campagnes de spam varient leurs messages à la marge (emoji ajouté,
 * caractère cyrillique, espace insécable) pour casser les comparaisons exactes.
 * On ramène donc tout à une forme canonique avant de comparer, et on compare
 * par trigrammes de caractères plutôt qu'à l'identique.
 */

/**
 * Homoglyphes fréquents dans les campagnes de phishing : cyrillique et grec qui
 * se rendent visuellement comme du latin. Repliés vers leur équivalent latin
 * pour que `dіscord` (i cyrillique) et `discord` se comparent.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillique
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o', р: 'p',
  ѕ: 's', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd', ɡ: 'g', ν: 'v',
  // Grec
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  // Divers
  ʟ: 'l', ɪ: 'i', ѵ: 'v', ѡ: 'w',
};

/** Caractères invisibles utilisés pour casser les filtres. */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;

/** Mentions, emojis personnalisés et timestamps : du bruit pour la comparaison. */
const DISCORD_TOKENS_RE = /<(?:@[!&]?\d+|#\d+|a?:\w+:\d+|t:\d+(?::[tTdDfFR])?)>/g;

const URL_RE = /https?:\/\/\S+/gi;
const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg)\/[\w-]+/i;

export function containsUrl(text: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}

export function containsInvite(text: string): boolean {
  return INVITE_RE.test(text);
}

/**
 * Forme canonique d'un message : décomposition unicode, suppression des
 * diacritiques et des caractères invisibles, repli des homoglyphes, retrait des
 * jetons Discord, minuscules, espaces compactés.
 *
 * Les URLs sont réduites à leur hôte : deux liens de tracking différents vers
 * le même domaine de scam doivent se comparer comme identiques.
 */
export function normalizeContent(text: string): string {
  if (!text) return '';

  let out = text
    .replace(INVISIBLE_RE, '')
    .replace(DISCORD_TOKENS_RE, ' ')
    .replace(URL_RE, (url) => {
      const match = /^https?:\/\/([^/\s?#]+)/i.exec(url);
      return match ? ` url:${match[1].toLowerCase()} ` : ' url ';
    })
    .normalize('NFKD')
    // Diacritiques combinants
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  out = [...out].map((ch) => HOMOGLYPHS[ch] ?? ch).join('');

  return out
    .replace(/[^\p{L}\p{N}\s:.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Détecte une obfuscation unicode délibérée :
 *  - caractères invisibles ;
 *  - mots mélangeant plusieurs alphabets (latin + cyrillique dans le même mot).
 *
 * Un texte entièrement cyrillique ou entièrement grec est parfaitement
 * légitime : seul le *mélange à l'intérieur d'un mot* est un signal.
 */
export function detectUnicodeObfuscation(text: string): { detected: boolean; reason?: string } {
  INVISIBLE_RE.lastIndex = 0;
  if (INVISIBLE_RE.test(text)) {
    return { detected: true, reason: 'caractères invisibles' };
  }

  for (const word of text.split(/\s+/)) {
    if (word.length < 4) continue;
    let latin = 0;
    let cyrillic = 0;
    let greek = 0;
    for (const ch of word) {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
      else if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
      else if (code >= 0x0370 && code <= 0x03ff) greek++;
    }
    const scripts = [latin, cyrillic, greek].filter((n) => n > 0).length;
    if (scripts > 1) {
      return { detected: true, reason: `alphabets mélangés dans « ${word.slice(0, 24)} »` };
    }
  }

  return { detected: false };
}

/** Trigrammes de caractères, avec bornes de mot pour stabiliser les courts textes. */
function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/**
 * Similarité de Jaccard sur les trigrammes, dans [0, 1].
 *
 * Robuste aux petites variations (un mot ajouté, un caractère changé) là où une
 * comparaison exacte casse, et bien moins coûteuse qu'une distance d'édition
 * sur des messages longs.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (!a || !b) return 0;

  // Deux textes très courts se ressemblent trop facilement : « ok » et « oki »
  // partagent l'essentiel de leurs trigrammes sans rien vouloir dire.
  if (a.length < 6 || b.length < 6) return a === b ? 1 : 0;

  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}
