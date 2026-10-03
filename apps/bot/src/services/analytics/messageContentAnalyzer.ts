/**
 * messageContentAnalyzer.ts
 *
 * Transforme un message en compteurs de contenu : type principal, styles
 * markdown, emojis, stickers, GIF, domaines cités. Fonction pure, sans accès à
 * Discord ni à la base : le tracker live et le rattrapage depuis message_logs
 * lui passent la même forme d'entrée, déjà normalisée.
 *
 * Rien de ce qui sort d'ici n'est du texte de message : des booléens, des ids
 * d'emoji, des caractères emoji et des noms de domaine.
 */

/** Colonnes de `message_content_daily_stats`, dans l'ordre du schéma. */
export const CONTENT_COUNTER_COLUMNS = [
  'messages', 'withEmoji', 'withMarkdown', 'withLink', 'withMedia', 'reactedMessages',
  'typeText', 'typeImage', 'typeGif', 'typeVideo', 'typeSticker', 'typeFile', 'typeAudio',
  'typeVoice', 'typePoll', 'typeLink', 'typeForward',
  'styleReply', 'styleMention', 'styleThread', 'styleEdited', 'emojiOnly',
  'lenShort', 'lenMedium', 'lenLong',
  'mdBold', 'mdItalic', 'mdUnderline', 'mdStrike', 'mdSpoiler', 'mdInlineCode', 'mdCodeBlock',
  'mdQuote', 'mdHeading', 'mdList', 'mdMaskedLink', 'mdSubtext',
  'emojiUnicode', 'emojiGuild', 'emojiExternal', 'emojiAnimated',
  'stickerGuild', 'stickerExternal', 'stickerStandard',
  'gifTenor', 'gifGiphy', 'gifUpload', 'gifOther',
  'reactUnicode', 'reactGuild', 'reactExternal',
] as const;

export type ContentCounter = (typeof CONTENT_COUNTER_COLUMNS)[number];
export type ContentCounters = Partial<Record<ContentCounter, number>>;

export type MessageType =
  | 'text' | 'image' | 'gif' | 'video' | 'sticker' | 'file' | 'audio'
  | 'voice' | 'poll' | 'link' | 'forward';

export type StickerOrigin = 'guild' | 'external' | 'standard';
export type GifSource = 'tenor' | 'giphy' | 'upload' | 'other';

export interface ContentAttachment {
  name?: string | null;
  contentType?: string | null;
}

export interface ContentSticker {
  id: string;
  name: string;
  origin: StickerOrigin;
}

export interface ContentInput {
  content: string;
  attachments: ContentAttachment[];
  stickers: ContentSticker[];
  /** L'emoji personnalisé appartient-il au serveur où le message est posté ? */
  isGuildEmoji: (emojiId: string) => boolean;
  isVoiceMessage?: boolean;
  hasPoll?: boolean;
  isForward?: boolean;
  isReply?: boolean;
  hasMention?: boolean;
  inThread?: boolean;
}

export interface CustomEmojiUse {
  id: string;
  name: string;
  animated: boolean;
  origin: 'guild' | 'external';
}

export interface ContentAnalysis {
  type: MessageType;
  counters: ContentCounters;
  customEmojis: CustomEmojiUse[];
  /** Caractères emoji Unicode, normalisés (sans sélecteur de variante). */
  unicodeEmojis: string[];
  /** Domaines distincts cités dans le message. */
  domains: string[];
  stickers: ContentSticker[];
}

const CUSTOM_EMOJI_RE = /<(a?):(\w{2,32}):(\d{17,20})>/g;
// Pictogramme étendu avec ses modificateurs (teinte, ZWJ, variante), paire de
// drapeaux, ou touche numérotée (1️⃣).
const UNICODE_EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;
const URL_RE = /https?:\/\/[^\s<>"'`|)\]]+/gi;
const MENTION_RE = /<(?:@[!&]?|#)\d{17,20}>|<t:\d+(?::[a-zA-Z])?>|<\/[\w -]+:\d{17,20}>/g;

const SHORT_MAX = 20;
const LONG_MIN = 200;

/** Domaines qui désignent le même site. */
const DOMAIN_ALIASES: Record<string, string> = {
  'youtu.be': 'youtube.com',
  'music.youtube.com': 'youtube.com',
  'twitter.com': 'x.com',
  'fxtwitter.com': 'x.com',
  'vxtwitter.com': 'x.com',
  'fixupx.com': 'x.com',
  'fixvx.com': 'x.com',
  'redd.it': 'reddit.com',
  'vm.tiktok.com': 'tiktok.com',
  'vt.tiktok.com': 'tiktok.com',
  'ddinstagram.com': 'instagram.com',
  'instagr.am': 'instagram.com',
  'open.spotify.com': 'spotify.com',
  'spoti.fi': 'spotify.com',
  'discordapp.com': 'discord.com',
  'discord.new': 'discord.com',
  'media.discordapp.net': 'discord.com',
  'cdn.discordapp.com': 'discord.com',
  'store.steampowered.com': 'steampowered.com',
  'steamcommunity.com': 'steampowered.com',
  'gph.is': 'giphy.com',
};

/** Suffixes à deux niveaux (co.uk…) : le domaine enregistrable en a trois. */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'co.nz', 'com.br',
  'com.mx', 'co.in', 'gouv.fr', 'asso.fr', 'com.tr', 'co.kr', 'com.cn', 'com.ar',
]);

/**
 * Réduit une URL à un domaine stable : minuscules, sans www, alias fusionnés,
 * puis domaine enregistrable (deux ou trois labels). `null` pour une URL
 * illisible ou une adresse IP.
 */
export function normalizeDomain(rawUrl: string): string | null {
  let host: string;
  let path = '';
  try {
    const url = new URL(rawUrl);
    host = url.hostname.toLowerCase();
    path = url.pathname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^(www|m|mobile)\./, '').replace(/\.$/, '');
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null;

  // Les invitations Discord ont leur propre famille, quel que soit le domaine.
  if (host === 'discord.gg' || ((host === 'discord.com' || host === 'discordapp.com') && path.startsWith('/invite/'))) {
    return 'discord.gg';
  }

  const aliased = DOMAIN_ALIASES[host];
  if (aliased) return aliased;

  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const keep = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  const registrable = labels.slice(-keep).join('.');
  return DOMAIN_ALIASES[registrable] ?? registrable;
}

/** Provenance d'un GIF désigné par un lien, `null` si le lien n'est pas un GIF. */
export function gifSourceFromUrl(rawUrl: string): GifSource | null {
  let host: string;
  let path: string;
  try {
    const url = new URL(rawUrl);
    host = url.hostname.toLowerCase();
    path = url.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'tenor.com' || host.endsWith('.tenor.com')) return 'tenor';
  if (host === 'giphy.com' || host.endsWith('.giphy.com') || host === 'gph.is') return 'giphy';
  if (path.endsWith('.gif')) return 'other';
  return null;
}

function isGifAttachment(a: ContentAttachment): boolean {
  return a.contentType === 'image/gif' || /\.gif$/i.test(a.name ?? '');
}

function attachmentKind(a: ContentAttachment): 'image' | 'video' | 'audio' | 'file' {
  const type = (a.contentType ?? '').toLowerCase();
  const name = (a.name ?? '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|avif|heic|bmp)$/.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/.test(name)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|ogg|wav|flac|m4a|opus)$/.test(name)) return 'audio';
  return 'file';
}

/**
 * Styles markdown présents dans un message. Les emojis personnalisés, mentions
 * et liens sont retirés avant de chercher l'italique : leurs `_` et `*`
 * (`<:pepe_sad:…>`, `…/some_path_`) passeraient sinon pour de la mise en forme.
 */
export function detectMarkdown(content: string): ContentCounters {
  const found: ContentCounters = {};
  if (/\[[^\]\n]+\]\(\s*<?https?:\/\/[^)\s]+>?\s*\)/.test(content)) found.mdMaskedLink = 1;

  let rest = content;
  if (/```[\s\S]+?```/.test(rest)) found.mdCodeBlock = 1;
  rest = rest.replace(/```[\s\S]*?```/g, ' ');
  if (/`[^`\n]+`/.test(rest)) found.mdInlineCode = 1;
  rest = rest.replace(/`[^`\n]*`/g, ' ').replace(CUSTOM_EMOJI_RE, ' ').replace(MENTION_RE, ' ').replace(URL_RE, ' ');

  if (/^\s*>{1,3} ?\S/m.test(rest)) found.mdQuote = 1;
  if (/^\s*#{1,3} \S/m.test(rest)) found.mdHeading = 1;
  if (/^\s*-# \S/m.test(rest)) found.mdSubtext = 1;
  if (/^\s*(?:[-*]|\d{1,3}\.) +\S/m.test(rest)) found.mdList = 1;
  if (/\|\|[^|]+?\|\|/.test(rest)) found.mdSpoiler = 1;
  if (/~~(?!\s)[^~\n]+?~~/.test(rest)) found.mdStrike = 1;

  // ***texte*** est à la fois gras et italique.
  if (/\*\*\*(?!\s)[^*\n]+?\*\*\*/.test(rest)) {
    found.mdBold = 1;
    found.mdItalic = 1;
  }
  rest = rest.replace(/\*\*\*[^*\n]+?\*\*\*/g, ' ');
  if (/\*\*(?!\s)[^*\n]+?\*\*/.test(rest)) found.mdBold = 1;
  rest = rest.replace(/\*\*[^*\n]+?\*\*/g, ' ');
  if (/__(?!\s)[^_\n]+?__/.test(rest)) found.mdUnderline = 1;
  rest = rest.replace(/__[^_\n]+?__/g, ' ');
  // Italique : *x* ou _x_, sans coller à un mot (snake_case, 2*3*4).
  if (/(?:^|[^\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*])/m.test(rest)
    || /(?:^|[^\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_])/m.test(rest)) {
    found.mdItalic = 1;
  }
  return found;
}

function inc(counters: ContentCounters, key: ContentCounter, by = 1): void {
  counters[key] = (counters[key] ?? 0) + by;
}

const TYPE_COUNTER: Record<MessageType, ContentCounter> = {
  text: 'typeText', image: 'typeImage', gif: 'typeGif', video: 'typeVideo', sticker: 'typeSticker',
  file: 'typeFile', audio: 'typeAudio', voice: 'typeVoice', poll: 'typePoll', link: 'typeLink',
  forward: 'typeForward',
};

const GIF_COUNTER: Record<GifSource, ContentCounter> = {
  tenor: 'gifTenor', giphy: 'gifGiphy', upload: 'gifUpload', other: 'gifOther',
};

const STICKER_COUNTER: Record<StickerOrigin, ContentCounter> = {
  guild: 'stickerGuild', external: 'stickerExternal', standard: 'stickerStandard',
};

export function analyzeMessageContent(input: ContentInput): ContentAnalysis {
  const counters: ContentCounters = { messages: 1 };

  // Un message transféré montre le contenu de quelqu'un d'autre : il compte
  // comme transfert, sans analyse de texte qui lui attribuerait ce contenu.
  if (input.isForward) {
    counters.typeForward = 1;
    if (input.inThread) counters.styleThread = 1;
    return { type: 'forward', counters, customEmojis: [], unicodeEmojis: [], domains: [], stickers: [] };
  }

  const content = input.content ?? '';

  const customEmojis: CustomEmojiUse[] = [];
  for (const match of content.matchAll(CUSTOM_EMOJI_RE)) {
    const id = match[3]!;
    customEmojis.push({
      id,
      name: match[2]!,
      animated: match[1] === 'a',
      origin: input.isGuildEmoji(id) ? 'guild' : 'external',
    });
  }
  const withoutCustom = content.replace(CUSTOM_EMOJI_RE, ' ');
  const urls = [...withoutCustom.matchAll(URL_RE)].map((m) => m[0]);
  const withoutUrls = withoutCustom.replace(URL_RE, ' ').replace(MENTION_RE, ' ');
  const unicodeEmojis = [...withoutUrls.matchAll(UNICODE_EMOJI_RE)].map((m) => m[0].replace(/\uFE0F/g, ''));

  // Emojis
  for (const emoji of customEmojis) {
    inc(counters, emoji.origin === 'guild' ? 'emojiGuild' : 'emojiExternal');
    if (emoji.animated) inc(counters, 'emojiAnimated');
  }
  if (unicodeEmojis.length > 0) inc(counters, 'emojiUnicode', unicodeEmojis.length);
  const emojiCount = customEmojis.length + unicodeEmojis.length;
  if (emojiCount > 0) counters.withEmoji = 1;

  // Liens et GIF
  const domains = new Set<string>();
  let gifSource: GifSource | null = null;
  let hasPlainLink = false;
  for (const url of urls) {
    const gif = gifSourceFromUrl(url);
    if (gif) {
      gifSource ??= gif;
      continue;
    }
    const domain = normalizeDomain(url);
    if (domain) {
      domains.add(domain);
      hasPlainLink = true;
    }
  }
  if (hasPlainLink) counters.withLink = 1;

  // Pièces jointes
  const kinds = input.attachments.map(attachmentKind);
  if (!gifSource && input.attachments.some(isGifAttachment)) gifSource = 'upload';

  // Type principal, du plus spécifique au plus général.
  let type: MessageType;
  if (input.hasPoll) type = 'poll';
  else if (input.isVoiceMessage) type = 'voice';
  else if (input.stickers.length > 0) type = 'sticker';
  else if (gifSource) type = 'gif';
  else if (kinds.includes('video')) type = 'video';
  else if (kinds.includes('image')) type = 'image';
  else if (kinds.includes('audio')) type = 'audio';
  else if (kinds.includes('file')) type = 'file';
  else if (hasPlainLink) type = 'link';
  else type = 'text';
  counters[TYPE_COUNTER[type]] = 1;

  if (gifSource) counters[GIF_COUNTER[gifSource]] = 1;
  if (gifSource || kinds.some((k) => k !== 'file') || input.isVoiceMessage) counters.withMedia = 1;

  for (const sticker of input.stickers) inc(counters, STICKER_COUNTER[sticker.origin]);

  // Mise en forme
  const markdown = detectMarkdown(content);
  Object.assign(counters, markdown);
  if (Object.keys(markdown).length > 0) counters.withMarkdown = 1;

  // Style de message
  if (input.isReply) counters.styleReply = 1;
  if (input.hasMention) counters.styleMention = 1;
  if (input.inThread) counters.styleThread = 1;

  const text = content.trim();
  if (text.length > 0) {
    if (text.length < SHORT_MAX) counters.lenShort = 1;
    else if (text.length > LONG_MIN) counters.lenLong = 1;
    else counters.lenMedium = 1;

    const leftover = withoutCustom.replace(UNICODE_EMOJI_RE, '').replace(/[\s\uFE0F\u200D]/g, '');
    if (emojiCount > 0 && leftover.length === 0 && input.attachments.length === 0) counters.emojiOnly = 1;
  }

  return {
    type,
    counters,
    customEmojis,
    unicodeEmojis,
    domains: [...domains],
    stickers: input.stickers,
  };
}

/** Familles de sites, pour regrouper les domaines dans le dashboard. */
const DOMAIN_FAMILIES: Record<string, string> = {
  'youtube.com': 'video', 'twitch.tv': 'stream', 'kick.com': 'stream', 'tiktok.com': 'video',
  'dailymotion.com': 'video', 'vimeo.com': 'video', 'streamable.com': 'video', 'medal.tv': 'video',
  'x.com': 'social', 'reddit.com': 'social', 'instagram.com': 'social', 'facebook.com': 'social',
  'bsky.app': 'social', 'threads.net': 'social', 'linkedin.com': 'social', 'tumblr.com': 'social',
  'discord.gg': 'discord_invite', 'discord.com': 'discord',
  'github.com': 'code', 'gitlab.com': 'code', 'stackoverflow.com': 'code', 'npmjs.com': 'code',
  'steampowered.com': 'game', 'epicgames.com': 'game', 'roblox.com': 'game', 'minecraft.net': 'game',
  'itch.io': 'game', 'riotgames.com': 'game', 'op.gg': 'game',
  'spotify.com': 'music', 'deezer.com': 'music', 'soundcloud.com': 'music', 'apple.com': 'tech',
  'google.com': 'tool', 'wikipedia.org': 'reference', 'imgur.com': 'image', 'pinterest.com': 'image',
  'amazon.fr': 'shop', 'amazon.com': 'shop', 'aliexpress.com': 'shop',
};

export function domainFamily(domain: string): string {
  return DOMAIN_FAMILIES[domain] ?? 'other';
}
