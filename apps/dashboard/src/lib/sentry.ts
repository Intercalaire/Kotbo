import * as Sentry from '@sentry/browser';

let initialized = false;

function parseRate(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function initDashboardSentry(): boolean {
  if (initialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: parseRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined, 0.1),
  });

  initialized = true;
  return true;
}

/**
 * Remonte un echec d'appel au backend.
 *
 * Sentry etait initialise mais rien ne lui parlait : aucune panne cote
 * dashboard n'arrivait jusqu'aux alertes. Les echecs sont regroupes par
 * categorie et par route plutot que par message, faute de quoi chaque guilde
 * aurait cree son propre incident.
 *
 * `extra` porte le contexte necessaire au diagnostic. Aucun jeton ni identifiant
 * d'utilisateur n'y figure : la route et la guilde suffisent a retrouver la
 * trace cote bot.
 */
export function captureApiFailure(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  if (!initialized) return;

  const details = error as {
    kind?: string;
    status?: number;
    code?: string;
    method?: string;
    path?: string;
  };

  Sentry.withScope((scope) => {
    scope.setLevel(details.status && details.status < 500 ? 'warning' : 'error');
    scope.setTag('api.kind', details.kind ?? 'unknown');
    scope.setTag('api.route', `${details.method ?? 'GET'} ${details.path ?? 'unknown'}`);
    if (details.status !== undefined) scope.setTag('api.status', String(details.status));
    if (details.code) scope.setTag('api.code', details.code);
    scope.setFingerprint(['api', details.kind ?? 'unknown', details.method ?? 'GET', details.path ?? 'unknown']);
    scope.setExtras(extra);
    Sentry.captureException(error);
  });
}
