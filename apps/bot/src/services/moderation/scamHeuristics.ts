/**
 * scamHeuristics.ts - Briques pures de détection d'arnaques (aucune base, aucun réseau).
 *
 * Les campagnes de faux giveaway (« MrBeast offre 3 500 $ à tous ceux qui
 * s'inscrivent sur notre casino, code promo TAKE ») n'ont ni lien Nitro ni
 * domaine ressemblant à Discord : un filtre par motifs de domaine ne les voit
 * pas. Ce qui les trahit, c'est la combinaison : un appât (giveaway, bonus), un
 * code promo, un décor crypto/casino, une célébrité, de l'urgence. Aucun de ces
 * signaux n'est suspect seul ; c'est leur cumul que l'on score.
 *
 * Ce module sert trois usages :
 *  - bloquer un message (score + lien),
 *  - décider ce que le honeypot enregistre,
 *  - analyser le texte lu dans une image (OCR).
 */

import { createHash } from 'node:crypto';

// ── Domaines ────────────────────────────────────────────────────────────────

// Domaines légitimes qui ne doivent jamais être bloqués.
export const LEGIT_DOMAINS = new Set([
  'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.gift',
  'steamcommunity.com', 'steampowered.com', 'store.steampowered.com',
]);

/**
 * Domaines qu'on ne doit jamais enregistrer ni bloquer, même s'ils apparaissent
 * dans un message piégé : un bot de spam colle indifféremment un lien YouTube et
 * un lien de phishing, et apprendre « youtube.com » ruinerait la base.
 * Les raccourcisseurs y figurent : bloquer bit.ly bloquerait des millions de
 * liens légitimes, il faudrait raisonner au niveau de l'URL complète.
 */
const BENIGN_DOMAINS = new Set([
  ...LEGIT_DOMAINS,
  'google.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'facebook.com',
  'instagram.com', 'tiktok.com', 'twitch.tv', 'reddit.com', 'github.com', 'gitlab.com',
  'wikipedia.org', 'tenor.com', 'giphy.com', 'imgur.com', 'spotify.com', 'amazon.com',
  'paypal.com', 'microsoft.com', 'apple.com', 'telegram.org', 't.me', 'whatsapp.com',
  'bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'goo.gl',
  'linktr.ee', 'carrd.co', 'notion.so', 'docs.google.com', 'drive.google.com',
]);

/**
 * Hébergeurs mutualisés : le domaine enregistrable est celui de la plateforme,
 * pas celui de l'arnaqueur. On garde l'hôte complet (`promo.vercel.app`) au lieu
 * de remonter à `vercel.app`, qui serait bloqué pour tout le monde.
 */
const SHARED_HOSTING_SUFFIXES = [
  'vercel.app', 'pages.dev', 'workers.dev', 'netlify.app', 'github.io', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'weebly.com', 'wixsite.com',
  'glitch.me', 'replit.app', 'repl.co', 'ngrok.io', 'ngrok-free.app', 'onrender.com',
  'framer.website', 'webflow.io', 'my.canva.site',
];

// Suffixes publics à deux niveaux les plus courants (liste volontairement courte).
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'com.br', 'com.au', 'co.jp', 'co.in', 'com.tr', 'com.mx', 'co.za',
]);

// TLD retenus pour reconnaître un nom de domaine sans schéma (« sedowin.com »).
// Liste fermée : accepter n'importe quel suffixe prendrait « fichier.js » ou
// « Mr.Beast » pour des domaines.
const BARE_DOMAIN_TLDS = [
  'com', 'net', 'org', 'io', 'xyz', 'top', 'site', 'online', 'club', 'vip', 'win', 'bet',
  'casino', 'gg', 'app', 'dev', 'co', 'info', 'biz', 'live', 'fun', 'cc', 'me', 'tv', 'ru',
  'gift', 'cash', 'money', 'games', 'game', 'pro', 'shop', 'store', 'link', 'click', 'cloud',
  'icu', 'cfd', 'sbs', 'life', 'world', 'one', 'ws', 'to', 'ly', 'fr', 'de', 'uk', 'us', 'ca',
  'eu', 'in', 'tk', 'ml', 'ga', 'cf', 'gq', 'rest', 'bond', 'monster',
].join('|');

const SCHEME_URL = /\bhttps?:\/\/([^\s/?#<>()[\]"'`]+)/gi;
const BARE_DOMAIN = new RegExp(
  `(?<![@\\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${BARE_DOMAIN_TLDS}))(?![a-z0-9-])`,
  'gi'
);

/** Caractères invisibles ou de largeur nulle, utilisés pour casser les filtres. */
const INVISIBLE_CHARS = new RegExp('[\\u200B-\\u200F\\u2060\\u2066-\\u2069\\uFEFF\\u00AD]', 'g');

/** Aplatit les variantes d'écriture : plein-chasse, invisibles, liens « défanged ». */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, '.')
    .replace(/\bhxxps?:\/\//gi, (m) => m.replace(/hxxp/i, 'http'));
}

function cleanHost(raw: string): string | null {
  let host = raw.toLowerCase().replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.+$/, '');
  host = host.replace(/^www\./, '');
  if (!host.includes('.') || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/** Domaines (sans `www.`) présents dans un texte, avec ou sans schéma. */
export function extractDomains(text: string): string[] {
  const folded = foldText(text);
  const found = new Set<string>();

  for (const match of folded.matchAll(SCHEME_URL)) {
    const host = cleanHost(match[1]);
    if (host) found.add(host);
  }
  for (const match of folded.matchAll(BARE_DOMAIN)) {
    const host = cleanHost(match[1]);
    if (host) found.add(host);
  }
  return [...found];
}

function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isBenignDomain(host: string): boolean {
  for (const benign of BENIGN_DOMAINS) {
    if (matchesSuffix(host, benign)) return true;
  }
  return false;
}

/**
 * Forme sous laquelle un hôte est enregistré : `go.sedowin.com` → `sedowin.com`
 * (le sous-domaine est jetable), mais `promo.vercel.app` reste tel quel.
 */
export function registrableDomain(host: string): string {
  for (const suffix of SHARED_HOSTING_SUFFIXES) {
    if (host.endsWith(`.${suffix}`)) {
      const labels = host.slice(0, -suffix.length - 1).split('.');
      return `${labels[labels.length - 1]}.${suffix}`;
    }
  }
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Domaines d'un texte qui méritent d'être enregistrés comme suspects. */
export function suspiciousDomainsOf(text: string): string[] {
  const out = new Set<string>();
  for (const host of extractDomains(text)) {
    if (isBenignDomain(host)) continue;
    out.add(registrableDomain(host));
  }
  return [...out];
}

// ── Score textuel ───────────────────────────────────────────────────────────

type Signal = { id: string; weight: number; pattern: RegExp };

const SIGNALS: Signal[] = [
  {
    id: 'giveaway',
    weight: 3,
    pattern: /giving\s+away|give\s?away|free\s+(?:money|bonus|crypto)|claim\s+(?:your|the)\s+(?:reward|bonus|prize)|\bbonus\b|\breward\b|gratuit|cadeau|offert|je\s+(?:offre|donne)/i,
  },
  {
    id: 'promo_code',
    weight: 3,
    pattern: /promo(?:tion(?:al)?)?\s*[- ]?code|bonus\s+code|(?:enter|use|apply)\s+(?:the\s+)?(?:special\s+)?(?:promo\s+)?code|code\s+promo|code\s+bonus/i,
  },
  {
    id: 'crypto_casino',
    weight: 2,
    pattern: /casino|crypto(?:currency)?|\busdt\b|\busdc\b|\bbtc\b|bitcoin|\beth\b|ethereum|airdrop|withdraw|wallet|retrait|portefeuille|jackpot|slots?\b/i,
  },
  {
    id: 'celebrity',
    weight: 2,
    pattern: /mr\.?\s?beast|jimmy\s+donaldson|elon\s+musk|pewdiepie|kai\s+cenat|ishowspeed|\bxqc\b|\bdrake\b|\bninja\b|\bsqueezie\b|\binoxtag\b|\bmichou\b|\bamixem\b/i,
  },
  {
    id: 'everyone',
    weight: 2,
    pattern: /(?:to|for)\s+everyone\s+who|everyone\s+who\s+(?:register|sign)|à\s+tous\s+ceux\s+qui|first\s+\d+\s+(?:people|users|members)|les\s+\d+\s+premiers/i,
  },
  {
    id: 'urgency',
    weight: 1,
    pattern: /will\s+be\s+deleted|hurry|limited\s+(?:time|offer)|only\s+today|fastest|don'?t\s+miss|expire|dépêche|offre\s+limitée|temps\s+limité|ne\s+(?:rate|ratez)\s+pas/i,
  },
  {
    id: 'big_amount',
    weight: 1,
    pattern: /[$€£]\s?\d{1,3}(?:[,. ]\d{3})+|[$€£]\s?\d{3,}|\d{3,}\s?(?:\$|€|usd|usdt|eur)\b/i,
  },
];

/** Cumul minimal pour considérer un texte comme un faux giveaway. */
const MIN_SCORE = 8;
const MIN_DISTINCT_SIGNALS = 4;

export type ScamTextScore = {
  score: number;
  signals: string[];
};

export function scoreScamText(text: string): ScamTextScore {
  const folded = foldText(text);
  const signals: string[] = [];
  let score = 0;
  for (const signal of SIGNALS) {
    if (signal.pattern.test(folded)) {
      signals.push(signal.id);
      score += signal.weight;
    }
  }
  return { score, signals };
}

/**
 * Faux giveaway ? Il faut un appât (giveaway ou code promo), un décor
 * (crypto/casino ou célébrité) et un cumul suffisant. Le simple mot « bonus »
 * dans une annonce de serveur ne passe pas : il manque le reste.
 */
export function looksLikeFakeGiveaway(text: string): (ScamTextScore & { matched: boolean }) {
  const result = scoreScamText(text);
  const has = (id: string) => result.signals.includes(id);
  const matched =
    result.score >= MIN_SCORE &&
    result.signals.length >= MIN_DISTINCT_SIGNALS &&
    (has('giveaway') || has('promo_code')) &&
    (has('crypto_casino') || has('celebrity'));
  return { ...result, matched };
}

// ── Empreinte de texte ──────────────────────────────────────────────────────

/** En dessous, un texte est trop générique pour servir d'empreinte (« hello »). */
export const MIN_FINGERPRINT_LENGTH = 40;
const MAX_SAMPLE_LENGTH = 600;

/**
 * Texte réduit à ce qui ne varie pas d'une diffusion à l'autre : les montants,
 * les liens, les mentions et la casse changent, la prose reste.
 */
export function normalizeScamText(text: string): string {
  return foldText(text)
    .toLowerCase()
    .replace(/<@[!&]?\d+>|<#\d+>|<a?:\w+:\d+>/g, ' ')
    .replace(/@(?:everyone|here)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' <url> ')
    .replace(BARE_DOMAIN, ' <url> ')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/[^\p{L}\p{N}#<> ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SAMPLE_LENGTH);
}

export function fingerprintText(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
