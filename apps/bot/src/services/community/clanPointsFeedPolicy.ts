/**
 * Mise en forme du relais Discord des gains de points de clan.
 *
 * Même contenu que le flux « derniers scores » des pages publiques : qui, combien,
 * d'où, pour quel clan. Les membres sont cités par mention, que l'envoi neutralise :
 * le nom s'affiche sans notifier personne.
 */

export const CLAN_WIDE_USER_ID = 'system_manual_points';

/** Limite de description d'un embed Discord. */
export const FEED_DESCRIPTION_LIMIT = 4096;

export type ClanPointsFeedEvent = {
  clanId: string;
  userId: string;
  amount: number;
  source: string;
  credit: number | null;
};

const SOURCE_LABELS: Record<string, string> = {
  XP: 'Passage de niveau',
  ADMIN: 'Staff',
  BOOST: 'Boost du serveur',
  DAILY_ALGO: 'Daily Algo',
  BET: 'Pari',
  BET_TOP1: 'Podium des parieurs (1er)',
  BET_TOP2: 'Podium des parieurs (2e)',
  BET_TOP3: 'Podium des parieurs (3e)',
  DEBT: 'Remboursement de dette',
  DROP: 'Drop',
  RPG: 'RPG',
  RPG_BOSS: 'RPG - boss',
  RPG_MOB: 'RPG - monstre',
  RPG_ITEM: 'RPG - objet',
  RPG_RAID: 'RPG - raid',
  RPG_QUEST: 'RPG - quête',
};

export function feedSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function signed(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString('fr-FR');
  return amount < 0 ? `-${formatted}` : `+${formatted}`;
}

export function formatFeedLine(event: ClanPointsFeedEvent, clanName: string | null): string {
  const who = event.userId === CLAN_WIDE_USER_ID ? 'Tout le clan' : `<@${event.userId}>`;
  const clan = clanName ? `**${clanName}**` : 'clan supprimé';
  const credit = event.credit && event.credit > 0
    ? ` (dont ${event.credit.toLocaleString('fr-FR')} à crédit)`
    : '';
  // Une mise entièrement à crédit est journalisée à zéro : seule sa part à crédit a un sens.
  const amount = event.amount === 0 && credit ? '±0' : signed(event.amount);

  return `\`${amount}\`${credit} · ${who} · ${clan} · ${feedSourceLabel(event.source)}`;
}

/**
 * Regroupe les lignes en descriptions d'embed sous la limite Discord.
 *
 * Une ligne n'est jamais coupée : elle passe entière à la description suivante.
 */
export function chunkFeedLines(lines: string[], limit = FEED_DESCRIPTION_LIMIT): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const safe = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    if (current && current.length + 1 + safe.length > limit) {
      chunks.push(current);
      current = safe;
    } else {
      current = current ? `${current}\n${safe}` : safe;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/** Au-delà, la rafale est résumée par clan plutôt que détaillée ligne à ligne. */
export const DETAILED_FEED_MAX_EVENTS = 10;

/** Limites Discord d'un champ d'embed et de l'embed entier, avec de la marge pour le titre. */
const FIELD_VALUE_LIMIT = 1024;
const SUMMARY_TOTAL_BUDGET = 5500;
const MAX_SUMMARY_FIELDS = 25;

export type FeedSummaryField = { name: string; value: string };

/**
 * Résume une rafale en un champ par clan : total du clan, puis chaque origine avec
 * ses membres et ce qu'ils ont gagné.
 *
 * Tout tient dans un seul embed : les membres qui ne rentrent plus sont comptés en fin
 * de champ plutôt que de déborder sur un second message.
 */
export function summarizeFeed(
  events: ClanPointsFeedEvent[],
  clanNames: Map<string, string>,
): FeedSummaryField[] {
  type SourceGroup = { total: number; members: Map<string, number> };
  const byClan = new Map<string, { total: number; sources: Map<string, SourceGroup> }>();

  for (const event of events) {
    const clan = byClan.get(event.clanId) ?? { total: 0, sources: new Map<string, SourceGroup>() };
    byClan.set(event.clanId, clan);
    clan.total += event.amount;

    const group = clan.sources.get(event.source) ?? { total: 0, members: new Map<string, number>() };
    clan.sources.set(event.source, group);
    group.total += event.amount;
    group.members.set(event.userId, (group.members.get(event.userId) ?? 0) + event.amount);
  }

  const clans = [...byClan.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, MAX_SUMMARY_FIELDS);
  const budget = Math.min(FIELD_VALUE_LIMIT, Math.floor(SUMMARY_TOTAL_BUDGET / Math.max(1, clans.length)));

  return clans.map(([clanId, clan]) => {
    const segments: Segment[] = [];
    const sources = [...clan.sources.entries()].sort(([, a], [, b]) => b.total - a.total);

    for (const [source, group] of sources) {
      segments.push({ text: `**${feedSourceLabel(source)}** · \`${signed(group.total)}\``, member: false });
      [...group.members.entries()]
        .sort(([, a], [, b]) => b - a)
        .forEach(([userId, amount], index) => {
          const who = userId === CLAN_WIDE_USER_ID ? 'Tout le clan' : `<@${userId}>`;
          segments.push({ text: `${who} \`${signed(amount)}\``, member: true, sameLine: index > 0 });
        });
    }

    return {
      name: `${clanNames.get(clanId) ?? 'Clan supprimé'} · ${signed(clan.total)}`,
      value: fitFieldValue(segments, budget),
    };
  });
}

export type Segment = { text: string; member: boolean; sameLine?: boolean };

/**
 * Assemble le champ en s'arrêtant avant la limite.
 *
 * La coupe tombe toujours entre deux segments, jamais au milieu : une mention tronquée
 * s'affiche en texte brut dans Discord. Seuls les membres écartés sont comptés.
 */
export function fitFieldValue(segments: Segment[], limit: number): string {
  const suffix = (hidden: number) => (hidden > 0 ? `\n… et ${hidden} autres` : '');
  const totalMembers = segments.filter((segment) => segment.member).length;

  let value = '';
  let shownMembers = 0;
  for (const segment of segments) {
    const next = value ? `${value}${segment.sameLine ? ' · ' : '\n'}${segment.text}` : segment.text;
    const hiddenAfter = totalMembers - shownMembers - (segment.member ? 1 : 0);
    if (next.length + suffix(hiddenAfter).length > limit) break;
    value = next;
    if (segment.member) shownMembers += 1;
  }

  return `${value}${suffix(totalMembers - shownMembers)}`;
}
