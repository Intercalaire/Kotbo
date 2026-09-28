/**
 * Cartes de la Tour dessinées depuis le dashboard. Aucun accès base.
 *
 * Chaque carte est un étage de la tour : une grille de salles où deux salles communiquent
 * quand elles se touchent par un côté, une case sans salle étant un mur. Le gardien occupe
 * une grande salle de 2×2, ancrée sur sa case en haut à gauche. Le joueur part de la salle
 * de départ, choisit son chemin, et abattre le gardien le fait monter à l'étage suivant.
 * Les étages se jouent dans l'ordre puis recommencent au premier, plus durs.
 */

import {
  TOWER_EVENT_CHOICES,
  TOWER_MECHANIC_CHOICES,
  TOWER_ROOM_TRAITS_MAX,
  TOWER_TRAITS,
  type TowerEventChoice,
  type TowerMechanicChoice,
  type TowerTrait,
} from './rpgTowerContent.js';

export const TOWER_ROOM_TYPES = [
  'START', 'MONSTER', 'ELITE', 'BOSS', 'STAIRS', 'TRIAL', 'GATE', 'SEAL',
  'CHEST', 'MIMIC', 'CAMPFIRE', 'MERCHANT', 'MERCENARY', 'SHRINE', 'EVENT', 'TRAP', 'WARP_A', 'WARP_B', 'EMPTY',
] as const;
export type TowerRoomType = (typeof TOWER_ROOM_TYPES)[number];

/**
 * Sorties d'un étage : le gardien à abattre, l'escalier scellé qu'ouvrent les clés de l'étage,
 * l'épreuve (tenir trois vagues sans fuir) ou le portail qu'ouvrent les sceaux allumés. Un
 * étage en a exactement une : cumuler les mécanismes rendrait l'étage illisible.
 */
export const TOWER_EXIT_TYPES = ['BOSS', 'STAIRS', 'TRIAL', 'GATE'] as const;
export type TowerExitType = (typeof TOWER_EXIT_TYPES)[number];

export function isExitRoom(type: TowerRoomType): type is TowerExitType {
  return (TOWER_EXIT_TYPES as readonly string[]).includes(type);
}

/**
 * Portails A et B : deux salles liées d'un même étage. Entrer dans l'une permet de passer
 * aussitôt dans l'autre, comme par un couloir. Une seule paire par étage.
 */
export const TOWER_WARP_TYPES = ['WARP_A', 'WARP_B'] as const;

export function isWarpRoom(type: TowerRoomType): boolean {
  return type === 'WARP_A' || type === 'WARP_B';
}

/** Salles qui peuvent porter une clé de l'escalier scellé. */
export function canHoldKey(type: TowerRoomType): boolean {
  return type === 'ELITE' || type === 'CHEST';
}

export const TOWER_CHEST_KINDS = ['BOTH', 'GOLD', 'GEAR'] as const;
export type TowerChestKind = (typeof TOWER_CHEST_KINDS)[number];

export const TOWER_OFFER_KINDS = ['POTION', 'HEAL', 'GEAR'] as const;
export type TowerOfferKind = (typeof TOWER_OFFER_KINDS)[number];

export const TOWER_MAP_SIZE = { min: 3, max: 12 } as const;
export const TOWER_MAP_ROOMS_MAX = 100;
export const TOWER_FLOORS_MAX = 12;
export const TOWER_FLOOR_NAME_MAX = 40;
export const TOWER_MERCHANT_OFFERS_MAX = 4;
/** Après le dernier étage dessiné : la tour reprend au premier, ou génère des étages inédits. */
export const TOWER_FLOORS_AFTER = ['GENERATE', 'LOOP'] as const;
export type TowerFloorsAfter = (typeof TOWER_FLOORS_AFTER)[number];
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
  /** Traits imposés à un monstre, une élite ou un gardien ; vide : tirés au hasard. */
  traits: TowerTrait[];
  /** Mécanique d'un gardien. */
  mechanic: TowerMechanicChoice;
  /** Événement d'une salle d'événement. */
  event: TowerEventChoice;
  /** Élite ou coffre qui garde une clé de l'escalier scellé. */
  key: boolean;
};

/**
 * Ambiance d'un étage, qui change la façon de le parcourir sans ajouter de salle : inondé
 * (le joueur est ralenti), en feu (chaque nouvelle salle brûle un peu), béni (les soins sont
 * renforcés).
 */
export const TOWER_FLOOR_MODIFIERS = ['NONE', 'FLOODED', 'BURNING', 'BLESSED'] as const;
export type TowerFloorModifier = (typeof TOWER_FLOOR_MODIFIERS)[number];

/**
 * `name` : nom de l'étage (« Caserne », « Crypte »…), vide pour un étage sans nom.
 * `fog` : brouillard de guerre, seules les salles visitées et leurs voisines se voient.
 * `modifier` : ambiance de l'étage.
 */
export type TowerLayout = { name: string; width: number; height: number; fog: boolean; modifier: TowerFloorModifier; rooms: TowerRoom[] };

/** `WARP` : le passage d'un portail vers son jumeau. */
export type TowerDirection = 'N' | 'S' | 'E' | 'W' | 'WARP';

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

/**
 * Salles voisines d'une salle, chacune une seule fois, avec la direction pour y aller. Un
 * portail compte son jumeau parmi ses voisins : c'est ce qui le rend franchissable, et ce
 * qui rend joignable une partie de l'étage reliée seulement par les portails.
 */
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
  if (isWarpRoom(room.type)) {
    const twin = layout.rooms.find((candidate) => candidate.type === (room.type === 'WARP_A' ? 'WARP_B' : 'WARP_A'));
    if (twin && !found.has(twin.id)) found.set(twin.id, { room: twin, direction: 'WARP' });
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

/** Plus court chemin du départ jusqu'à la sortie de l'étage, en salles franchies. */
export function shortestPathToExit(layout: TowerLayout): number | null {
  const distances = distancesFromStart(layout);
  const reachable = layout.rooms.filter((room) => isExitRoom(room.type) && distances.has(room.id)).map((room) => distances.get(room.id)!);
  return reachable.length > 0 ? Math.min(...reachable) : null;
}

/** Sortie de l'étage : la salle qui le ferme. */
export function exitRoom(layout: TowerLayout): TowerRoom | null {
  return layout.rooms.find((room) => isExitRoom(room.type)) ?? null;
}

/**
 * Ce qu'il manque pour ouvrir la sortie : clés trouvées pour l'escalier, sceaux allumés pour
 * le portail. Une clé ou un sceau compte dès que sa salle est résolue.
 */
export function exitLocks(layout: TowerLayout, cleared: readonly string[]) {
  const keyRooms = layout.rooms.filter((room) => room.key && canHoldKey(room.type));
  const sealRooms = layout.rooms.filter((room) => room.type === 'SEAL');
  return {
    keysFound: keyRooms.filter((room) => cleared.includes(room.id)).length,
    keysNeeded: keyRooms.length,
    sealsLit: sealRooms.filter((room) => cleared.includes(room.id)).length,
    sealsNeeded: sealRooms.length,
  };
}

export type TowerLayoutResult = { ok: true; value: TowerLayout } | { ok: false; error: string };

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(parsed)));
}

/**
 * Valide une carte : dimensions, salles dans la grille et sans chevauchement, un seul départ,
 * exactement une sortie (gardien, escalier scellé, épreuve ou portail) avec ce qui l'ouvre, et
 * toutes les salles joignables depuis le départ, sortie comprise. Une salle isolée ne
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
      traits: (type === 'MONSTER' || type === 'ELITE' || type === 'BOSS') && Array.isArray(cell.traits)
        ? [...new Set(cell.traits.filter((trait): trait is TowerTrait => TOWER_TRAITS.includes(trait as TowerTrait)))].slice(0, TOWER_ROOM_TRAITS_MAX)
        : [],
      mechanic: TOWER_MECHANIC_CHOICES.includes(cell.mechanic as TowerMechanicChoice) ? (cell.mechanic as TowerMechanicChoice) : 'RANDOM',
      event: TOWER_EVENT_CHOICES.includes(cell.event as TowerEventChoice) ? (cell.event as TowerEventChoice) : 'RANDOM',
      key: canHoldKey(type) && cell.key === true,
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
  // Un étage a exactement une sortie : sans elle on ne pourrait pas monter, et avec deux on
  // mélangerait des mécanismes qui n'ont pas été pensés ensemble.
  const exits = rooms.filter((room) => isExitRoom(room.type));
  if (exits.length === 0) {
    return { ok: false, error: 'Chaque étage doit avoir une sortie : un gardien, un escalier scellé, une épreuve ou un portail.' };
  }
  if (exits.length > 1) return { ok: false, error: 'Un étage n\'a qu\'une seule sortie : retirez les sorties en trop.' };
  const exit = exits[0].type;
  const warpsA = rooms.filter((room) => room.type === 'WARP_A').length;
  const warpsB = rooms.filter((room) => room.type === 'WARP_B').length;
  if (warpsA > 1 || warpsB > 1) return { ok: false, error: 'Un étage n\'a qu\'une paire de portails : un portail A et un portail B.' };
  if (warpsA !== warpsB) return { ok: false, error: 'Un portail va par paire : placez à la fois le portail A et le portail B.' };
  const keys = rooms.filter((room) => room.key).length;
  const seals = rooms.filter((room) => room.type === 'SEAL').length;
  if (exit === 'STAIRS' && keys === 0) {
    return { ok: false, error: 'L\'escalier scellé s\'ouvre avec des clés : marquez au moins une élite ou un coffre comme porteur de clé.' };
  }
  if (exit !== 'STAIRS' && keys > 0) return { ok: false, error: 'Les clés n\'ouvrent qu\'un escalier scellé : retirez-les, ou choisissez cette sortie.' };
  if (exit === 'GATE' && seals === 0) return { ok: false, error: 'Le portail s\'ouvre avec des sceaux : placez au moins une salle de sceau.' };
  if (exit !== 'GATE' && seals > 0) return { ok: false, error: 'Les sceaux n\'ouvrent qu\'un portail : retirez-les, ou choisissez cette sortie.' };

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length > TOWER_FLOOR_NAME_MAX) return { ok: false, error: `Le nom d'un étage ne peut pas dépasser ${TOWER_FLOOR_NAME_MAX} caractères.` };
  // Absent des cartes d'avant le brouillard : elles restent entièrement visibles.
  const fog = raw.fog === true;
  const modifier = TOWER_FLOOR_MODIFIERS.includes(raw.modifier as TowerFloorModifier) ? (raw.modifier as TowerFloorModifier) : 'NONE';
  const layout: TowerLayout = { name, width, height, fog, modifier, rooms };
  const distances = distancesFromStart(layout);
  if (distances.size !== rooms.length) {
    return { ok: false, error: `${rooms.length - distances.size} salle(s) ne sont reliées à rien depuis le départ.` };
  }
  return { ok: true, value: layout };
}

export type TowerFloorsResult = { ok: true; value: TowerLayout[] } | { ok: false; error: string };

/** Valide la liste des étages dessinés, dans l'ordre de la montée. */
export function normalizeTowerFloors(input: unknown): TowerFloorsResult {
  if (!Array.isArray(input)) return { ok: false, error: 'La liste des étages est invalide.' };
  if (input.length > TOWER_FLOORS_MAX) return { ok: false, error: `La Tour compte au plus ${TOWER_FLOORS_MAX} étages dessinés.` };
  const floors: TowerLayout[] = [];
  for (const [index, entry] of input.entries()) {
    const result = normalizeTowerLayout(entry);
    if (!result.ok) return { ok: false, error: `Étage ${index + 1} : ${result.error}` };
    floors.push(result.value);
  }
  return { ok: true, value: floors };
}

/** Carte d'un étage de la montée : les étages dessinés se suivent, puis la tour recommence au premier. */
export function floorLayout(floors: readonly TowerLayout[], floor: number): TowerLayout | null {
  if (floors.length === 0) return null;
  return floors[(Math.max(1, floor) - 1) % floors.length];
}

/**
 * Salles visibles sous le brouillard : celles déjà faites, celle du joueur et leurs voisines.
 * `null` : l'étage n'a pas de brouillard, tout se voit.
 */
export function visibleRooms(layout: TowerLayout, pos: string, cleared: readonly string[]): Set<string> | null {
  if (!layout.fog) return null;
  const cells = occupancy(layout);
  const seen = new Set<string>([pos, ...cleared]);
  for (const id of [pos, ...cleared]) {
    for (const { room } of roomNeighbors(layout, id, cells)) seen.add(room.id);
  }
  return seen;
}

/** Salle aux réglages par défaut. */
export function newTowerRoom(x: number, y: number, type: TowerRoomType, extra: Partial<TowerRoom> = {}): TowerRoom {
  return {
    id: roomId(x, y), x, y, type, foe: null, chest: 'BOTH', healPercent: 35, offers: [...TOWER_OFFER_KINDS], pricePercent: 100,
    traits: [], mechanic: 'RANDOM', event: 'RANDOM', key: false, ...extra,
  };
}

/** Carte proposée par défaut : un couloir, deux embranchements et une grande salle de boss. */
export function defaultTowerLayout(): TowerLayout {
  return {
    name: '',
    fog: false,
    modifier: 'NONE',
    width: 9,
    height: 9,
    rooms: [
      newTowerRoom(3, 8, 'START'),
      newTowerRoom(3, 7, 'MONSTER'),
      newTowerRoom(3, 6, 'MONSTER'),
      newTowerRoom(3, 5, 'CAMPFIRE'),
      newTowerRoom(2, 5, 'MONSTER'),
      newTowerRoom(1, 5, 'CHEST'),
      newTowerRoom(4, 5, 'ELITE'),
      newTowerRoom(5, 5, 'MERCHANT'),
      newTowerRoom(3, 4, 'EVENT'),
      newTowerRoom(2, 2, 'BOSS'),
      newTowerRoom(4, 4, 'MONSTER'),
      newTowerRoom(5, 4, 'SHRINE'),
      newTowerRoom(6, 4, 'MONSTER'),
      newTowerRoom(7, 4, 'CHEST', { chest: 'GEAR' }),
    ],
  };
}
