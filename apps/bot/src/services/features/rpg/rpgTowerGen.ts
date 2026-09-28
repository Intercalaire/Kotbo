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
  type TowerFloorsAfter,
  type TowerLayout,
  type TowerRoom,
  type TowerRoomType,
} from './rpgTowerMap.js';

const WIDTH = 7;
const HEIGHT = 9;
/** Rangée juste sous le gardien, qui occupe les deux rangées du haut. */
const GUARD_ROW = 2;

const PATH_WEIGHTS: Partial<Record<TowerRoomType, number>> = { MONSTER: 55, EMPTY: 15, ELITE: 10, EVENT: 10, CHEST: 5, SHRINE: 5 };
const BRANCH_END_WEIGHTS: Partial<Record<TowerRoomType, number>> = { CHEST: 25, SHRINE: 15, MERCHANT: 15, CAMPFIRE: 15, EVENT: 15, ELITE: 15 };
const BRANCH_WEIGHTS: Partial<Record<TowerRoomType, number>> = { MONSTER: 70, EMPTY: 30 };

function pick(rng: TowerRng, weights: Partial<Record<TowerRoomType, number>>): TowerRoomType {
  return rng.weighted(weights as Record<TowerRoomType, number>);
}

/** Mélange la graine d'une partie et le numéro d'étage en une graine d'étage. */
export function floorSeed(seed: number, floor: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(floor, 0xc2b2ae35)) | 0;
}

export function generateTowerLayout(seed: number): TowerLayout {
  const rng = new TowerRng(seed);
  const bossX = 1 + rng.int(WIDTH - 3);
  const isBossCell = (x: number, y: number) => y < GUARD_ROW && x >= bossX && x <= bossX + 1;
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
  let elites = 0;
  const pathType = (): TowerRoomType => {
    const type = pick(rng, PATH_WEIGHTS);
    if (type !== 'ELITE') return type;
    elites += 1;
    return elites <= 2 ? 'ELITE' : 'MONSTER';
  };
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
  // La dernière salle avant le gardien laisse souvent souffler.
  const before = cells.get(key(x, y));
  if (before && rng.next() < 0.5) cells.set(key(x, y), newTowerRoom(x, y, 'CAMPFIRE'));

  // Embranchements : de courtes impasses qui mènent à une récompense.
  const branches = 2 + rng.int(3);
  let merchants = 0;
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
      let type = index === carved.length - 1 ? pick(rng, BRANCH_END_WEIGHTS) : pick(rng, BRANCH_WEIGHTS);
      if (type === 'MERCHANT' && ++merchants > 1) type = 'CHEST';
      place(cx, cy, type);
    });
  }

  const layout = normalizeTowerLayout({
    name: '',
    fog: true,
    width: WIDTH,
    height: HEIGHT,
    rooms: [...cells.values(), newTowerRoom(bossX, 0, 'BOSS')],
  });
  // Construit relié par nature : le repli ne sert qu'en garde-fou.
  return layout.ok ? layout.value : { ...defaultTowerLayout(), fog: true };
}

/**
 * Carte de l'étage `floor` : les étages dessinés d'abord, puis selon `after` la boucle sur
 * les étages dessinés ou des étages générés. `null` : aucun étage à jouer, portes aléatoires.
 */
export function towerFloorLayout(
  drawn: readonly TowerLayout[],
  floor: number,
  after: TowerFloorsAfter,
  seed: number,
): TowerLayout | null {
  if (drawn.length > 0 && (floor <= drawn.length || after === 'LOOP')) return floorLayout(drawn, floor);
  if (after === 'GENERATE') return generateTowerLayout(floorSeed(seed, floor));
  return null;
}
