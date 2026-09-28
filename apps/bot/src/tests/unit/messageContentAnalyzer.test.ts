import { describe, expect, test } from 'bun:test';
import {
  analyzeMessageContent,
  detectMarkdown,
  gifSourceFromUrl,
  normalizeDomain,
  type ContentInput,
} from '../../services/analytics/messageContentAnalyzer.js';

const GUILD_EMOJI = '111111111111111111';
const OTHER_EMOJI = '222222222222222222';

function input(overrides: Partial<ContentInput> = {}): ContentInput {
  return {
    content: '',
    attachments: [],
    stickers: [],
    isGuildEmoji: (id) => id === GUILD_EMOJI,
    ...overrides,
  };
}

describe('normalizeDomain', () => {
  test('fusionne les alias et retire www', () => {
    expect(normalizeDomain('https://www.youtube.com/watch?v=x')).toBe('youtube.com');
    expect(normalizeDomain('https://youtu.be/abc')).toBe('youtube.com');
    expect(normalizeDomain('https://twitter.com/a/status/1')).toBe('x.com');
    expect(normalizeDomain('https://fr.wikipedia.org/wiki/X')).toBe('wikipedia.org');
    expect(normalizeDomain('https://news.bbc.co.uk/a')).toBe('bbc.co.uk');
  });

  test('range les invitations Discord à part', () => {
    expect(normalizeDomain('https://discord.gg/abc')).toBe('discord.gg');
    expect(normalizeDomain('https://discord.com/invite/abc')).toBe('discord.gg');
    expect(normalizeDomain('https://discord.com/channels/1/2')).toBe('discord.com');
  });

  test('ignore les IP et URLs illisibles', () => {
    expect(normalizeDomain('http://192.168.1.1/admin')).toBeNull();
    expect(normalizeDomain('https://localhost/x')).toBeNull();
    expect(normalizeDomain('not a url')).toBeNull();
  });
});

describe('gifSourceFromUrl', () => {
  test('reconnaît Tenor, Giphy et les .gif', () => {
    expect(gifSourceFromUrl('https://tenor.com/view/cat-gif-123')).toBe('tenor');
    expect(gifSourceFromUrl('https://media.tenor.com/x/y.gif')).toBe('tenor');
    expect(gifSourceFromUrl('https://media4.giphy.com/media/x/giphy.gif')).toBe('giphy');
    expect(gifSourceFromUrl('https://example.com/a/b.GIF')).toBe('other');
    expect(gifSourceFromUrl('https://youtube.com/watch')).toBeNull();
  });
});

describe('detectMarkdown', () => {
  test('repère chaque style', () => {
    expect(detectMarkdown('**gras**').mdBold).toBe(1);
    expect(detectMarkdown('*ital*').mdItalic).toBe(1);
    expect(detectMarkdown('_ital_').mdItalic).toBe(1);
    expect(detectMarkdown('__souligné__').mdUnderline).toBe(1);
    expect(detectMarkdown('~~barré~~').mdStrike).toBe(1);
    expect(detectMarkdown('||spoiler||').mdSpoiler).toBe(1);
    expect(detectMarkdown('`code`').mdInlineCode).toBe(1);
    expect(detectMarkdown('```js\nx\n```').mdCodeBlock).toBe(1);
    expect(detectMarkdown('> citation').mdQuote).toBe(1);
    expect(detectMarkdown('## titre').mdHeading).toBe(1);
    expect(detectMarkdown('-# petit texte').mdSubtext).toBe(1);
    expect(detectMarkdown('- un\n- deux').mdList).toBe(1);
    expect(detectMarkdown('[site](https://a.fr)').mdMaskedLink).toBe(1);
  });

  test('***x*** vaut gras et italique', () => {
    const found = detectMarkdown('***fort***');
    expect(found.mdBold).toBe(1);
    expect(found.mdItalic).toBe(1);
  });

  test('ne prend pas snake_case, emojis ou liens pour de l’italique', () => {
    expect(detectMarkdown('ma_variable_est ok').mdItalic).toBeUndefined();
    expect(detectMarkdown(`salut <:pepe_sad:${OTHER_EMOJI}> toi`).mdItalic).toBeUndefined();
    expect(detectMarkdown('https://a.fr/un_chemin_long').mdItalic).toBeUndefined();
    expect(detectMarkdown('2*3*4').mdItalic).toBeUndefined();
    expect(detectMarkdown('le code `a_b_c` ici').mdItalic).toBeUndefined();
  });

  test('un texte simple n’a aucun style', () => {
    expect(Object.keys(detectMarkdown('bonjour tout le monde'))).toEqual([]);
  });
});

describe('analyzeMessageContent', () => {
  test('texte simple', () => {
    const result = analyzeMessageContent(input({ content: 'salut' }));
    expect(result.type).toBe('text');
    expect(result.counters).toMatchObject({ messages: 1, typeText: 1, lenShort: 1 });
    expect(result.counters.withEmoji).toBeUndefined();
  });

  test('sépare emojis Unicode, du serveur et externes', () => {
    const result = analyzeMessageContent(input({
      content: `mdr 😂😂 <:kekw:${GUILD_EMOJI}> <a:catjam:${OTHER_EMOJI}> ❤️`,
    }));
    expect(result.counters.emojiUnicode).toBe(3);
    expect(result.counters.emojiGuild).toBe(1);
    expect(result.counters.emojiExternal).toBe(1);
    expect(result.counters.emojiAnimated).toBe(1);
    expect(result.counters.withEmoji).toBe(1);
    expect(result.unicodeEmojis).toEqual(['😂', '😂', '❤']);
    expect(result.customEmojis.map((e) => e.origin)).toEqual(['guild', 'external']);
  });

  test('garde les emojis composés entiers', () => {
    const result = analyzeMessageContent(input({ content: '👨‍👩‍👧 👍🏽 🇫🇷' }));
    expect(result.unicodeEmojis).toEqual(['👨‍👩‍👧', '👍🏽', '🇫🇷']);
  });

  test('message fait uniquement d’emojis', () => {
    expect(analyzeMessageContent(input({ content: '🔥 🔥' })).counters.emojiOnly).toBe(1);
    expect(analyzeMessageContent(input({ content: `<:kekw:${GUILD_EMOJI}>` })).counters.emojiOnly).toBe(1);
    expect(analyzeMessageContent(input({ content: 'ok 🔥' })).counters.emojiOnly).toBeUndefined();
  });

  test('un lien Tenor est un GIF, pas un lien', () => {
    const result = analyzeMessageContent(input({ content: 'https://tenor.com/view/cat-gif-123' }));
    expect(result.type).toBe('gif');
    expect(result.counters.gifTenor).toBe(1);
    expect(result.counters.withLink).toBeUndefined();
    expect(result.domains).toEqual([]);
  });

  test('un lien ordinaire compte son domaine une fois', () => {
    const result = analyzeMessageContent(input({ content: 'https://youtu.be/a et https://www.youtube.com/watch?v=b' }));
    expect(result.type).toBe('link');
    expect(result.counters.withLink).toBe(1);
    expect(result.domains).toEqual(['youtube.com']);
  });

  test('priorité des types : sondage > vocal > sticker > GIF > vidéo > image', () => {
    const image = { name: 'a.png', contentType: 'image/png' };
    const video = { name: 'a.mp4', contentType: 'video/mp4' };
    const gif = { name: 'a.gif', contentType: 'image/gif' };
    expect(analyzeMessageContent(input({ attachments: [image] })).type).toBe('image');
    expect(analyzeMessageContent(input({ attachments: [image, video] })).type).toBe('video');
    const withGif = analyzeMessageContent(input({ attachments: [gif] }));
    expect(withGif.type).toBe('gif');
    expect(withGif.counters.gifUpload).toBe(1);
    expect(analyzeMessageContent(input({ attachments: [image], stickers: [{ id: '1', name: 's', origin: 'guild' }] })).type).toBe('sticker');
    expect(analyzeMessageContent(input({ isVoiceMessage: true, attachments: [{ name: 'voice-message.ogg', contentType: 'audio/ogg' }] })).type).toBe('voice');
    expect(analyzeMessageContent(input({ hasPoll: true })).type).toBe('poll');
    expect(analyzeMessageContent(input({ attachments: [{ name: 'doc.pdf', contentType: 'application/pdf' }] })).type).toBe('file');
  });

  test('compte les stickers par origine', () => {
    const result = analyzeMessageContent(input({
      stickers: [{ id: '1', name: 'a', origin: 'external' }, { id: '2', name: 'b', origin: 'standard' }],
    }));
    expect(result.counters.stickerExternal).toBe(1);
    expect(result.counters.stickerStandard).toBe(1);
  });

  test('un transfert ne reprend pas le contenu transféré', () => {
    const result = analyzeMessageContent(input({ isForward: true, content: '😂 https://a.fr **x**' }));
    expect(result.type).toBe('forward');
    expect(result.counters).toEqual({ messages: 1, typeForward: 1 });
    expect(result.domains).toEqual([]);
  });

  test('style de message et longueur', () => {
    const long = 'a'.repeat(250);
    const result = analyzeMessageContent(input({ content: long, isReply: true, hasMention: true, inThread: true }));
    expect(result.counters).toMatchObject({ styleReply: 1, styleMention: 1, styleThread: 1, lenLong: 1 });
    expect(analyzeMessageContent(input({ content: 'a'.repeat(50) })).counters.lenMedium).toBe(1);
  });

  test('ne compte pas les mentions comme du contenu', () => {
    const result = analyzeMessageContent(input({ content: '<@123456789012345678> <#123456789012345678>' }));
    expect(result.counters.withEmoji).toBeUndefined();
    expect(result.counters.withMarkdown).toBeUndefined();
  });
});
