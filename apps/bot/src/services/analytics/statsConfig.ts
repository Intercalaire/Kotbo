/**
 * Forme de la colonne JSON `Guild.statsConfig`.
 *
 * Prisma type les colonnes `Json` en `JsonValue`, ce qui est exact mais
 * inexploitable tel quel. Ce module decrit la structure reellement ecrite par le
 * dashboard et lue par les salons de statistiques, et fournit un lecteur qui
 * fait la conversion en un seul endroit.
 *
 * En cas d'evolution du format, c'est ici qu'il faut le repercuter - les trois
 * consommateurs (events/stats.ts, routes/dashboard/modules.ts et index.ts)
 * partagent ce type.
 */

/** Compteurs proposes pour un salon de statistiques personnalise. */
export type StatsCounterType =
  | 'members'
  | 'bots'
  | 'online'
  | 'voice'
  | 'role'
  | 'channels'
  | 'categories'
  | 'activity'
  | 'boosts'
  | 'goal';

export type CustomStatEntry = {
  enabled?: boolean;
  type?: StatsCounterType;
  channelId?: string | null;
  /** Type de salon Discord a creer pour ce compteur (vocal ou categorie). */
  channelType?: string | null;
  template?: string | null;
  /** Role compte quand `type` vaut 'role'. */
  roleTargetId?: string | null;
  /** Objectif affiche quand `type` vaut 'goal'. */
  goalTarget?: number | null;
};

export type StatsConfig = {
  id?: string;

  memberEnabled?: boolean;
  memberChannelId?: string | null;
  memberTemplate?: string | null;

  botEnabled?: boolean;
  botChannelId?: string | null;
  botTemplate?: string | null;

  roleEnabled?: boolean;
  roleChannelId?: string | null;
  roleTemplate?: string | null;
  roleTargetId?: string | null;

  channelEnabled?: boolean;
  channelChannelId?: string | null;
  channelTemplate?: string | null;

  categoryEnabled?: boolean;
  categoryChannelId?: string | null;
  categoryTemplate?: string | null;
  categoryId?: string | null;

  activityEnabled?: boolean;
  activityChannelId?: string | null;
  activityTemplate?: string | null;

  customStats?: CustomStatEntry[];

  // Etat de la recuperation historique des messages (messageScraperService).
  // Stocke dans la meme colonne JSON pour ne pas multiplier les migrations.
  historicalScrapeStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  historicalScrapeError?: string | null;
  /** Avancement detaille du scrap en cours, ou null hors traitement. */
  historicalScrapeProgress?: {
    scrapedChannelsCount?: number;
    totalChannelsCount?: number;
    currentChannelName?: string;
    currentChannelId?: string;
    currentLastMessageId?: string | null;
    scrapedMessagesCount?: number;
  } | null;
  historicalScrapedAt?: string | null;
  historicalScrapedChannels?: string[];
  historicalScrapedMessages?: number;
  scrapingBoundaryDate?: string | null;
};

/**
 * Lit la colonne JSON en `StatsConfig`. Renvoie un objet vide si la colonne est
 * nulle ou ne contient pas un objet, pour que les appelants puissent lire leurs
 * champs sans test prealable.
 */
export function readStatsConfig(value: unknown): StatsConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as StatsConfig;
}
