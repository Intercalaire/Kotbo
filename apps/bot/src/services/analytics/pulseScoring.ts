/**
 * Modèle de scoring du Pulse - fonctions pures, sans I/O.
 *
 * Principes de calibration :
 *
 * 1. **Continuité.** Toutes les courbes sont monotones et continues. L'ancienne
 *    version utilisait des paliers (`if (rate < 0.05) return 65`), ce qui faisait
 *    bouger le score de 20 points pour une sanction de plus. Ici on passe par une
 *    saturation `x / (x + k)` : `k` est la valeur qui vaut 50/100, et la pente
 *    décroît naturellement au lieu de sauter.
 *
 * 2. **Dénominateur humain.** Les bots ne postent pas, ne partent pas et ne se
 *    font pas sanctionner : les ratios sont rapportés à `totalHumans`, pas à
 *    `totalMembers`. Sur un serveur avec 30 % de bots l'ancien calcul sous-estimait
 *    l'activité d'autant.
 *
 * 3. **Relatif à soi-même.** Une constante absolue ne peut pas juger à la fois un
 *    serveur de 20 membres et un de 50 000. L'activité mélange donc une part
 *    absolue et une part comparée à la médiane des 28 derniers jours du serveur.
 *    La médiane (et non la moyenne) évite qu'un raid ou une journée de panne
 *    déplace la référence.
 *
 * 4. **Sous-scores décorrélés.** `activity` mesure le *volume*, `engagement`
 *    mesure *qui participe*. L'ancienne version calculait les deux à partir de
 *    `activeMembers / totalMembers`, ce qui comptait deux fois la même chose dans
 *    le score global.
 */

export interface PulseScoreInput {
  /** Membres humains (hors bots). */
  humans: number;
  totalMembers: number;
  messages: number;
  voiceMinutes: number;
  /** Membres ayant posté au moins un message. */
  activeMembers: number;
  /** Membres ayant rejoint au moins un salon vocal. */
  activeVoiceMembers: number;
  membersJoined: number;
  membersLeft: number;
  sanctionsCount: number;
  ticketsOpen: number;
  ticketsResolved: number;
  channelsHealthy: number;
  channelsUnhealthy: number;
  /** Médianes du serveur sur la fenêtre de référence (28 j), si disponibles. */
  baseline?: PulseBaseline | null;
}

export interface PulseBaseline {
  /** Messages par humain et par jour, médiane. */
  messagesPerHuman: number;
  /** Minutes vocales par humain et par jour, médiane. */
  voicePerHuman: number;
  /** Taux de participation quotidien, médiane. */
  participationRate: number;
  /** Nombre de jours réellement observés (sert à pondérer la confiance). */
  sampleDays: number;
}

export interface PulseScores {
  score: number;
  activityScore: number;
  moderationScore: number;
  growthScore: number;
  engagementScore: number;
  healthScore: number;
}

export type AlertSeverity = 'info' | 'warning' | 'danger' | 'success';

export interface PulseAlert {
  /** Catégorie historique, conservée pour compatibilité. */
  type: string;
  /** Identifiant stable, utilisé pour traduire côté client. */
  code: string;
  severity: AlertSeverity;
  /** Paramètres d'interpolation du message traduit. */
  params?: Record<string, number | string>;
  /** Rendu français pré-calculé (fallback pour le bot et le MCP). */
  message: string;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function clampScore(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Saturation douce sur [0, 100) : `0 → 0`, `x = k → 50`, `x → ∞ → 100`.
 * Monotone croissante, dérivée décroissante, jamais discontinue.
 */
export function saturate(x: number, k: number): number {
  if (!(x > 0) || !(k > 0)) return 0;
  return (100 * x) / (x + k);
}

/** Saturation inversée : `0 → 100`, `x = k → 50`. Pour les métriques « moins c'est mieux ». */
export function saturateInverse(x: number, k: number): number {
  if (!(x > 0)) return 100;
  if (!(k > 0)) return 0;
  return (100 * k) / (x + k);
}

/** Médiane robuste (renvoie 0 sur un échantillon vide). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Score d'un ratio « valeur du jour / référence du serveur ».
 * `r = 1` (dans la norme) → ~59, `r = 2` → ~74, `r = 0.5` → ~42, `r = 0` → 0.
 */
function relativeScore(value: number, reference: number): number | null {
  if (!(reference > 0)) return null;
  return saturate(value / reference, 0.7);
}

/**
 * Poids accordé à la part relative, en fonction du nombre de jours observés.
 * Sous 7 jours d'historique la référence n'est pas fiable : on reste sur l'absolu.
 */
function baselineWeight(sampleDays: number): number {
  if (sampleDays < 7) return 0;
  return Math.min(0.45, 0.45 * ((sampleDays - 6) / 14));
}

// ---------------------------------------------------------------------------
// Constantes de calibration (valeur qui vaut 50/100)
// ---------------------------------------------------------------------------

/** 0,8 message par humain et par jour = activité textuelle « moyenne ». */
const K_MESSAGES_PER_HUMAN = 0.8;
/** 4 minutes de vocal par humain et par jour. */
const K_VOICE_PER_HUMAN = 4;
/** 12 % d'humains actifs par jour = participation « moyenne » sur Discord. */
const K_PARTICIPATION = 0.12;
/** 4 % d'humains en vocal par jour. */
const K_VOICE_PARTICIPATION = 0.04;
/** 8 messages par membre actif = conversation de profondeur « moyenne ». */
const K_DEPTH = 8;
/** 8 sanctions pour 100 membres actifs = modération « moyenne ». */
const K_SANCTION_RATE = 0.08;
/**
 * Lissage additif du dénominateur des sanctions.
 * Sans lui, sur un serveur à 5 actifs, une seule sanction ferait un taux de 20 %
 * et effondrerait le score. Cette constante joue le rôle d'a priori : il faut un
 * minimum de volume pour qu'un taux soit informatif.
 */
const SANCTION_SMOOTHING = 20;
/** 1 % de départs quotidiens = churn significatif. */
const K_CHURN = 0.01;
/** 3 tickets ouverts pour 100 humains = backlog « moyen ». */
const K_TICKET_BACKLOG = 0.03;

/** Pondération du score global. La somme vaut 1. */
const WEIGHTS = {
  activity: 0.25,
  engagement: 0.25,
  growth: 0.2,
  moderation: 0.15,
  health: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Sous-scores
// ---------------------------------------------------------------------------

export function computeActivityScore(input: PulseScoreInput): number {
  const humans = Math.max(input.humans, 1);
  if (input.humans <= 0) return 0;

  const messagesPerHuman = input.messages / humans;
  const voicePerHuman = input.voiceMinutes / humans;

  const absolute =
    0.65 * saturate(messagesPerHuman, K_MESSAGES_PER_HUMAN) +
    0.35 * saturate(voicePerHuman, K_VOICE_PER_HUMAN);

  const base = input.baseline;
  const weight = base ? baselineWeight(base.sampleDays) : 0;
  if (!base || weight <= 0) return clampScore(absolute);

  const relMessages = relativeScore(messagesPerHuman, base.messagesPerHuman);
  const relVoice = relativeScore(voicePerHuman, base.voicePerHuman);

  // On ne mélange que les composantes pour lesquelles une référence existe.
  const parts: Array<[number, number]> = [];
  if (relMessages !== null) parts.push([relMessages, 0.65]);
  if (relVoice !== null) parts.push([relVoice, 0.35]);
  if (parts.length === 0) return clampScore(absolute);

  const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
  const relative = parts.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight;

  return clampScore(absolute * (1 - weight) + relative * weight);
}

export function computeEngagementScore(input: PulseScoreInput): number {
  const humans = Math.max(input.humans, 1);
  if (input.humans <= 0) return 0;

  const participation = input.activeMembers / humans;
  const voiceParticipation = input.activeVoiceMembers / humans;
  const depth = input.activeMembers > 0 ? input.messages / input.activeMembers : 0;

  const absolute =
    0.5 * saturate(participation, K_PARTICIPATION) +
    0.2 * saturate(voiceParticipation, K_VOICE_PARTICIPATION) +
    0.3 * saturate(depth, K_DEPTH);

  const base = input.baseline;
  const weight = base ? baselineWeight(base.sampleDays) : 0;
  const relative = base ? relativeScore(participation, base.participationRate) : null;
  if (relative === null || weight <= 0) return clampScore(absolute);

  return clampScore(absolute * (1 - weight) + relative * weight);
}

export function computeGrowthScore(input: PulseScoreInput): number {
  const humans = Math.max(input.humans, 1);
  if (input.humans <= 0) return 50;

  const netRate = (input.membersJoined - input.membersLeft) / humans;
  const churnRate = input.membersLeft / humans;

  // tanh : symétrique autour de 0, sature en douceur. +1 %/j → ~78, −1 %/j → ~22.
  const netScore = 50 + 50 * Math.tanh(netRate * 125);

  // Un serveur peut afficher une croissance nette positive tout en perdant
  // beaucoup de monde (porte tournante) : on pénalise le churn séparément.
  const churnPenalty = 25 * (churnRate / (churnRate + K_CHURN));

  return clampScore(netScore - churnPenalty);
}

export function computeModerationScore(input: PulseScoreInput): number {
  // Le taux de sanctions se rapporte aux membres *actifs* : un membre inactif ne
  // peut pas enfreindre les règles, le rapporter à l'effectif total diluait le
  // signal sur les gros serveurs peu actifs.
  if (input.activeMembers <= 0 && input.sanctionsCount === 0) {
    // Aucune activité et aucune sanction : rien à juger, ni félicitations ni blâme.
    return 75;
  }
  const rate = input.sanctionsCount / (input.activeMembers + SANCTION_SMOOTHING);
  return clampScore(saturateInverse(rate, K_SANCTION_RATE));
}

export function computeHealthScore(input: PulseScoreInput): number {
  const totalChannels = input.channelsHealthy + input.channelsUnhealthy;
  const channelHealth = totalChannels > 0 ? (input.channelsHealthy / totalChannels) * 100 : 80;

  const handled = input.ticketsResolved + input.ticketsOpen;
  const resolutionRate = handled > 0 ? (input.ticketsResolved / handled) * 100 : 80;

  // Le backlog absolu compte autant que le taux : 3 tickets ouverts sur un
  // serveur de 100 humains, ce n'est pas la même chose que sur un de 10 000.
  const backlogRate = input.ticketsOpen / Math.max(input.humans, 1);
  const backlogHealth = saturateInverse(backlogRate, K_TICKET_BACKLOG);

  return clampScore(channelHealth * 0.5 + resolutionRate * 0.25 + backlogHealth * 0.25);
}

export function computePulseScores(input: PulseScoreInput): PulseScores {
  const activityScore = computeActivityScore(input);
  const engagementScore = computeEngagementScore(input);
  const growthScore = computeGrowthScore(input);
  const moderationScore = computeModerationScore(input);
  const healthScore = computeHealthScore(input);

  const score = clampScore(
    activityScore * WEIGHTS.activity +
      engagementScore * WEIGHTS.engagement +
      growthScore * WEIGHTS.growth +
      moderationScore * WEIGHTS.moderation +
      healthScore * WEIGHTS.health,
  );

  return { score, activityScore, engagementScore, growthScore, moderationScore, healthScore };
}

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

/**
 * Le serveur a-t-il assez de matière pour qu'un diagnostic ait du sens ?
 * Sans ce garde-fou, une guilde fraîchement ajoutée déclenchait « activité très
 * faible » et « croissance stagnante » dès le premier snapshot.
 */
export function hasEnoughSignal(input: PulseScoreInput): boolean {
  return input.humans >= 5 && (input.messages > 0 || input.voiceMinutes > 0 || input.membersJoined > 0);
}

export function generateAlerts(scores: PulseScores, input: PulseScoreInput): PulseAlert[] {
  const alerts: PulseAlert[] = [];

  if (!hasEnoughSignal(input)) {
    alerts.push({
      type: 'data',
      code: 'insufficient_data',
      severity: 'info',
      message: "Pas encore assez de données pour un diagnostic fiable.",
    });
    return alerts;
  }

  const push = (type: string, code: string, severity: AlertSeverity, message: string, params?: Record<string, number | string>) => {
    alerts.push({ type, code, severity, message, params });
  };

  if (scores.activityScore < 30) {
    push('activity', 'activity_critical', 'danger', 'Activité très faible - le serveur est en sommeil.');
  } else if (scores.activityScore < 50) {
    push('activity', 'activity_low', 'warning', 'Activité en dessous de la normale du serveur.');
  }

  if (scores.moderationScore < 35) {
    push('moderation', 'moderation_critical', 'danger', 'Taux de sanctions élevé - vérifiez les conflits en cours.', {
      count: input.sanctionsCount,
    });
  }

  if (scores.growthScore < 30) {
    push('growth', 'growth_critical', 'danger', 'Le serveur perd des membres - analysez les départs.', {
      left: input.membersLeft,
    });
  } else if (scores.growthScore < 45) {
    push('growth', 'growth_stagnant', 'warning', 'Croissance stagnante.');
  }

  // Porte tournante : autant d'arrivées que de départs, l'acquisition ne convertit pas.
  const churnRate = input.membersLeft / Math.max(input.humans, 1);
  if (churnRate > 0.01 && input.membersLeft >= 3 && input.membersJoined >= input.membersLeft) {
    push('growth', 'growth_churn', 'warning', `${input.membersLeft} départs compensés par les arrivées - la rétention est faible.`, {
      left: input.membersLeft,
      joined: input.membersJoined,
    });
  }

  if (scores.engagementScore < 30) {
    push('engagement', 'engagement_low', 'warning', 'Faible engagement - peu de membres participent activement.');
  }

  if (input.ticketsOpen > 10) {
    push('tickets', 'tickets_backlog', 'warning', `${input.ticketsOpen} tickets ouverts en attente.`, {
      count: input.ticketsOpen,
    });
  }

  if (input.channelsUnhealthy > 0 && scores.healthScore < 45) {
    push('health', 'channels_unhealthy', 'warning', `${input.channelsUnhealthy} salons en mauvaise santé détectés.`, {
      count: input.channelsUnhealthy,
    });
  }

  if (scores.activityScore > 75 && scores.engagementScore > 75 && scores.growthScore > 60) {
    push('positive', 'excellent', 'success', 'Excellente dynamique - le serveur est en pleine forme !');
  }

  return alerts;
}

/** Seuil de variation à partir duquel une tendance est jugée significative. */
export const TREND_THRESHOLD = 3;

export function resolveTrend(delta: number): 'UP' | 'DOWN' | 'STABLE' {
  if (delta > TREND_THRESHOLD) return 'UP';
  if (delta < -TREND_THRESHOLD) return 'DOWN';
  return 'STABLE';
}
