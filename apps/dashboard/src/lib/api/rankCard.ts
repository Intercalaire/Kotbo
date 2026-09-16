/** Personnalisation de la carte `/rank` : globale a l utilisateur, hors guilde. */
import type { RankCardAchievementMetrics, RankCardCustomization } from '@kotbo/shared';
import { API_BASE_URL, authorizedFetch } from './client';

const RANK_CARD_URL = `${API_BASE_URL}/api/user/rank-card`;

export type RankCardAchievementState = {
  /**
   * `unlockedAt` est null pour un succes jamais enregistre (revocable, ou ouvert
   * par le statut d administrateur Kotbo). `grantedByStaff` est absent d un bot
   * anterieur a ce champ.
   */
  unlocked: Array<{ id: string; unlockedAt: string | null; grantedByStaff?: boolean }>;
  metrics: Partial<RankCardAchievementMetrics>;
};

/**
 * Seuls la preference et l etat des succes viennent du reseau : les catalogues
 * sont importes de `@kotbo/shared`, donc affichage et rendu partagent la meme
 * source sans qu un aller-retour puisse les desynchroniser.
 *
 * La preference est renvoyee brute : l appelant la normalise. Le dashboard et le
 * bot sont deployes separement, un bot en retard d une version renvoie une
 * preference sans les champs recents et aucun etat de succes.
 */
export async function fetchRankCardCustomization(): Promise<{
  customization: unknown;
  achievements: RankCardAchievementState;
} | null> {
  const response = await authorizedFetch(RANK_CARD_URL);
  if (!response.ok) return null;
  const data = await response.json();
  if (!data?.customization) return null;
  const unlocked = Array.isArray(data.achievements?.unlocked) ? data.achievements.unlocked : [];
  const metrics = data.achievements?.metrics && typeof data.achievements.metrics === 'object' ? data.achievements.metrics : {};
  return { customization: data.customization, achievements: { unlocked, metrics } };
}

/** Comme a la lecture, le resultat est renvoye brut et normalise par l appelant. */
export async function saveRankCard(customization: RankCardCustomization): Promise<unknown> {
  const response = await authorizedFetch(RANK_CARD_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customization),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.customization ?? null;
}

export type RankCardPreview = {
  url: string;
  /** `false` quand le serveur a rendu la carte avec des valeurs d exemple. */
  realProgression: boolean;
};

/**
 * L apercu est rendu par le bot avec le meme code que `/rank` : pas de canvas
 * a maintenir en double cote dashboard.
 *
 * `guildId` sert a afficher la progression reelle du membre. Le serveur retombe
 * sur des valeurs d exemple s il n y a aucune progression a montrer, et le dit
 * dans l en-tete puisque le corps de la reponse est une image.
 */
export async function fetchRankCardPreview(
  customization: RankCardCustomization,
  locale: 'fr' | 'en',
  guildId?: string | null,
): Promise<RankCardPreview | null> {
  const response = await authorizedFetch(`${RANK_CARD_URL}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guildId ? { ...customization, locale, guildId } : { ...customization, locale }),
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  return {
    url: URL.createObjectURL(blob),
    realProgression: response.headers.get('X-Rank-Card-Preview') === 'real',
  };
}
