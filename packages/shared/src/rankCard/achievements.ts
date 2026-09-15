import type {
  RankCardAchievement,
  RankCardAchievementMetrics,
  RankCardAchievementTier,
  RankCardBadgeIconId,
} from './types.js';

/**
 * Tracés SVG sur une grille 24x24, remplis en `evenodd`. La même chaîne sert au
 * `Path2D` du canvas serveur et à l'attribut `d` du dashboard : pas d'asset à
 * versionner en double, et le badge reste net à toutes les tailles.
 */
export const RANK_CARD_BADGE_ICONS: Record<RankCardBadgeIconId, string> = {
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8zM5 19.5h14V22H5z',
  gem: 'M6 3h12l4 6-10 12L2 9l4-6z',
  gift: 'M3 8h8v4H3zM13 8h8v4h-8zM4 13h7v8H4zM13 13h7v8h-7zM12 7.5C10 3 6 4 7.5 6.5 8.3 7.8 10.5 8 12 8c1.5 0 3.7-.2 4.5-1.5C18 4 14 3 12 7.5z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  shield: 'M12 2l8 3v6c0 5.5-3.4 9.7-8 11-4.6-1.3-8-5.5-8-11V5l8-3z',
  peak: 'M2 20L9 7l4 6 3-4 6 11H2z',
  trophy: 'M7 3h10v6a5 5 0 0 1-10 0V3zM17 4h4v3c0 2.4-1.8 4.3-4.2 4.5l.2-2c1.3-.3 2-1.2 2-2.5V6h-2zM7 4H3v3c0 2.4 1.8 4.3 4.2 4.5l-.2-2C5.7 9.2 5 8.3 5 7V6h2zM11 14h2v4h-2zM7 19h10v3H7z',
  heart: 'M12 21l-1.5-1.4C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.5 11.5L12 21z',
  star: 'M12 2.5l2.53 6.52 6.98.39-5.42 4.42 1.79 6.76L12 16.8l-5.88 3.79 1.79-6.76-5.42-4.42 6.98-.39L12 2.5z',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 1 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8z',
};

/** Dégradé du liseré et de l'icône, du haut vers le bas du badge. */
export const RANK_CARD_TIER_COLORS: Record<RankCardAchievementTier, string[]> = {
  bronze: ['#f0b27a', '#a0522d'],
  silver: ['#f1f5f9', '#94a3b8'],
  gold: ['#fde68a', '#d97706'],
  legendary: ['#c4b5fd', '#f472b6', '#22d3ee'],
};

export const RANK_CARD_MAX_BADGES = 3;

export const RANK_CARD_ACHIEVEMENTS: RankCardAchievement[] = [
  {
    id: 'kotbo_staff',
    label: { fr: 'Staff Kotbo', en: 'Kotbo Staff' },
    description: { fr: "Faire partie de l'équipe d'administration de Kotbo.", en: 'Be part of the Kotbo administration team.' },
    title: { fr: 'Staff Kotbo', en: 'Kotbo Staff' },
    tier: 'legendary',
    icon: 'crown',
    metric: 'staff',
    threshold: 1,
    revocable: true,
  },
  {
    id: 'supporter_1',
    label: { fr: 'Soutien', en: 'Supporter' },
    description: { fr: 'Payer un abonnement Kotbo depuis 1 mois.', en: 'Pay for a Kotbo subscription for 1 month.' },
    title: { fr: 'Soutien', en: 'Supporter' },
    tier: 'bronze',
    icon: 'gem',
    metric: 'supporterMonths',
    threshold: 1,
    revocable: false,
  },
  {
    id: 'supporter_6',
    label: { fr: 'Mécène', en: 'Patron' },
    description: { fr: 'Payer un abonnement Kotbo depuis 6 mois.', en: 'Pay for a Kotbo subscription for 6 months.' },
    title: { fr: 'Mécène', en: 'Patron' },
    tier: 'silver',
    icon: 'gem',
    metric: 'supporterMonths',
    threshold: 6,
    revocable: false,
  },
  {
    id: 'supporter_12',
    label: { fr: 'Grand mécène', en: 'Grand patron' },
    description: { fr: 'Payer un abonnement Kotbo depuis 12 mois.', en: 'Pay for a Kotbo subscription for 12 months.' },
    title: { fr: 'Grand mécène', en: 'Grand patron' },
    tier: 'gold',
    icon: 'gem',
    metric: 'supporterMonths',
    threshold: 12,
    revocable: false,
  },
  {
    id: 'gift_giver',
    label: { fr: 'Bienfaiteur', en: 'Benefactor' },
    description: { fr: 'Offrir Kotbo à un serveur.', en: 'Gift Kotbo to a server.' },
    title: { fr: 'Bienfaiteur', en: 'Benefactor' },
    tier: 'gold',
    icon: 'gift',
    metric: 'giftsOffered',
    threshold: 1,
    revocable: false,
  },
  {
    id: 'level_25',
    label: { fr: 'Habitué', en: 'Regular' },
    description: { fr: 'Atteindre le niveau 25 sur un serveur.', en: 'Reach level 25 on a server.' },
    title: { fr: 'Habitué', en: 'Regular' },
    tier: 'bronze',
    icon: 'bolt',
    metric: 'maxLevel',
    threshold: 25,
    revocable: false,
  },
  {
    id: 'level_50',
    label: { fr: 'Vétéran', en: 'Veteran' },
    description: { fr: 'Atteindre le niveau 50 sur un serveur.', en: 'Reach level 50 on a server.' },
    title: { fr: 'Vétéran', en: 'Veteran' },
    tier: 'silver',
    icon: 'shield',
    metric: 'maxLevel',
    threshold: 50,
    revocable: false,
  },
  {
    id: 'level_100',
    label: { fr: 'Légende', en: 'Legend' },
    description: { fr: 'Atteindre le niveau 100 sur un serveur.', en: 'Reach level 100 on a server.' },
    title: { fr: 'Légende', en: 'Legend' },
    tier: 'gold',
    icon: 'peak',
    metric: 'maxLevel',
    threshold: 100,
    revocable: false,
  },
  {
    id: 'first_place',
    label: { fr: 'Numéro un', en: 'Number one' },
    description: { fr: "Être premier du classement d'XP d'un serveur d'au moins 10 membres.", en: 'Top the XP leaderboard of a server with at least 10 members.' },
    title: { fr: 'Numéro un', en: 'Number one' },
    tier: 'gold',
    icon: 'trophy',
    metric: 'firstPlaces',
    threshold: 1,
    revocable: false,
  },
  {
    id: 'reputation_50',
    label: { fr: 'Apprécié', en: 'Appreciated' },
    description: { fr: 'Recevoir 50 points de réputation.', en: 'Receive 50 reputation points.' },
    title: { fr: 'Apprécié', en: 'Appreciated' },
    tier: 'silver',
    icon: 'heart',
    metric: 'reputation',
    threshold: 50,
    revocable: false,
  },
  {
    id: 'starboard_10',
    label: { fr: 'Étoile', en: 'Star' },
    description: { fr: 'Voir 10 de ses messages mis en avant sur un starboard.', en: 'Get 10 of your messages featured on a starboard.' },
    title: { fr: 'Étoile', en: 'Star' },
    tier: 'silver',
    icon: 'star',
    metric: 'starboard',
    threshold: 10,
    revocable: false,
  },
  {
    id: 'quests_50',
    label: { fr: 'Aventurier', en: 'Adventurer' },
    description: { fr: 'Réclamer 50 récompenses de quêtes.', en: 'Claim 50 quest rewards.' },
    title: { fr: 'Aventurier', en: 'Adventurer' },
    tier: 'bronze',
    icon: 'target',
    metric: 'questsClaimed',
    threshold: 50,
    revocable: false,
  },
];

const ACHIEVEMENTS_BY_ID = new Map(RANK_CARD_ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

export function getRankCardAchievement(id: string): RankCardAchievement | null {
  return ACHIEVEMENTS_BY_ID.get(id) ?? null;
}

/** Succès atteints par les métriques courantes, dans l'ordre du catalogue. */
export function rankCardAchievementsFromMetrics(metrics: Partial<RankCardAchievementMetrics>): RankCardAchievement[] {
  return RANK_CARD_ACHIEVEMENTS.filter((achievement) => (metrics[achievement.metric] ?? 0) >= achievement.threshold);
}

/** Vrai quand l'élément est ouvert à tous ou que son succès est acquis. */
export function isRankCardItemUnlocked(unlockedBy: string | undefined, unlocked: ReadonlySet<string>): boolean {
  return !unlockedBy || unlocked.has(unlockedBy);
}
