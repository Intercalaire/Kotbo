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
