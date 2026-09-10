import type { Client } from 'discord.js';
import { cache } from '../../../utils/cache.js';
import { resolveMemberFeatureAccess, type DashboardAccess, type FeatureAccessMap } from '../../shared.js';

/**
 * Correspondance segment d'API -> fonctionnalite du centre de gestion.
 *
 * Retirer une section a un role ne retirait que son entree de barre laterale :
 * l'API continuait de servir la meme donnee a qui connaissait l'URL, ou a
 * n'importe quelle autre page du dashboard qui l'appelait au passage. Une
 * poignee de fichiers de routes verifiaient le droit pour leur compte, les
 * autres se contentaient du niveau Discord.
 *
 * La table vit ici et le repartiteur l'applique en un seul point, sur les
 * lectures. Les ecritures restent gardees route par route : elles passent deja
 * par `canManageSettings`, sauf une liste d'exceptions ou le droit exact
 * depend du geste (un membre du staff pose son absence sans etre moderateur).
 *
 * Ce qui n'y figure pas est ouvert a dessein :
 * - `channels`, `emojis`, `roles` alimentent les selecteurs de toutes les
 *   pages de configuration ; les fermer casserait des sections autorisees ;
 * - `settings`, `state`, `modules`, `language`, `timezone` portent l'etat du
 *   serveur dont la coquille du dashboard a besoin pour se rendre ;
 * - `user-settings`, `layout-presets` sont les preferences du lecteur ;
 * - `billing`, `onboarding`, `activate` doivent rester joignables meme quand
 *   le serveur n'a rien pris ;
 * - `members`, `sanctions`, `appeals`, `tickets`, `economy`, `fun` ont leur
 *   propre controle, plus fin, dans leur fichier de routes ;
 * - `staff`, `leadership`, `calls`, `reminders`, `tasks` sont l'annuaire et
 *   ses annexes, que les pages Reunions, Planning et Tutorat lisent pour
 *   afficher un nom : les fermer casserait des sections autorisees.
 */
export const SEGMENT_FEATURE_KEYS: Record<string, string> = {
  analytics: 'analytics',
  announcement: 'welcome_goodbye',
  'welcome-thread': 'welcome_goodbye',
  'audit-events': 'activity',
  'auto-thread': 'auto_thread',
  'channels-management': 'auto_thread',
  automod: 'automod',
  'banned-words': 'automod',
  'raid-protection': 'raid_protection',
  'nickname-moderation': 'nickname_moderation',
  detections: 'double_accounts',
  'linked-accounts': 'double_accounts',
  logs: 'logs',
  'message-logs': 'logs',
  'ghost-members': 'members',
  invitations: 'members',
  'channel-health': 'channel_health',
  'channel-links': 'channel_links',
  'staff-server': 'staff_server',
  'command-access': 'commands',
  'daily-algo-problems': 'daily_algo',
  'daily-algo-runs': 'daily_algo',
  'daily-algo-weeks': 'daily_algo',
  'daily-algo-submissions': 'daily_algo',
  leveling: 'leveling',
  seasons: 'leveling',
  reputation: 'leveling',
  clans: 'leveling',
  drops: 'leveling',
  // La page Prestige appelle `ranked` : c'est bien « Prestige » qui la garde,
  // pas « Leveling », sinon la barre laterale cachait la page pendant que son
  // API restait ouverte.
  ranked: 'prestige',
  marketplace: 'economy',
  quests: 'economy',
  giveaways: 'giveaways',
  'reaction-roles': 'reaction_roles',
  'embed-builder': 'embed_builder',
  suggestions: 'suggestions',
  starboard: 'starboard',
  workflows: 'workflows',
  triggers: 'workflows',
  news: 'news',
  regulation: 'regulation',
  'social-follows': 'social_networks',
  notifications: 'inbox',
  pulse: 'dashboard',
  widget: 'dashboard',
  recruitment: 'recruitment',
  evaluations: 'staff_directory',
  meetings: 'meetings',
  absences: 'absences',
  tutoring: 'tutoring',
  'mentor-reports': 'tutoring',
  'testing-periods': 'tutoring',
  satisfaction: 'tickets',
};

/**
 * Routes en libre-service, exemptes de la garde.
 *
 * Un apprenti lit sa propre progression a chaque ouverture du dashboard, et
 * cette lecture passe par le segment `tutoring`. La fermer avec la section
 * Tutorat priverait l'apprenti de son propre parcours au motif qu'il n'a pas
 * acces a celui des autres.
 */
const SELF_SERVICE_ROUTES = new Set(['tutoring/apprentice-progress']);

export function featureKeyForSegment(
  segment: string | undefined,
  subSegment?: string,
): string | undefined {
  if (!segment) return undefined;
  if (subSegment && SELF_SERVICE_ROUTES.has(`${segment}/${subSegment}`)) return undefined;
  return SEGMENT_FEATURE_KEYS[segment];
}

/**
 * Droits du membre, gardes quelques secondes.
 *
 * La garde ci-dessus tombe sur chaque lecture d'une section, et resoudre les
 * droits demande de relire toutes les fonctionnalites du serveur avec leurs
 * regles de role. Une page qui s'ouvre lance dix requetes : sans ce cache,
 * elle payait dix fois la meme lecture. La cle porte le prefixe `guild:` pour
 * que `cache.invalidateGuild`, deja appele apres chaque ecriture, la balaie -
 * un droit retire s'applique donc des l'enregistrement.
 */
const FEATURE_ACCESS_TTL_SECONDS = 15;

export async function getCachedFeatureAccess(
  client: Client,
  guildId: string,
  access: DashboardAccess,
  userId: string,
): Promise<FeatureAccessMap> {
  const key = `guild:${guildId}:feature-access:${userId}`;
  const cached = await cache.get<FeatureAccessMap>(key);
  if (cached) return cached;

  const featureAccess = await resolveMemberFeatureAccess(client, guildId, access, userId);
  await cache.set(key, featureAccess, FEATURE_ACCESS_TTL_SECONDS);
  return featureAccess;
}
