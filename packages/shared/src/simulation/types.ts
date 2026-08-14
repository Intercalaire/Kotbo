/**
 * Staff Simulator - contrat partagé entre l'éditeur de scénarios du dashboard
 * et le moteur d'évaluation du bot.
 *
 * Un scénario décrit une suite d'incidents injectés dans un salon bac à sable,
 * chacun assorti de la réaction attendue d'un modérateur. Le barème vit ici
 * pour que l'aperçu affiché à l'admin soit exactement celui appliqué en session.
 */

/** Nature de l'incident simulé, qui détermine l'habillage du faux message. */
export type IncidentKind =
  | 'SPAM'
  | 'INSULT'
  | 'SUSPICIOUS_LINK'
  | 'TICKET'
  | 'HARMLESS';

/** Sanctions proposées au modérateur en formation sous chaque incident. */
export type ModerationAction =
  | 'IGNORE'
  | 'DELETE'
  | 'WARN'
  | 'MUTE'
  | 'KICK'
  | 'BAN'
  | 'ESCALATE'
  | 'REPLY';

export const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'IGNORE', 'DELETE', 'WARN', 'MUTE', 'KICK', 'BAN', 'ESCALATE', 'REPLY',
] as const;

export const INCIDENT_KINDS: readonly IncidentKind[] = [
  'SPAM', 'INSULT', 'SUSPICIOUS_LINK', 'TICKET', 'HARMLESS',
] as const;

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export const DIFFICULTIES: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'] as const;

export interface ExpectedResponse {
  action: ModerationAction;
  /** Durée attendue quand `action` vaut MUTE, en minutes */
  muteMinutes?: number;
  /**
   * Écart toléré sur la durée, en minutes. Au-delà, la durée est comptée
   * fausse mais l'action reste créditée en partie.
   */
  muteToleranceMinutes?: number;
}

export interface ScenarioStep {
  id: string;
  kind: IncidentKind;
  /** Pseudo du faux utilisateur affiché par le webhook */
  authorName: string;
  authorAvatarUrl?: string | null;
  content: string;
  /** Délai avant injection, compté depuis l'incident précédent */
  delaySeconds: number;
  expected: ExpectedResponse;
  /** Points accordés pour une réponse parfaite */
  points: number;
  /** Conseil affiché dans le rapport quand l'étape est ratée */
  hint?: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  steps: ScenarioStep[];
}

// ============================================================================
// BARÈME
// ============================================================================

/**
 * Part des points conservée quand le modérateur choisit la bonne sanction mais
 * se trompe de durée : le réflexe est bon, le dosage non.
 */
export const PARTIAL_CREDIT_RATIO = 0.5;

/** Au-delà, la réponse est considérée comme tardive et perd une part des points. */
export const SLOW_RESPONSE_MS = 60_000;
export const SLOW_RESPONSE_PENALTY_RATIO = 0.8;

/** Sans réponse dans ce délai, l'étape est comptée manquée. */
export const DEFAULT_STEP_TIMEOUT_SECONDS = 180;

export interface StepAnswer {
  action: ModerationAction;
  muteMinutes?: number;
  /** Temps de réaction en millisecondes depuis l'injection de l'incident */
  responseMs: number;
}

export interface StepEvaluation {
  correct: boolean;
  /** true quand l'action est bonne mais la durée non */
  partiallyCorrect: boolean;
  points: number;
  maxPoints: number;
  /** true si la pénalité de lenteur a été appliquée */
  slow: boolean;
  reason: string;
}

function isWithinTolerance(expected: ExpectedResponse, actual: number | undefined): boolean {
  if (expected.muteMinutes === undefined) return true;
  if (actual === undefined) return false;
  const tolerance = expected.muteToleranceMinutes ?? 0;
  return Math.abs(actual - expected.muteMinutes) <= tolerance;
}

/**
 * Note une réponse à un incident.
 *
 * Trois niveaux : bonne action et bon dosage, bonne action mais mauvais dosage,
 * ou mauvaise action. Une réponse lente conserve la même justesse mais rapporte
 * moins de points, car en modération la vitesse fait partie du geste.
 */
export function evaluateStep(step: ScenarioStep, answer: StepAnswer | null): StepEvaluation {
  const maxPoints = Math.max(0, step.points);

  if (!answer) {
    return {
      correct: false,
      partiallyCorrect: false,
      points: 0,
      maxPoints,
      slow: true,
      reason: 'Aucune réaction avant la fin du délai imparti.',
    };
  }

  if (answer.action !== step.expected.action) {
    return {
      correct: false,
      partiallyCorrect: false,
      points: 0,
      maxPoints,
      slow: false,
      reason: `Action attendue : ${step.expected.action}, action choisie : ${answer.action}.`,
    };
  }

  const durationOk = isWithinTolerance(step.expected, answer.muteMinutes);
  const slow = answer.responseMs > SLOW_RESPONSE_MS;

  let points = durationOk ? maxPoints : maxPoints * PARTIAL_CREDIT_RATIO;
  if (slow) points *= SLOW_RESPONSE_PENALTY_RATIO;

  return {
    correct: durationOk,
    partiallyCorrect: !durationOk,
    points: Math.round(points),
    maxPoints,
    slow,
    reason: durationOk
      ? slow ? 'Bonne réaction, mais trop tardive.' : 'Réaction correcte.'
      : `Bonne sanction, mais durée inadaptée (${step.expected.muteMinutes} min attendues).`,
  };
}

export interface SessionReport {
  totalPoints: number;
  maxPoints: number;
  /** Score global en pourcentage, arrondi */
  scorePercent: number;
  correctCount: number;
  partialCount: number;
  missedCount: number;
  averageResponseMs: number;
  /** Conseils issus des étapes ratées, sans doublon */
  advice: string[];
}

/**
 * Agrège les réponses d'une session en rapport final.
 *
 * Les étapes sans réponse comptent dans le score mais pas dans le temps de
 * réaction moyen : y inclure un délai d'expiration fausserait la moyenne.
 */
export function buildSessionReport(
  steps: ScenarioStep[],
  answers: (StepAnswer | null)[],
): SessionReport {
  let totalPoints = 0;
  let maxPoints = 0;
  let correctCount = 0;
  let partialCount = 0;
  let missedCount = 0;
  let responseSum = 0;
  let responseCount = 0;
  const advice: string[] = [];

  steps.forEach((step, index) => {
    const answer = answers[index] ?? null;
    const evaluation = evaluateStep(step, answer);

    totalPoints += evaluation.points;
    maxPoints += evaluation.maxPoints;

    if (evaluation.correct) correctCount++;
    else if (evaluation.partiallyCorrect) partialCount++;
    else missedCount++;

    if (answer) {
      responseSum += answer.responseMs;
      responseCount++;
    }

    if (!evaluation.correct && step.hint && !advice.includes(step.hint)) {
      advice.push(step.hint);
    }
  });

  return {
    totalPoints,
    maxPoints,
    scorePercent: maxPoints === 0 ? 0 : Math.round((totalPoints / maxPoints) * 100),
    correctCount,
    partialCount,
    missedCount,
    averageResponseMs: responseCount === 0 ? 0 : Math.round(responseSum / responseCount),
    advice,
  };
}

// ============================================================================
// VALIDATION D'UN SCÉNARIO
// ============================================================================

export interface ScenarioIssue {
  code: string;
  message: string;
  stepId?: string;
}

/** Bornes de sécurité sur ce qu'un admin peut composer depuis le dashboard. */
export const SCENARIO_LIMITS = {
  maxSteps: 30,
  maxDelaySeconds: 600,
  maxPoints: 100,
  maxContentLength: 1500,
} as const;

export function validateScenario(scenario: Partial<Scenario>): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];

  if (!scenario.title?.trim()) {
    issues.push({ code: 'NO_TITLE', message: 'Le scénario doit avoir un titre.' });
  }

  const steps = scenario.steps ?? [];
  if (steps.length === 0) {
    issues.push({ code: 'NO_STEPS', message: 'Le scénario ne contient aucune étape.' });
  }
  if (steps.length > SCENARIO_LIMITS.maxSteps) {
    issues.push({
      code: 'TOO_MANY_STEPS',
      message: `Un scénario est limité à ${SCENARIO_LIMITS.maxSteps} étapes.`,
    });
  }

  for (const step of steps) {
    if (!step.content?.trim()) {
      issues.push({ code: 'EMPTY_CONTENT', message: 'Une étape a un message vide.', stepId: step.id });
    }
    if (!step.authorName?.trim()) {
      issues.push({ code: 'NO_AUTHOR', message: 'Une étape n\'a pas de pseudo d\'auteur.', stepId: step.id });
    }
    if (step.points <= 0 || step.points > SCENARIO_LIMITS.maxPoints) {
      issues.push({
        code: 'BAD_POINTS',
        message: `Les points doivent être compris entre 1 et ${SCENARIO_LIMITS.maxPoints}.`,
        stepId: step.id,
      });
    }
    if (step.delaySeconds < 0 || step.delaySeconds > SCENARIO_LIMITS.maxDelaySeconds) {
      issues.push({
        code: 'BAD_DELAY',
        message: `Le délai doit être compris entre 0 et ${SCENARIO_LIMITS.maxDelaySeconds} secondes.`,
        stepId: step.id,
      });
    }
    // Une exclusion sans durée attendue rendrait l'étape impossible à noter.
    if (step.expected?.action === 'MUTE' && !step.expected.muteMinutes) {
      issues.push({
        code: 'MUTE_WITHOUT_DURATION',
        message: 'Une exclusion attendue doit préciser une durée.',
        stepId: step.id,
      });
    }
  }

  return issues;
}
