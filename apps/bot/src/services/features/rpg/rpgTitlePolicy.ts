/**
 * Bornes et normalisation d'un titre saisi au dashboard ou par MCP.
 *
 * Aucun accès base : les bornes décident de l'équilibrage (un titre à +10 000 d'attaque
 * rendrait son porteur invincible) et doivent rester vérifiables en test.
 */

/**
 * Le titre s'écrit en gras 15 px dans les 260 px au-dessus du portrait : vingt-quatre
 * caractères y tiennent en entier. Plus long, la carte le couperait d'une ellipse.
 */
export const TITLE_NAME_MAX = 24;
export const TITLE_DESCRIPTION_MAX = 200;

export const TITLE_STAT_RANGE = { min: 0, max: 1_000 } as const;
export const TITLE_HEALTH_RANGE = { min: 0, max: 10_000 } as const;
/** En points de pourcentage : le plafond global du critique s'applique de toute façon. */
export const TITLE_CRIT_RANGE = { min: 0, max: 25 } as const;

export const DEFAULT_TITLE_COLOR = '#fbbf24';

export interface TitleInput {
  name?: unknown;
  description?: unknown;
  color?: unknown;
  attackBonus?: unknown;
  defenseBonus?: unknown;
  speedBonus?: unknown;
  healthBonus?: unknown;
  critBonus?: unknown;
}

export interface NormalizedTitle {
  name: string;
  description: string;
  color: string;
  attackBonus: number;
  defenseBonus: number;
  speedBonus: number;
  healthBonus: number;
  critBonus: number;
}

export type NormalizeTitleResult =
  | { ok: true; value: NormalizedTitle }
  | { ok: false; error: string };

function clampInt(value: unknown, range: { min: number; max: number }): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTitleInput(input: TitleInput): NormalizeTitleResult {
  const name = text(input.name);
  if (!name) return { ok: false, error: 'Le nom du titre est obligatoire.' };
  if (name.length > TITLE_NAME_MAX) {
    return { ok: false, error: `Le nom du titre ne peut pas dépasser ${TITLE_NAME_MAX} caractères.` };
  }

  const color = text(input.color);

  return {
    ok: true,
    value: {
      name,
      description: text(input.description).slice(0, TITLE_DESCRIPTION_MAX),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_TITLE_COLOR,
      attackBonus: clampInt(input.attackBonus, TITLE_STAT_RANGE),
      defenseBonus: clampInt(input.defenseBonus, TITLE_STAT_RANGE),
      speedBonus: clampInt(input.speedBonus, TITLE_STAT_RANGE),
      healthBonus: clampInt(input.healthBonus, TITLE_HEALTH_RANGE),
      critBonus: clampInt(input.critBonus, TITLE_CRIT_RANGE),
    },
  };
}

/** Bonus d'un titre, en une ligne lisible. Vide quand le titre est purement décoratif. */
export function titleBonusParts(title: {
  attackBonus: number;
  defenseBonus: number;
  speedBonus: number;
  healthBonus: number;
  critBonus: number;
}): { stat: 'atk' | 'def' | 'spd' | 'hp' | 'crit'; value: number }[] {
  return [
    { stat: 'atk' as const, value: title.attackBonus },
    { stat: 'def' as const, value: title.defenseBonus },
    { stat: 'spd' as const, value: title.speedBonus },
    { stat: 'hp' as const, value: title.healthBonus },
    { stat: 'crit' as const, value: title.critBonus },
  ].filter((part) => part.value > 0);
}
