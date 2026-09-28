/**
 * « A traiter » de la page d'accueil.
 *
 * L'accueil montrait des chiffres - membres, messages, uptime - mais rien de ce
 * qui attendait le staff : un appel de ban en souffrance, un double compte
 * detecte, une sanction sans rapport, un salon de logs supprime. Il fallait
 * ouvrir chaque page pour le decouvrir. Ce contrat decrit la liste que l'API
 * calcule et que le dashboard affiche : une ligne par sujet, un compteur, et la
 * page ou le regler.
 *
 * Les libelles vivent cote dashboard (traduits) ; l'API n'envoie que la clef,
 * les nombres et, pour les previsualisations, des noms deja lisibles.
 */

export type HomeTaskSeverity = 'critical' | 'warning' | 'info';

export const HOME_TASK_KEYS = [
  'bot_permissions',
  'broken_references',
  'tickets_pending_validation',
  'tickets_unclaimed',
  'ban_appeals_pending',
  'sanction_reports_missing',
  'admin_requests_pending',
  'alt_detections',
  'alt_links_pending',
  'absences_pending',
  'staff_tasks_mine',
  'polls_unvoted',
  'meetings_upcoming',
  'recruitment_pending',
  'partner_applications_pending',
  'suggestions_pending',
  'channel_health_alerts',
  'workflow_failures',
] as const;

export type HomeTaskKey = (typeof HOME_TASK_KEYS)[number];

export type HomeTaskPreviewItem = {
  id: string;
  label: string;
  /** Date utile a l'element : depot, echeance, debut de reunion. */
  at?: string | null;
};

export type HomeTask = {
  key: HomeTaskKey;
  severity: HomeTaskSeverity;
  count: number;
  /** Part qui revient au lecteur : ses sanctions sans rapport, ses taches. */
  mine?: number;
  /** Plus ancien element en attente, pour dire « depuis 3 j ». */
  oldestAt?: string | null;
  /** Page du dashboard ou traiter le sujet. */
  href: string;
  preview?: HomeTaskPreviewItem[];
};

export type HomeSetupGap = {
  key: string;
  label: string;
  href: string;
  detail?: string;
};

export type HomeTasksData = {
  tasks: HomeTask[];
  /** Parcours de configuration, reserve a qui peut configurer. */
  setup: { done: number; total: number; missing: HomeSetupGap[] } | null;
  generatedAt: string;
};

/**
 * Droit requis pour voir chaque sujet. `module` est aussi la clef du registre :
 * un module eteint ne produit pas de tache. `adminOnly` couvre ce qui se regle
 * dans la configuration du serveur ou de Discord.
 */
export const HOME_TASK_ACCESS: Record<HomeTaskKey, { module?: string; adminOnly?: boolean }> = {
  bot_permissions: { adminOnly: true },
  broken_references: { adminOnly: true },
  tickets_pending_validation: { module: 'tickets' },
  tickets_unclaimed: { module: 'tickets' },
  ban_appeals_pending: { module: 'ban_appeals' },
  sanction_reports_missing: { module: 'sanctions' },
  admin_requests_pending: { adminOnly: true },
  alt_detections: { module: 'double_accounts' },
  alt_links_pending: { module: 'double_accounts' },
  absences_pending: { module: 'absences' },
  staff_tasks_mine: { module: 'absences' },
  polls_unvoted: { module: 'polls' },
  meetings_upcoming: { module: 'meetings' },
  recruitment_pending: { module: 'recruitment' },
  partner_applications_pending: { module: 'partnerships' },
  suggestions_pending: { module: 'suggestions' },
  channel_health_alerts: { module: 'channel_health' },
  workflow_failures: { module: 'workflows' },
};

const SEVERITY_RANK: Record<HomeTaskSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Ordre d'affichage : le plus grave d'abord, puis ce qui concerne le lecteur,
 * puis le plus ancien. A gravite egale, un sujet qui attend depuis une semaine
 * passe devant un sujet ouvert il y a une heure, quel que soit son volume.
 */
export function compareHomeTasks(a: HomeTask, b: HomeTask): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const byMine = Number((b.mine ?? 0) > 0) - Number((a.mine ?? 0) > 0);
  if (byMine !== 0) return byMine;
  if (a.oldestAt && b.oldestAt) return a.oldestAt.localeCompare(b.oldestAt);
  if (a.oldestAt) return -1;
  if (b.oldestAt) return 1;
  return b.count - a.count;
}
