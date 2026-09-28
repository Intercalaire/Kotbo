/**
 * Étages générés : la montée continue au-delà des étages dessinés sans jamais se répéter.
 *
 * Un étage généré a la forme d'une tour : le départ en bas, le gardien en haut, un chemin
 * qui serpente entre les deux et quelques embranchements vers des salles de récompense.
 * Il est construit relié par nature, puis repassé par la même validation qu'une carte
 * dessinée. Tout dépend d'une graine : deux joueurs de l'ascension du jour voient le même.
 */

import { TowerRng } from './rpgTowerPolicy.js';
import {
  defaultTowerLayout,
  floorLayout,
  newTowerRoom,
  normalizeTowerLayout,
  type TowerExitType,
  type TowerFloorsAfter,
  type TowerLayout,
  type TowerRoom,
  type TowerRoomType,
} from './rpgTowerMap.js';

const WIDTH = 7;
const HEIGHT = 9;
/** Rangée juste sous le gardien, qui occupe les deux rangées du haut. */
const GUARD_ROW = 2;

const PATH_WEIGHTS: Partial<Record<TowerRoomType, number>> = { MONSTER: 68, EMPTY: 18, ELITE: 8, EVENT: 6 };
const BRANCH_END_WEIGHTS: Partial<Record<TowerRoomType, number>> = { MONSTER: 30, ELITE: 25, EVENT: 15, CHEST: 12, MERCHANT: 8, CAMPFIRE: 6, SHRINE: 4 };
const BRANCH_WEIGHTS: Partial<Record<TowerRoomType, number>> = { MONSTER: 75, EMPTY: 25 };
/**
 * Plafond de chaque salle de récompense par étage généré. Sans plafond, un étage pouvait
 * aligner trois autels et trois coffres : bénédictions et objets pleuvaient.
 */
const ROOM_CAPS: Partial<Record<TowerRoomType, number>> = { SHRINE: 1, CHEST: 2, MERCHANT: 1, CAMPFIRE: 1, EVENT: 2, ELITE: 2 };
const CAP_FALLBACK: Partial<Record<TowerRoomType, TowerRoomType>> = { ELITE: 'MONSTER', EVENT: 'MONSTER' };
/** Sortie d'un étage généré : le gardien reste la plus fréquente. */
const EXIT_WEIGHTS: Record<TowerExitType, number> = { BOSS: 55, STAIRS: 15, TRIAL: 15, GATE: 15 };
/** Clés d'un escalier scellé et sceaux d'un portail, par étage généré. */
const LOCKS_PER_FLOOR = 2;

function pick(rng: TowerRng, weights: Partial<Record<TowerRoomType, number>>): TowerRoomType {
  return rng.weighted(weights as Record<TowerRoomType, number>);
}

/** Mélange la graine d'une partie et le numéro d'étage en une graine d'étage. */
export function floorSeed(seed: number, floor: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(floor, 0xc2b2ae35)) | 0;
}

export function generateTowerLayout(seed: number, fog = true): TowerLayout {
  const rng = new TowerRng(seed);
  const exit = rng.weighted(EXIT_WEIGHTS);
  const bossX = 1 + rng.int(WIDTH - 3);
  // Seul le gardien occupe les deux rangées du haut ; les autres sorties tiennent sur une case.
  const isBossCell = (x: number, y: number) => exit === 'BOSS' && y < GUARD_ROW && x >= bossX && x <= bossX + 1;
  const cells = new Map<string, TowerRoom>();
  const key = (x: number, y: number) => `${x},${y}`;
  const place = (x: number, y: number, type: TowerRoomType) => {
    if (!cells.has(key(x, y))) cells.set(key(x, y), newTowerRoom(x, y, type));
  };

  // Chemin principal : il dérive d'une ou deux cases par rangée puis monte, sans jamais
  // revenir sur ses pas, jusqu'à une case sous le gardien.
  let x = Math.floor(WIDTH / 2);
  let y = HEIGHT - 1;
  const targetX = bossX + rng.int(2);
  const path: [number, number][] = [[x, y]];
  place(x, y, 'START');
  const used: Partial<Record<TowerRoomType, number>> = {};
  /** Type tiré, ramené à une salle ordinaire si son plafond d'étage est atteint. */
  const capped = (type: TowerRoomType, fallback: TowerRoomType): TowerRoomType => {
    const cap = ROOM_CAPS[type];
    if (cap === undefined) return type;
    if ((used[type] ?? 0) >= cap) return CAP_FALLBACK[type] ?? fallback;
    used[type] = (used[type] ?? 0) + 1;
    return type;
  };
  const pathType = (): TowerRoomType => capped(pick(rng, PATH_WEIGHTS), 'MONSTER');
  while (y > GUARD_ROW) {
    const toward = Math.sign(targetX - x);
    const dir = rng.next() < 0.6 && toward !== 0 ? toward : rng.next() < 0.5 ? -1 : 1;
    for (let step = rng.int(3); step > 0; step--) {
      const nx = x + dir;
      if (nx < 0 || nx >= WIDTH) break;
      x = nx;
      path.push([x, y]);
      place(x, y, pathType());
    }
    y -= 1;
    path.push([x, y]);
    place(x, y, pathType());
  }
  while (x !== targetX) {
    x += Math.sign(targetX - x);
    path.push([x, y]);
    place(x, y, pathType());
  }
  // Une sortie d'une case se pose juste au-dessus de la fin du chemin.
  if (exit !== 'BOSS') cells.set(key(x, y - 1), newTowerRoom(x, y - 1, exit));

  // La dernière salle avant la sortie laisse souvent souffler.
  if (rng.next() < 0.5 && (used.CAMPFIRE ?? 0) === 0) {
    used.CAMPFIRE = 1;
    cells.set(key(x, y), newTowerRoom(x, y, 'CAMPFIRE'));
  }

  // Embranchements : de courtes impasses qui mènent à une récompense.
  const branches = 2 + rng.int(3);
  for (let branch = 0; branch < branches; branch++) {
    const [fromX, fromY] = path[1 + rng.int(path.length - 1)];
    const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, -1], [0, 1]] as const);
    const length = 1 + rng.int(2);
    let bx = fromX;
    let by = fromY;
    const carved: [number, number][] = [];
    for (let step = 0; step < length; step++) {
      const nx = bx + dx;
      const ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT || isBossCell(nx, ny) || cells.has(key(nx, ny))) break;
      bx = nx;
      by = ny;
      carved.push([bx, by]);
    }
    carved.forEach(([cx, cy], index) => {
      const type = index === carved.length - 1 ? capped(pick(rng, BRANCH_END_WEIGHTS), 'EMPTY') : pick(rng, BRANCH_WEIGHTS);
      place(cx, cy, type);
    });
  }

  // Ce qui ouvre la sortie : des clés sur des élites ou des coffres, ou des sceaux gardés.
  if (exit === 'STAIRS' || exit === 'GATE') {
    const rooms = [...cells.values()];
    const preferred = exit === 'STAIRS'
      ? rooms.filter((room) => room.type === 'ELITE' || room.type === 'CHEST')
      : [];
    const fallback = rooms.filter((room) => room.type === 'MONSTER' || room.type === 'EMPTY');
    const chosen: TowerRoom[] = [];
    for (const pool of [preferred, fallback]) {
      while (chosen.length < LOCKS_PER_FLOOR && pool.length > 0) {
        chosen.push(pool.splice(rng.int(pool.length), 1)[0]);
      }
    }
    for (const room of chosen) {
      const type: TowerRoomType = exit === 'GATE' ? 'SEAL' : room.type === 'CHEST' ? 'CHEST' : 'ELITE';
      cells.set(key(room.x, room.y), newTowerRoom(room.x, room.y, type, { key: exit === 'STAIRS' }));
    }
  }

  const layout = normalizeTowerLayout({
    name: '',
    fog,
    width: WIDTH,
    height: HEIGHT,
    rooms: exit === 'BOSS' ? [...cells.values(), newTowerRoom(bossX, 0, 'BOSS')] : [...cells.values()],
  });
  // Construit relié par nature : le repli ne sert qu'en garde-fou.
  return layout.ok ? layout.value : { ...defaultTowerLayout(), fog };
}

/**
 * Carte de l'étage `floor` : les étages dessinés d'abord, puis selon `after` la boucle sur
 * les étages dessinés ou des étages générés. Sans aucun étage dessiné, tous sont générés :
 * la Tour a toujours des étages, chacun fermé par sa sortie.
 */
export function towerFloorLayout(
  drawn: readonly TowerLayout[],
  floor: number,
  after: TowerFloorsAfter,
  seed: number,
  /** Brouillard des étages générés. */
  fog = true,
): TowerLayout {
  if (drawn.length > 0 && (floor <= drawn.length || after === 'LOOP')) return floorLayout(drawn, floor)!;
  return generateTowerLayout(floorSeed(seed, floor), fog);
}
