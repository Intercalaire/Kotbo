/**
 * Carte de la Tour dessinée depuis le dashboard. Aucun accès base.
 *
 * Une carte est une grille de salles. Deux salles communiquent quand elles se touchent par
 * un côté ; une case sans salle est un mur. Le boss occupe une grande salle de 2×2, ancrée
 * sur sa case en haut à gauche. Le joueur part de la salle de départ, choisit son chemin à
 * chaque embranchement, et la carte recommence, plus dure, une fois un boss abattu.
 */

export const TOWER_ROOM_TYPES = ['START', 'MONSTER', 'ELITE', 'BOSS', 'CHEST', 'CAMPFIRE', 'MERCHANT', 'SHRINE', 'EMPTY'] as const;
export type TowerRoomType = (typeof TOWER_ROOM_TYPES)[number];

export const TOWER_CHEST_KINDS = ['BOTH', 'GOLD', 'GEAR'] as const;
export type TowerChestKind = (typeof TOWER_CHEST_KINDS)[number];

export const TOWER_OFFER_KINDS = ['POTION', 'HEAL', 'GEAR'] as const;
export type TowerOfferKind = (typeof TOWER_OFFER_KINDS)[number];

export const TOWER_MAP_SIZE = { min: 3, max: 12 } as const;
export const TOWER_MAP_ROOMS_MAX = 100;
export const TOWER_MERCHANT_OFFERS_MAX = 4;
export const TOWER_HEAL_PERCENT_RANGE = { min: 5, max: 100 } as const;
export const TOWER_PRICE_PERCENT_RANGE = { min: 10, max: 500 } as const;
const FOE_NAME_MAX = 100;

export type TowerRoom = {
  id: string;
  x: number;
  y: number;
  type: TowerRoomType;
  /** Créature imposée (nom exact du bestiaire) pour un monstre, une élite ou un boss. */
  foe: string | null;
  /** Contenu d'un coffre. */
  chest: TowerChestKind;
  /** Soin d'un feu de camp, en pourcentage des PV maximum. */
  healPercent: number;
  /** Articles d'un marchand, dans l'ordre d'affichage. */
  offers: TowerOfferKind[];
  /** Prix d'un marchand, en pourcentage du prix normal. */
  pricePercent: number;
};

export type TowerLayout = { width: number; height: number; rooms: TowerRoom[] };

export type TowerDirection = 'N' | 'S' | 'E' | 'W';

export function roomId(x: number, y: number): string {
  return `${x}-${y}`;
}

/** Cases occupées par une salle : quatre pour le boss, une pour les autres. */
export function roomCells(room: Pick<TowerRoom, 'x' | 'y' | 'type'>): [number, number][] {
  if (room.type !== 'BOSS') return [[room.x, room.y]];
  return [[room.x, room.y], [room.x + 1, room.y], [room.x, room.y + 1], [room.x + 1, room.y + 1]];
}

/** Salle qui occupe chaque case, indexée par `x,y`. */
export function occupancy(layout: TowerLayout): Map<string, TowerRoom> {
  const cells = new Map<string, TowerRoom>();
  for (const room of layout.rooms) {
    for (const [x, y] of roomCells(room)) cells.set(`${x},${y}`, room);
  }
  return cells;
}

const STEPS: [TowerDirection, number, number][] = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]];

/** Salles voisines d'une salle, chacune une seule fois, avec la direction pour y aller. */
export function roomNeighbors(layout: TowerLayout, id: string, cells = occupancy(layout)): { room: TowerRoom; direction: TowerDirection }[] {
  const room = layout.rooms.find((candidate) => candidate.id === id);
  if (!room) return [];
  const found = new Map<string, { room: TowerRoom; direction: TowerDirection }>();
  for (const [x, y] of roomCells(room)) {
    for (const [direction, dx, dy] of STEPS) {
      const neighbor = cells.get(`${x + dx},${y + dy}`);
      if (neighbor && neighbor.id !== room.id && !found.has(neighbor.id)) found.set(neighbor.id, { room: neighbor, direction });
    }
  }
  return [...found.values()];
}

export function startRoom(layout: TowerLayout): TowerRoom | null {
  return layout.rooms.find((room) => room.type === 'START') ?? null;
}

/** Distance en salles de chaque salle depuis le départ ; les salles injoignables sont absentes. */
export function distancesFromStart(layout: TowerLayout): Map<string, number> {
  const start = startRoom(layout);
  const distances = new Map<string, number>();
  if (!start) return distances;
  const cells = occupancy(layout);
  const queue = [start.id];
  distances.set(start.id, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { room } of roomNeighbors(layout, current, cells)) {
      if (distances.has(room.id)) continue;
      distances.set(room.id, distances.get(current)! + 1);
      queue.push(room.id);
    }
  }
  return distances;
}

/** Plus court chemin du départ jusqu'à un boss, en salles franchies. */
export function shortestPathToBoss(layout: TowerLayout): number | null {
  const distances = distancesFromStart(layout);
  const reachable = layout.rooms.filter((room) => room.type === 'BOSS' && distances.has(room.id)).map((room) => distances.get(room.id)!);
  return reachable.length > 0 ? Math.min(...reachable) : null;
}

export type TowerLayoutResult = { ok: true; value: TowerLayout } | { ok: false; error: string };

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

/**
 * Valide une carte : dimensions, salles dans la grille et sans chevauchement, un seul départ,
 * au moins un boss, et toutes les salles joignables depuis le départ. Une salle isolée ne
 * pourrait jamais être visitée : c'est presque toujours une erreur de dessin.
 */
export function normalizeTowerLayout(input: unknown): TowerLayoutResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Carte invalide.' };
  const raw = input as Record<string, unknown>;
  const width = clampInt(raw.width, TOWER_MAP_SIZE, 0);
  const height = clampInt(raw.height, TOWER_MAP_SIZE, 0);
  if (width === 0 || height === 0) return { ok: false, error: `La carte mesure de ${TOWER_MAP_SIZE.min} à ${TOWER_MAP_SIZE.max} cases de côté.` };
  if (!Array.isArray(raw.rooms)) return { ok: false, error: 'La liste des salles est invalide.' };
  if (raw.rooms.length > TOWER_MAP_ROOMS_MAX) return { ok: false, error: `Une carte compte au plus ${TOWER_MAP_ROOMS_MAX} salles.` };

  const rooms: TowerRoom[] = [];
  const taken = new Set<string>();
  for (const entry of raw.rooms) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Salle invalide.' };
    const cell = entry as Record<string, unknown>;
    const type = TOWER_ROOM_TYPES.includes(cell.type as TowerRoomType) ? (cell.type as TowerRoomType) : null;
    if (!type) return { ok: false, error: 'Type de salle inconnu.' };
    const x = Number(cell.x);
    const y = Number(cell.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, error: 'Position de salle invalide.' };

    const room: TowerRoom = {
      id: roomId(x, y),
      x,
      y,
      type,
      foe: (type === 'MONSTER' || type === 'ELITE' || type === 'BOSS') && typeof cell.foe === 'string' && cell.foe.trim()
        ? cell.foe.trim().slice(0, FOE_NAME_MAX)
        : null,
      chest: TOWER_CHEST_KINDS.includes(cell.chest as TowerChestKind) ? (cell.chest as TowerChestKind) : 'BOTH',
      healPercent: clampInt(cell.healPercent, TOWER_HEAL_PERCENT_RANGE, 35),
      offers: Array.isArray(cell.offers)
        ? cell.offers.filter((offer): offer is TowerOfferKind => TOWER_OFFER_KINDS.includes(offer as TowerOfferKind)).slice(0, TOWER_MERCHANT_OFFERS_MAX)
        : [...TOWER_OFFER_KINDS],
      pricePercent: clampInt(cell.pricePercent, TOWER_PRICE_PERCENT_RANGE, 100),
    };
    if (type === 'MERCHANT' && room.offers.length === 0) return { ok: false, error: 'Un marchand doit vendre au moins un article.' };

    for (const [cx, cy] of roomCells(room)) {
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
        return { ok: false, error: type === 'BOSS' ? 'Une salle de boss (2×2) dépasse de la carte.' : 'Une salle est hors de la carte.' };
      }
      const key = `${cx},${cy}`;
      if (taken.has(key)) return { ok: false, error: 'Deux salles se chevauchent.' };
      taken.add(key);
    }
    rooms.push(room);
  }

  const starts = rooms.filter((room) => room.type === 'START').length;
  if (starts !== 1) return { ok: false, error: 'La carte doit avoir exactement une salle de départ.' };
  if (!rooms.some((room) => room.type === 'BOSS')) return { ok: false, error: 'La carte doit avoir au moins un boss.' };

  const layout: TowerLayout = { width, height, rooms };
  const distances = distancesFromStart(layout);
  if (distances.size !== rooms.length) {
    return { ok: false, error: `${rooms.length - distances.size} salle(s) ne sont reliées à rien depuis le départ.` };
  }
  return { ok: true, value: layout };
}

/** Carte proposée par défaut : un couloir, deux embranchements et une grande salle de boss. */
export function defaultTowerLayout(): TowerLayout {
  const room = (x: number, y: number, type: TowerRoomType, extra: Partial<TowerRoom> = {}): TowerRoom => ({
    id: roomId(x, y), x, y, type, foe: null, chest: 'BOTH', healPercent: 35, offers: [...TOWER_OFFER_KINDS], pricePercent: 100, ...extra,
  });
  return {
    width: 9,
    height: 9,
    rooms: [
      room(3, 8, 'START'),
      room(3, 7, 'MONSTER'),
      room(3, 6, 'MONSTER'),
      room(3, 5, 'CAMPFIRE'),
      room(2, 5, 'MONSTER'),
      room(1, 5, 'CHEST'),
      room(4, 5, 'ELITE'),
      room(5, 5, 'MERCHANT'),
      room(3, 4, 'EMPTY'),
      room(2, 2, 'BOSS'),
      room(4, 4, 'MONSTER'),
      room(5, 4, 'SHRINE'),
      room(6, 4, 'MONSTER'),
      room(7, 4, 'CHEST', { chest: 'GEAR' }),
    ],
  };
}
