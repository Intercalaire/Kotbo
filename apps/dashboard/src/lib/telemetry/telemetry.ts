/**
 * Télémétrie produit du dashboard.
 *
 * Tout est agrégé ici, dans le navigateur : un événement n'est qu'un compteur
 * (et une somme de valeurs) sous une clé serveur × page × onglet × module ×
 * événement × dimension. Le lot part toutes les 30 s et au départ de la page,
 * vers POST /api/dashboard/telemetry, qui le revalide avec le même contrat
 * (`sanitizeTelemetryEntry`).
 *
 * Ne part jamais : texte saisi, URL complète, identifiant d'un membre ou d'un
 * salon. L'ID Discord de la personne n'est connu que du bot, qui n'en garde
 * qu'un hash du jour.
 *
 * La télémétrie ne doit jamais gêner : aucune fonction de ce module ne lève,
 * et un envoi raté est simplement perdu.
 */
import {
  DASHBOARD_TELEMETRY_LIMITS,
  latencyBucketFor,
  type DashboardNavSource,
  type DashboardTelemetryEntry,
  type DashboardTelemetryEvent,
} from '@kotbo/contracts';
import { authStore } from '../stores/auth.svelte';
import type { TelemetryPage } from './pageKey';

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
const ENDPOINT = `${API_BASE_URL}/api/dashboard/telemetry`;
const FLUSH_INTERVAL_MS = 30_000;
const TICK_MS = 5_000;
/** Sans interaction depuis une minute, la personne n'est plus là : le temps ne court plus. */
const IDLE_AFTER_MS = 60_000;
const SESSION_KEY = 'kotbo:telemetry:session';
const MAX_JS_ERRORS_PER_SESSION = 20;
const GUILD_ID_RE = /^\d{17,20}$/;

type Bucket = DashboardTelemetryEntry;

const buffer = new Map<string, Bucket>();

type Visit = TelemetryPage & { guildId: string; activeMs: number };
let current: Visit | null = null;
let pendingSource: DashboardNavSource | null = null;
let firstView = true;
let lastInteraction = Date.now();
let lastTick = Date.now();
let jsErrors = 0;
let started = false;

function currentGuildId(): string {
  const id = authStore.selectedGuildId;
  return id && GUILD_ID_RE.test(id) ? id : '';
}

/** Comme `telemetrySlug`, en gardant `:` et `.` qui séparent une famille de sa valeur. */
function dimensionSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, DASHBOARD_TELEMETRY_LIMITS.dimensionMaxLength);
}

function add(event: DashboardTelemetryEvent, options: { dimension?: string; value?: number; context?: Visit | null } = {}): void {
  try {
    const ctx = options.context === undefined ? current : options.context;
    const entry: Omit<Bucket, 'count' | 'valueSum'> = {
      guildId: ctx?.guildId ?? currentGuildId(),
      page: ctx?.page ?? '/',
      tab: event === 'tab_view' ? ctx?.tab ?? '' : '',
      feature: ctx?.feature ?? '',
      event,
      dimension: dimensionSlug(options.dimension ?? ''),
    };
    const key = [entry.guildId, entry.page, entry.tab, entry.feature, entry.event, entry.dimension].join('\u0001');
    const bucket = buffer.get(key) ?? { ...entry, count: 0, valueSum: 0 };
    bucket.count += 1;
    if (options.value !== undefined && Number.isFinite(options.value)) {
      bucket.valueSum += Math.min(Math.max(Math.round(options.value), 0), DASHBOARD_TELEMETRY_LIMITS.maxValue);
    }
    buffer.set(key, bucket);
  } catch {
    // La télémétrie ne casse jamais la page.
  }
}

/** Un événement ponctuel rattaché à la page courante. */
export function trackEvent(event: DashboardTelemetryEvent, dimension?: string, value?: number): void {
  add(event, { dimension, value });
}

/** Source de la prochaine navigation (barre latérale, palette, favoris…). */
export function markNavigationSource(source: DashboardNavSource): void {
  pendingSource = source;
}

function tickActiveTime(): void {
  const now = Date.now();
  const elapsed = now - lastTick;
  lastTick = now;
  if (!current) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (now - lastInteraction > IDLE_AFTER_MS) return;
  current.activeMs += Math.min(elapsed, TICK_MS * 2);
}

function finishVisit(exit: boolean): void {
  if (!current) return;
  tickActiveTime();
  if (current.activeMs > 0) {
    add('page_time', { value: current.activeMs, context: { ...current, tab: '' } });
  }
  if (exit) add('page_exit', { context: current });
  current.activeMs = 0;
}

/** À appeler à chaque changement de route, avec la page déjà résolue (ou null hors registre). */
export function trackRoute(resolved: TelemetryPage | null): void {
  try {
    const guildId = currentGuildId();
    if (!resolved) {
      finishVisit(false);
      current = null;
      pendingSource = null;
      return;
    }

    const samePage = current && current.page === resolved.page && current.guildId === guildId;
    if (samePage) {
      if (current!.tab !== resolved.tab) {
        current!.tab = resolved.tab;
        if (resolved.tab) add('tab_view');
      }
      pendingSource = null;
      return;
    }

    finishVisit(false);
    current = { ...resolved, guildId, activeMs: 0 };
    lastTick = Date.now();
    lastInteraction = Date.now();
    const source: DashboardNavSource = firstView ? 'entry' : pendingSource ?? 'link';
    firstView = false;
    pendingSource = null;
    add('page_view', { dimension: source });
    if (resolved.tab) add('tab_view');
  } catch {
    // idem
  }
}

/**
 * Issue d'un appel API, relevée par le socle HTTP (`performRequest`).
 * Les lectures donnent latence et erreurs, les écritures les enregistrements.
 */
export function trackApiResult(result: {
  method: string;
  ok: boolean;
  durationMs: number;
  errorKind?: string;
  refusalCode?: string;
}): void {
  const method = result.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  if (result.refusalCode) {
    add('blocked', { dimension: result.refusalCode });
    return;
  }
  if (isRead) {
    if (result.ok) add('api_latency', { dimension: latencyBucketFor(result.durationMs), value: result.durationMs });
    else add('api_error', { dimension: result.errorKind ?? 'unknown' });
  } else if (result.ok) {
    add('save', { dimension: method.toLowerCase() });
  } else {
    add('save_error', { dimension: result.errorKind ?? 'unknown' });
  }
}

export function trackRouteLoad(durationMs: number): void {
  add('route_load', { dimension: latencyBucketFor(durationMs), value: durationMs });
}

export function trackJsError(name: string): void {
  if (jsErrors >= MAX_JS_ERRORS_PER_SESSION) return;
  jsErrors += 1;
  add('js_error', { dimension: name || 'error' });
}

function drain(): DashboardTelemetryEntry[] {
  const entries = [...buffer.values()];
  buffer.clear();
  return entries;
}

function send(entries: DashboardTelemetryEntry[], keepalive: boolean): void {
  const token = authStore.token;
  if (!token || entries.length === 0) return;
  // keepalive plafonne le corps à 64 Ko : on découpe en lots bien en dessous.
  const size = Math.min(DASHBOARD_TELEMETRY_LIMITS.maxEntriesPerBatch, 200);
  for (let i = 0; i < entries.length; i += size) {
    const body = JSON.stringify({ entries: entries.slice(i, i + size) });
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
      credentials: 'include',
      keepalive,
    }).catch(() => undefined);
  }
}

export function flushTelemetry(keepalive = false): void {
  try {
    tickActiveTime();
    // Le temps en cours part avec le lot, sans clore la visite : la page reste ouverte.
    if (current && current.activeMs > 0) {
      add('page_time', { value: current.activeMs, context: { ...current, tab: '' } });
      current.activeMs = 0;
    }
    send(drain(), keepalive);
  } catch {
    // idem
  }
}

function deviceClass(): string {
  const width = window.innerWidth;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (width < 768) return 'mobile';
  if (coarse && width < 1280) return 'tablet';
  return 'desktop';
}

function viewportBucket(): string {
  const w = window.innerWidth;
  if (w < 640) return 'vw_lt640';
  if (w < 1024) return 'vw_640_1024';
  if (w < 1440) return 'vw_1024_1440';
  if (w < 1920) return 'vw_1440_1920';
  return 'vw_gte1920';
}

function startSession(env: { theme: string; locale: string }): void {
  let isNew = true;
  try {
    isNew = sessionStorage.getItem(SESSION_KEY) === null;
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Stockage indisponible (navigation privée) : chaque chargement compte comme une session.
  }
  if (!isNew) {
    // Rechargement dans la même session : ni nouvelle session, ni page d'entrée.
    firstView = false;
    pendingSource = 'reload';
    return;
  }
  const noContext = null;
  add('session_start', { dimension: deviceClass(), context: noContext });
  add('session_env', { dimension: `theme:${env.theme}`, context: noContext });
  add('session_env', { dimension: `locale:${env.locale}`, context: noContext });
  add('session_env', { dimension: viewportBucket(), context: noContext });
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  add('session_env', { dimension: standalone ? 'display:pwa' : 'display:browser', context: noContext });
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    add('session_env', { dimension: 'reduced_motion', context: noContext });
  }
}

function observeWebVitals(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.responseStart > 0) add('web_vital', { dimension: 'ttfb', value: nav.responseStart });

    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    if (paint) add('web_vital', { dimension: 'fcp', value: paint.startTime });

    if (typeof PerformanceObserver === 'undefined') return;
    let lcp = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    // Le LCP se fige à la première interaction ou au départ de la page.
    const finalize = () => {
      observer.disconnect();
      if (lcp > 0) add('web_vital', { dimension: 'lcp', value: lcp });
      lcp = 0;
    };
    addEventListener('pointerdown', finalize, { once: true, capture: true });
    addEventListener('keydown', finalize, { once: true, capture: true });
    addEventListener('pagehide', finalize, { once: true });
  } catch {
    // Navigateur sans API de performance.
  }
}

function markInteraction(): void {
  lastInteraction = Date.now();
}

/**
 * Démarre la collecte. Idempotent. `env` donne le contexte de session que ce
 * module ne connaît pas lui-même (thème, langue).
 */
export function startTelemetry(env: { theme: string; locale: string }): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  startSession(env);
  observeWebVitals();

  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    addEventListener(type, markInteraction, { passive: true, capture: true });
  }
  let lastMove = 0;
  addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMove > 5_000) {
      lastMove = now;
      markInteraction();
    }
  }, { passive: true });

  // Source des navigations : un lien cliqué dans une zone marquée
  // `data-telemetry-nav` (barre latérale, favoris…) ; précédent/suivant du navigateur.
  addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.('a[href]');
    if (!link) return;
    const zone = link.closest('[data-telemetry-nav]') as HTMLElement | null;
    const source = zone?.dataset.telemetryNav as DashboardNavSource | undefined;
    if (source) markNavigationSource(source);
  }, { capture: true });
  addEventListener('popstate', () => markNavigationSource('history'));

  addEventListener('error', (event) => {
    const error = (event as ErrorEvent).error as { name?: string } | undefined;
    trackJsError(error?.name ?? 'error');
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason as { name?: string } | undefined;
    // Les erreurs d'API ont déjà leur propre compteur.
    if (reason?.name === 'DashboardApiError') return;
    trackJsError(`unhandled_${reason?.name ?? 'rejection'}`);
  });

  setInterval(tickActiveTime, TICK_MS);
  setInterval(() => flushTelemetry(false), FLUSH_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTelemetry(true);
    else lastTick = Date.now();
  });
  addEventListener('pagehide', () => {
    finishVisit(true);
    send(drain(), true);
  });
}
