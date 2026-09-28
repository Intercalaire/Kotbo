import type { AnalyticsQuery } from '../../api';

/**
 * Filtres globaux de la page Analytics : période, comparaison avec la période
 * d'avant, salon ou catégorie, rôle, exclusion du staff, bots comptés ou non.
 * Chaque section lit `query` et se recharge quand `key` change.
 *
 * La période et la comparaison sont retenues dans le navigateur, par confort :
 * une lecture ou une écriture refusée (navigation privée) ne casse rien.
 */

export type PeriodPreset = '1' | '7' | '30' | '90' | '365' | 'custom';

const STORAGE_KEY = 'kotbo.analytics.view';
const PRESETS: PeriodPreset[] = ['1', '7', '30', '90', '365'];

function readStored(): { period?: PeriodPreset; compare?: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

class AnalyticsFiltersStore {
  period = $state<PeriodPreset>('30');
  /** Bornes en cours de saisie (datetime-local). */
  customStart = $state('');
  customEnd = $state('');
  /** Bornes validées par « Appliquer ». */
  appliedStart = $state('');
  appliedEnd = $state('');
  compare = $state(true);
  channel = $state<string | null>(null);
  role = $state<string | null>(null);
  excludeStaff = $state(false);
  includeBots = $state(false);

  constructor() {
    const stored = typeof window === 'undefined' ? {} : readStored();
    if (stored.period && PRESETS.includes(stored.period)) this.period = stored.period;
    if (typeof stored.compare === 'boolean') this.compare = stored.compare;

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    this.customEnd = now.toISOString().slice(0, 16);
    const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    this.customStart = start.toISOString().slice(0, 16);
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ period: this.period === 'custom' ? '30' : this.period, compare: this.compare }));
    } catch {
      /* stockage indisponible : on garde l'état en mémoire */
    }
  }

  get isCustom(): boolean {
    return this.period === 'custom' && Boolean(this.appliedStart && this.appliedEnd);
  }

  /** Nombre de jours couverts, pour les appels qui ne prennent qu'une durée. */
  get days(): number {
    if (this.isCustom) {
      const span = Date.parse(this.appliedEnd) - Date.parse(this.appliedStart);
      return Math.max(1, Math.round(span / (24 * 3600 * 1000)) + 1);
    }
    return this.period === 'custom' ? 30 : Number(this.period);
  }

  /** Période seule, pour les anciens composants qui ne connaissent pas les filtres. */
  get periodQuery(): { period?: number; startDate?: string; endDate?: string } {
    return this.isCustom ? { startDate: this.appliedStart, endDate: this.appliedEnd } : { period: this.days };
  }

  get query(): AnalyticsQuery {
    return {
      ...this.periodQuery,
      channel: this.channel,
      role: this.role,
      excludeStaff: this.excludeStaff,
      includeBots: this.includeBots,
    };
  }

  get periodKey(): string {
    return JSON.stringify(this.periodQuery);
  }

  get key(): string {
    return JSON.stringify(this.query);
  }

  /** Nombre de filtres de périmètre actifs (hors période). */
  get activeScopeFilters(): number {
    return (this.channel ? 1 : 0) + (this.role ? 1 : 0) + (this.excludeStaff ? 1 : 0);
  }

  setPeriod(period: PeriodPreset) {
    this.period = period;
    if (period !== 'custom') this.persist();
  }

  applyCustom() {
    if (!this.customStart || !this.customEnd) return;
    this.appliedStart = this.customStart;
    this.appliedEnd = this.customEnd;
  }

  toggleCompare() {
    this.compare = !this.compare;
    this.persist();
  }

  clearScope() {
    this.channel = null;
    this.role = null;
    this.excludeStaff = false;
  }
}

export const analyticsFilters = new AnalyticsFiltersStore();

/** Écart entre deux valeurs, pour les tuiles et les tableaux. */
export function relativeDelta(value: number, previous: number): number | null {
  if (previous === 0) return value === 0 ? 0 : null;
  return ((value - previous) / previous) * 100;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Données chargées par les sections ouvertes, pour l'export de la page. Chaque
 * section y dépose sa dernière réponse sous son nom.
 */
export const analyticsExport: Record<string, unknown> = $state({});
