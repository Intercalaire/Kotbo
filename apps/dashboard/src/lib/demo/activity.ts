/**
 * L'activité du serveur de démo : messages, vocal, présence, jour par jour.
 *
 * Générée une fois avec une graine fixe, à partir des totaux de chaque
 * personne (`fixtures.ts`). Analytics, fiche membre, recherche de messages et
 * pulse lisent tous cette même source : le membre qui domine le classement
 * des messages est aussi celui dont la fiche déborde de messages.
 */
import { CHANNELS, DAY, HOUR, MEMBERS, PEOPLE, VOICE_CHANNELS, channelByName, personByName, type DemoPerson } from './fixtures';

const DAY_MS = 86_400_000;

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const dateKey = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
export const isoDaysAgo = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString();

/** Forme d'une semaine : le week-end et le mercredi soir (soirée jeux) portent l'activité. */
const WEEKDAY_WEIGHT = [1.35, 0.85, 0.8, 1.1, 0.9, 1.15, 1.45];

/** Volume relatif d'un jour, du plus ancien au plus récent : légère croissance, bruit stable. */
export function dayWeight(daysAgo: number): number {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  const noise = seeded(9_000 + Math.floor(Date.now() / DAY_MS) - daysAgo)();
  return WEEKDAY_WEIGHT[date.getUTCDay()] * (1 - daysAgo * 0.0025) * (0.85 + noise * 0.3);
}

/** Messages du serveur sur une journée. */
export const serverMessages = (daysAgo: number) => Math.round(840 * dayWeight(daysAgo));
export const serverVoiceMinutes = (daysAgo: number) => Math.round(1_380 * dayWeight(daysAgo));

export type DailyPoint = {
  dateKey: string;
  daysAgo: number;
  messages: number;
  voiceMinutes: number;
  voiceSessions: number;
  membersJoined: number;
  membersLeft: number;
  activeMembers: number;
  onlineMembers: number;
  peakOnline: number;
  peakVoice: number;
  sanctions: number;
  reactions: number;
};

/** Série quotidienne du serveur, du jour le plus ancien à aujourd'hui. */
export function serverSeries(days: number, offset = 0): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = offset + days - 1 - i;
    const random = seeded(4_200 + daysAgo);
    const messages = serverMessages(daysAgo);
    const joined = Math.round(1 + random() * 5 + (dayWeight(daysAgo) > 1.2 ? 2 : 0));
    return {
      dateKey: dateKey(daysAgo),
      daysAgo,
      messages,
      voiceMinutes: serverVoiceMinutes(daysAgo),
      voiceSessions: Math.round(messages / 22),
      membersJoined: joined,
      membersLeft: Math.round(random() * 2.4),
      activeMembers: Math.round(messages / 11),
      onlineMembers: Math.round(52 + dayWeight(daysAgo) * 18),
      peakOnline: Math.round(64 + dayWeight(daysAgo) * 24),
      peakVoice: Math.round(4 + dayWeight(daysAgo) * 6),
      sanctions: random() < 0.35 ? 1 : random() < 0.1 ? 2 : 0,
      reactions: Math.round(messages * 0.42),
    };
  });
}

/** Part de chaque membre dans l'activité : à proportion de ses totaux à vie. */
const TOTAL_MESSAGES = MEMBERS.reduce((sum, p) => sum + p.messages, 0);
const TOTAL_VOICE = MEMBERS.reduce((sum, p) => sum + p.voiceMinutes, 0);

/** Activité d'un membre sur une journée. Zéro avant son arrivée. */
export function memberDay(person: DemoPerson, daysAgo: number): { messages: number; voiceMinutes: number } {
  if (daysAgo * DAY > person.joinedMinutesAgo) return { messages: 0, voiceMinutes: 0 };
  const random = seeded(Number(person.id.slice(-6)) * 31 + daysAgo);
  const present = random() < 0.35 + Math.min(0.55, person.messages / 12_000);
  if (!present) return { messages: 0, voiceMinutes: 0 };
  const share = person.messages / TOTAL_MESSAGES;
  const voiceShare = person.voiceMinutes / TOTAL_VOICE;
  return {
    messages: Math.round(serverMessages(daysAgo) * share * (0.6 + random() * 1.4)),
    voiceMinutes: random() < 0.5 ? Math.round(serverVoiceMinutes(daysAgo) * voiceShare * (0.5 + random() * 2)) : 0,
  };
}

export function memberSeries(person: DemoPerson, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    return { dateKey: dateKey(daysAgo), ...memberDay(person, daysAgo) };
  });
}

/** Totaux d'une période pour chaque membre, triés par messages. */
export function memberTotals(days: number) {
  return MEMBERS.filter((p) => !p.bot)
    .map((person) => {
      let messages = 0;
      let voiceMinutes = 0;
      let activeDays = 0;
      for (let d = 0; d < days; d++) {
        const day = memberDay(person, d);
        messages += day.messages;
        voiceMinutes += day.voiceMinutes;
        if (day.messages || day.voiceMinutes) activeDays += 1;
      }
      return { person, messages, voiceMinutes, activeDays };
    })
    .sort((a, b) => b.messages - a.messages);
}

/** Répartition des messages entre salons, stable. */
export const CHANNEL_SHARE: Record<string, number> = {
  'général': 0.46,
  'recherche-de-groupe': 0.19,
  'niveaux': 0.08,
  'boutique': 0.06,
  'suggestions': 0.04,
  'staff': 0.07,
  'annonces': 0.01,
  'bienvenue': 0.03,
  'ouvrir-un-ticket': 0.02,
  'logs': 0.0,
  'règlement': 0.0,
};

export const VOICE_SHARE: Record<string, number> = { Squad: 0.78, 'Réunion staff': 0.22 };

export function channelMessages(days: number) {
  const total = serverSeries(days).reduce((sum, d) => sum + d.messages, 0);
  return CHANNELS.map((channel) => ({ channel, messages: Math.round(total * (CHANNEL_SHARE[channel.name] ?? 0)) }))
    .filter((c) => c.messages > 0)
    .sort((a, b) => b.messages - a.messages);
}

export function voiceChannelMinutes(days: number) {
  const total = serverSeries(days).reduce((sum, d) => sum + d.voiceMinutes, 0);
  return VOICE_CHANNELS.map((channel) => ({ channel, minutes: Math.round(total * (VOICE_SHARE[channel.name] ?? 0)) }));
}

// ── Messages ───────────────────────────────────────────────────────────

const LINES: Record<string, string[]> = {
  'général': [
    'Salut tout le monde !',
    'Quelqu’un a vu le dernier patch ? Ils ont enfin corrigé le matchmaking',
    'Je lance une partie dans 10 min si ça tente du monde',
    'Bonne nuit les gens, à demain',
    'Mdr cette vidéo 😂',
    'Vous faites quoi ce week-end ?',
    'Le tournoi de samedi est toujours d’actualité ?',
    'Merci pour l’aide hier soir, ça a marché !',
    'Bienvenue Tom 👋',
    'Qui est chaud pour la soirée quiz mercredi ?',
    'J’ai enfin passé le niveau 20 🎉',
    'Quelqu’un a un lien pour la playlist d’hier ?',
    'Grosse journée au taf, je suis mort',
    'Le nouveau salon vocal est top',
    'GG à l’équipe pour hier, on a gagné les 3 manches',
  ],
  'recherche-de-groupe': [
    'Cherche 2 joueurs pour ranked, niveau or minimum',
    'Dispo ce soir à partir de 21h, qui monte ?',
    'Il manque un support, quelqu’un ?',
    'On est 4, il reste une place dans le Squad',
    'Partie détente sans prise de tête, ping moi',
  ],
  'niveaux': ['!rank', 'Plus que 300 XP avant le niveau 25', 'Le rôle Habitué arrive enfin', 'Comment on gagne de l’XP en vocal ?'],
  'boutique': ['Le badge doré vaut le coup ?', 'J’ai acheté la couleur de pseudo, trop bien', 'Il reste combien de coffres mystère ?'],
  'suggestions': ['Ce serait cool d’avoir un salon pour les memes', 'Proposition : une soirée film par mois', 'On pourrait ajouter un bot musique ?'],
  'staff': [
    'Je prends le ticket #0148',
    'Vantar recommence en #général, je l’ai averti',
    'Rappel : réunion dimanche 20h',
    'Je serai absent mercredi, Kylian peut couvrir ?',
    'Le filtre anti-liens a bien fonctionné cette nuit',
  ],
  'bienvenue': ['Salut ! Content d’être là', 'Hello, je viens de la part de Lina'],
  'ouvrir-un-ticket': ['Bonjour, j’ai un souci avec mes rôles'],
  'annonces': ['📣 Soirée quiz mercredi 21h, venez nombreux !'],
};

export type DemoMessage = {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  author: DemoPerson;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  hasAttachment: boolean;
  repliedToAuthorId: string | null;
  mentionedUserIds: string[];
};

let corpus: DemoMessage[] | null = null;

/** Les messages journalisés des 30 derniers jours, du plus récent au plus ancien. */
export function messageCorpus(): DemoMessage[] {
  if (corpus) return corpus;
  const random = seeded(77);
  const authors = MEMBERS.filter((p) => !p.bot && p.messages > 200);
  const weightTotal = authors.reduce((sum, p) => sum + p.messages, 0);
  const pick = () => {
    let r = random() * weightTotal;
    for (const p of authors) {
      r -= p.messages;
      if (r <= 0) return p;
    }
    return authors[0];
  };
  const channels = Object.keys(LINES);
  const channelWeights = channels.map((name) => CHANNEL_SHARE[name] ?? 0.01);
  const channelTotal = channelWeights.reduce((a, b) => a + b, 0);
  const pickChannel = () => {
    let r = random() * channelTotal;
    for (let i = 0; i < channels.length; i++) {
      r -= channelWeights[i];
      if (r <= 0) return channels[i];
    }
    return channels[0];
  };
  const staffIds = new Set(PEOPLE.slice(0, 6).map((p) => p.id));
  const list: DemoMessage[] = [];
  for (let i = 0; i < 900; i++) {
    let name = pickChannel();
    let author = pick();
    if (name === 'staff' && !staffIds.has(author.id)) author = PEOPLE[1 + Math.floor(random() * 5)];
    const lines = LINES[name];
    const minutesAgo = Math.round(Math.pow(random(), 1.4) * 30 * DAY);
    if (minutesAgo * 60_000 > author.joinedMinutesAgo * 60_000) name = 'général';
    const channel = channelByName(name);
    const content = LINES[name][Math.floor(random() * LINES[name].length)] ?? lines[0];
    const reply = random() < 0.18 ? pick() : null;
    list.push({
      id: `9100000000${String(100000 + i).padStart(8, '0')}`,
      channelId: channel.id,
      channelName: channel.name,
      authorId: author.id,
      author,
      content,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      editedAt: random() < 0.05 ? new Date(Date.now() - minutesAgo * 60_000 + 90_000).toISOString() : null,
      deletedAt: null,
      hasAttachment: random() < 0.06,
      repliedToAuthorId: reply && reply.id !== author.id ? reply.id : null,
      mentionedUserIds: random() < 0.08 ? [pick().id] : [],
    });
  }
  // Les messages de l'histoire : ceux que les sanctions et les logs citent.
  const vantar = personByName('Vantar');
  list.push(
    {
      id: '910000000000999001',
      channelId: channelByName('général').id,
      channelName: 'général',
      authorId: vantar.id,
      author: vantar,
      content: 'Gagne du Nitro gratuit ici 👉 discord-nitro-gift.ru/claim',
      createdAt: new Date(Date.now() - (2 * HOUR + 3) * 60_000).toISOString(),
      editedAt: null,
      deletedAt: new Date(Date.now() - (2 * HOUR + 2) * 60_000).toISOString(),
      hasAttachment: false,
      repliedToAuthorId: null,
      mentionedUserIds: [],
    },
  );
  corpus = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return corpus;
}

export function messagesOf(userId: string): DemoMessage[] {
  return messageCorpus().filter((m) => m.authorId === userId);
}

export function toMessageLogEntry(m: DemoMessage, guildId: string) {
  return {
    id: m.id,
    guildId,
    channelId: m.channelId,
    channelName: m.channelName,
    messageId: m.id,
    authorId: m.authorId,
    authorName: m.author.displayName,
    authorAvatar: null,
    isBot: false,
    content: m.content,
    attachments: m.hasAttachment ? [{ name: 'capture.png', url: '', contentType: 'image/png' }] : null,
    embedCount: 0,
    hasAttachment: m.hasAttachment,
    mentionedUserIds: m.mentionedUserIds,
    repliedToAuthorId: m.repliedToAuthorId,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
  };
}

/** Qui parle avec qui : réponses et mentions entre membres, tirées du corpus. */
export function interactionEdges(): Array<{ from: string; to: string; type: 'mention' | 'reply' | 'reaction'; count: number }> {
  const counts = new Map<string, number>();
  for (const message of messageCorpus()) {
    if (message.repliedToAuthorId) {
      const key = `${message.authorId}|${message.repliedToAuthorId}|reply`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const target of message.mentionedUserIds) {
      if (target === message.authorId) continue;
      const key = `${message.authorId}|${target}|mention`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([key, count]) => {
    const [from, to, type] = key.split('|');
    return { from, to, type: type as 'mention' | 'reply', count };
  });
}
