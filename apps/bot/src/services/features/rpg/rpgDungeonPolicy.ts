/**
 * Règles des donjons : bornes de saisie, délai entre deux entrées et butin en attente.
 *
 * Aucun accès base. Un donjon enchaîne des boss du bestiaire désignés par leur nom ; les PV
 * ne remontent pas d'un étage à l'autre, et tout ce que les boss lâchent reste en attente
 * sur la partie jusqu'à la sortie. Une défaite fait tout perdre. Une partie se joue d'une
 * traite : quitter le donjon la clôt, et une trop longue inactivité compte comme une défaite.
 */

export const DUNGEON_NAME_MAX = 50;
export const DUNGEON_DESCRIPTION_MAX = 300;
export const DUNGEON_FLOORS_MIN = 1;
/** Au-delà, la liste des étages ne tient plus sur l'écran de la partie. */
export const DUNGEON_FLOORS_MAX = 10;
/** Donjons par serveur : chacun occupe une section de la salle, limitée par Discord. */
export const DUNGEONS_PER_GUILD_MAX = 20;
export const DUNGEON_LEVEL_RANGE = { min: 1, max: 1000 } as const;
export const DUNGEON_ENERGY_RANGE = { min: 0, max: 1000 } as const;
export const DUNGEON_COOLDOWN_HOURS_RANGE = { min: 0, max: 720 } as const;
export const DUNGEON_REWARD_RANGE = { min: 0, max: 1_000_000 } as const;
/** En dessous, un étage se joue perdu d'avance : le joueur est renvoyé vers ses potions. */
export const DUNGEON_MIN_HEALTH = 10;

/**
 * Inactivité au-delà de laquelle une partie compte comme perdue. Sans elle, un joueur
 * pourrait laisser la partie ouverte le temps que ses PV remontent, et le donjon n'aurait
 * plus rien d'une épreuve sans repos.
 */
export const DUNGEON_IDLE_TIMEOUT_MINUTES = 60;

export function isDungeonRunExpired(lastActionAt: Date, now: number = Date.now()): boolean {
  return now - lastActionAt.getTime() > DUNGEON_IDLE_TIMEOUT_MINUTES * 60 * 1000;
}

export const DUNGEON_RUN_STATUSES = ['ACTIVE', 'COMPLETED', 'LEFT', 'DEFEATED'] as const;
export type DungeonRunStatus = (typeof DUNGEON_RUN_STATUSES)[number];

export interface DungeonInput {
  name?: unknown;
  description?: unknown;
  emoji?: unknown;
  levelRequired?: unknown;
  energyCost?: unknown;
  cooldownHours?: unknown;
  bossNames?: unknown;
  completionCoins?: unknown;
  completionXp?: unknown;
  completionItemName?: unknown;
  completionTitleId?: unknown;
  completionRoleId?: unknown;
  firstClearCoins?: unknown;
  firstClearXp?: unknown;
  firstClearItemName?: unknown;
  firstClearTitleId?: unknown;
  firstClearRoleId?: unknown;
  enabled?: unknown;
}

export type NormalizedDungeon = {
  name: string;
  description: string;
  emoji: string;
  levelRequired: number;
  energyCost: number;
  cooldownHours: number;
  bossNames: string[];
  completionCoins: number;
  completionXp: number;
  completionItemName: string | null;
  completionTitleId: string | null;
  completionRoleId: string | null;
  firstClearCoins: number;
  firstClearXp: number;
  firstClearItemName: string | null;
  firstClearTitleId: string | null;
  firstClearRoleId: string | null;
  enabled: boolean;
};

export type DungeonNormalizeResult = { ok: true; value: NormalizedDungeon } | { ok: false; error: string };

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeDungeonInput(input: DungeonInput): DungeonNormalizeResult {
  const name = text(input.name);
  if (!name) return { ok: false, error: 'Le nom du donjon est obligatoire.' };
  if (name.length > DUNGEON_NAME_MAX) {
    return { ok: false, error: `Le nom du donjon ne peut pas dépasser ${DUNGEON_NAME_MAX} caractères.` };
  }

  const description = text(input.description);
  if (description.length > DUNGEON_DESCRIPTION_MAX) {
    return { ok: false, error: `La description ne peut pas dépasser ${DUNGEON_DESCRIPTION_MAX} caractères.` };
  }

  if (!Array.isArray(input.bossNames)) return { ok: false, error: 'La liste des étages est invalide.' };
  // Un même boss peut revenir à plusieurs étages : c'est un choix de conception, pas une erreur.
  const bossNames = input.bossNames.map(text);
  if (bossNames.some((bossName) => !bossName)) return { ok: false, error: 'Chaque étage doit désigner un boss.' };
  if (bossNames.length < DUNGEON_FLOORS_MIN) return { ok: false, error: 'Un donjon compte au moins un étage.' };
  if (bossNames.length > DUNGEON_FLOORS_MAX) {
    return { ok: false, error: `Un donjon ne peut pas dépasser ${DUNGEON_FLOORS_MAX} étages.` };
  }

  return {
    ok: true,
    value: {
      name,
      description,
      emoji: text(input.emoji) || '🏰',
      levelRequired: clampInt(input.levelRequired, DUNGEON_LEVEL_RANGE, 1),
      energyCost: clampInt(input.energyCost, DUNGEON_ENERGY_RANGE, 40),
      cooldownHours: clampInt(input.cooldownHours, DUNGEON_COOLDOWN_HOURS_RANGE, 24),
      bossNames,
      completionCoins: clampInt(input.completionCoins, DUNGEON_REWARD_RANGE, 0),
      completionXp: clampInt(input.completionXp, DUNGEON_REWARD_RANGE, 0),
      completionItemName: text(input.completionItemName) || null,
      completionTitleId: text(input.completionTitleId) || null,
      completionRoleId: text(input.completionRoleId) || null,
      firstClearCoins: clampInt(input.firstClearCoins, DUNGEON_REWARD_RANGE, 0),
      firstClearXp: clampInt(input.firstClearXp, DUNGEON_REWARD_RANGE, 0),
      firstClearItemName: text(input.firstClearItemName) || null,
      firstClearTitleId: text(input.firstClearTitleId) || null,
      firstClearRoleId: text(input.firstClearRoleId) || null,
      enabled: input.enabled !== false,
    },
  };
}

export function hasFirstClearReward(dungeon: {
  firstClearCoins: number;
  firstClearXp: number;
  firstClearItemName: string | null;
  firstClearTitleId: string | null;
  firstClearRoleId: string | null;
}): boolean {
  return dungeon.firstClearCoins > 0
    || dungeon.firstClearXp > 0
    || dungeon.firstClearItemName !== null
    || dungeon.firstClearTitleId !== null
    || dungeon.firstClearRoleId !== null;
}

/** Instant où le joueur pourra rentrer dans le donjon, `null` s'il le peut déjà. */
export function dungeonReadyAt(
  lastStartedAt: Date | null | undefined,
  cooldownHours: number,
  now: number = Date.now(),
): Date | null {
  if (!lastStartedAt || cooldownHours <= 0) return null;
  const readyAt = lastStartedAt.getTime() + cooldownHours * 60 * 60 * 1000;
  return readyAt > now ? new Date(readyAt) : null;
}

export type DungeonLoot = { itemName: string; emoji: string | null };

export function parseDungeonLoot(value: unknown): DungeonLoot[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { itemName: unknown; emoji?: unknown } => typeof entry === 'object' && entry !== null && 'itemName' in entry)
    .filter((entry) => typeof entry.itemName === 'string' && entry.itemName.length > 0)
    .map((entry) => ({ itemName: entry.itemName as string, emoji: typeof entry.emoji === 'string' ? entry.emoji : null }));
}

/** Butin regroupé par objet, pour l'afficher et le verser en une ligne par objet. */
export function groupDungeonLoot(loot: DungeonLoot[]): Array<DungeonLoot & { quantity: number }> {
  const byName = new Map<string, DungeonLoot & { quantity: number }>();
  for (const entry of loot) {
    const known = byName.get(entry.itemName);
    if (known) known.quantity += 1;
    else byName.set(entry.itemName, { ...entry, quantity: 1 });
  }
  return [...byName.values()];
}

/**
 * Ce que la sortie verse : le butin des boss, plus le coffre si le dernier étage est tombé.
 * Une défaite ne verse rien.
 */
export function dungeonPayout(
  run: { xpEarned: number; coinsEarned: number; loot: DungeonLoot[] },
  outcome: Exclude<DungeonRunStatus, 'ACTIVE'>,
  chest: { completionCoins: number; completionXp: number; completionItemName: string | null },
): { coins: number; xp: number; items: DungeonLoot[] } {
  if (outcome === 'DEFEATED') return { coins: 0, xp: 0, items: [] };

  const completed = outcome === 'COMPLETED';
  return {
    coins: run.coinsEarned + (completed ? chest.completionCoins : 0),
    xp: run.xpEarned + (completed ? chest.completionXp : 0),
    items: completed && chest.completionItemName
      ? [...run.loot, { itemName: chest.completionItemName, emoji: null }]
      : run.loot,
  };
}
