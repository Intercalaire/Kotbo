/**
 * Rendu image de la Tour : une vraie tour de pierre plutôt qu'une grille d'emojis.
 *
 * Deux vues. Sur une carte, l'étage en cours est dessiné en coupe dans le corps de la tour,
 * sous ses créneaux et sa bannière, avec à côté l'échelle des étages franchis et à venir.
 * En portes aléatoires, la tour est vue de face, étage par étage, le joueur sur le sien : ce
 * qui reste de la montée se perd dans la nuit au-dessus de lui.
 *
 * ELLE NE DÉCIDE RIEN : salles, position et étages lui sont fournis, déjà traduits. Comme la
 * carte de personnage, elle rend `null` sur incident plutôt que de faire échouer l'écran.
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { logger } from '../../../utils/logger.js';
import { canvasFont, ensureCanvasFonts } from '../../../utils/canvasFonts.js';
import {
  hasTowerPower,
  isEntryRoom,
  occupancy,
  resolveTowerTheme,
  roomCells,
  towerLayoutKey,
  type TowerFloorModifier,
  type TowerLayout,
  type TowerResolvedTheme,
  type TowerRoomType,
} from './rpgTowerMap.js';

export const TOWER_IMAGE_FILENAME = 'tour.png';

const C = {
  sky1: '#0d0a1a',
  sky2: '#221a3d',
  star: 'rgba(237, 233, 247, 0.75)',
  stone: '#4a4458',
  stoneDark: '#332e40',
  stoneLight: '#5f5873',
  mortar: 'rgba(0, 0, 0, 0.28)',
  floor: '#2a2536',
  corridor: '#3b3450',
  text: '#EDE9F7',
  textDim: '#A79FBF',
  accent: '#8b5cf6',
  gold: '#fbbf24',
  lit: '#f4b860',
  done: '#4ade80',
} as const;

/**
 * Décor d'un étage : la pierre, le ciel et la bannière changent, jamais la couleur des salles,
 * qui reste le repère du joueur d'un étage à l'autre.
 */
type Palette = {
  sky1: string;
  sky2: string;
  stone: string;
  stoneDark: string;
  stoneLight: string;
  floor: string;
  corridor: string;
  banner: string;
  /** Flamme des torches murales. */
  torch: string;
  stars: number;
};

const PALETTES: Record<TowerResolvedTheme, Palette> = {
  STONE: { sky1: C.sky1, sky2: C.sky2, stone: C.stone, stoneDark: C.stoneDark, stoneLight: C.stoneLight, floor: C.floor, corridor: C.corridor, banner: C.accent, torch: '#f59e0b', stars: 70 },
  MOSS: { sky1: '#0a1412', sky2: '#1b2e2a', stone: '#445248', stoneDark: '#2e3a32', stoneLight: '#5a6d5c', floor: '#243029', corridor: '#34463a', banner: '#22c55e', torch: '#f59e0b', stars: 60 },
  CRYPT: { sky1: '#0c0a10', sky2: '#1f1a26', stone: '#3f3a44', stoneDark: '#2a262e', stoneLight: '#57505e', floor: '#221e27', corridor: '#332d3a', banner: '#94a3b8', torch: '#a3e635', stars: 45 },
  ICE: { sky1: '#08121f', sky2: '#1a2f4a', stone: '#566a80', stoneDark: '#3d4d61', stoneLight: '#7b93ad', floor: '#243245', corridor: '#3a4d66', banner: '#38bdf8', torch: '#67e8f9', stars: 90 },
  FORGE: { sky1: '#160806', sky2: '#3a150c', stone: '#4d3a36', stoneDark: '#34261f', stoneLight: '#6b4f45', floor: '#2b1f1b', corridor: '#45302a', banner: '#f97316', torch: '#ef4444', stars: 30 },
  ARCANE: { sky1: '#0f0620', sky2: '#2d1457', stone: '#4b3f6b', stoneDark: '#32294a', stoneLight: '#66578f', floor: '#271f3d', corridor: '#3d3160', banner: '#e879f9', torch: '#c084fc', stars: 110 },
  ABYSS: { sky1: '#020205', sky2: '#0d0b1c', stone: '#2e2b3a', stoneDark: '#1d1b27', stoneLight: '#403c52', floor: '#17151f', corridor: '#26233a', banner: '#6366f1', torch: '#818cf8', stars: 160 },
};

const ROOM_COLOR: Record<TowerRoomType, string> = {
  START: '#94a3b8',
  WELL: '#64748b',
  ENTRANCE: '#94a3b8',
  COLLAPSE: '#fb923c',
  TOLL: '#facc15',
  FOUNTAIN: '#38bdf8',
  AMBUSH: '#94a3b8',
  WANDERER: '#94a3b8',
  PRISONER: '#a3e635',
  ORACLE: '#c4b5fd',
  MONSTER: '#ef4444',
  ELITE: '#a855f7',
  BOSS: '#f59e0b',
  STAIRS: '#22d3ee',
  EXIT: '#34d399',
  TRIAL: '#f43f5e',
  GATE: '#c084fc',
  SEAL: '#a78bfa',
  WARP_A: '#2dd4bf',
  WARP_B: '#2dd4bf',
  CHEST: '#eab308',
  MIMIC: '#eab308',
  MERCENARY: '#84cc16',
  MENTOR: '#f472b6',
  TRAP: '#dc2626',
  CAMPFIRE: '#f97316',
  MERCHANT: '#10b981',
  SHRINE: '#38bdf8',
  EVENT: '#e879f9',
  EMPTY: '#64748b',
};

export type TowerLadderEntry = { label: string; status: 'done' | 'current' | 'next' };

export type TowerMapImage = {
  kind: 'map';
  /** Titre posé sur le socle de la tour, par exemple « Étage 7 · Crypte ». */
  title: string;
  /** Étage affiché : le décor AUTO suit la hauteur. */
  floor?: number;
  layout: TowerLayout;
  pos: string;
  cleared: readonly string[];
  /** Salles où l'on peut aller maintenant et pas encore résolues. */
  targets: readonly string[];
  /** Échelle des étages, du plus haut au plus bas. */
  ladder: TowerLadderEntry[];
  /** Salles visibles sous le brouillard ; absent : tout l'étage se voit. */
  visible?: readonly string[] | null;
  /** Salles dont le monstre porte des traits ou une mécanique, marquées d'une pastille. */
  badges?: Record<string, number>;
  /** Salles qui gardent une clé de l'escalier scellé. */
  keys?: readonly string[];
  /** Salles où se tient un monstre errant. */
  wanderers?: readonly string[];
  /** Chemin vers la sortie montré par un oracle. */
  path?: readonly string[];
  /** Tour de clan : salles conquises par le clan, marquées d'un fanion. */
  conquered?: readonly string[];
};

/** Encart de texte à droite de la tour : titre et quelques lignes courtes. */
export type TowerPanel = { title: string; lines: string[] };

export type TowerShaftImage = {
  kind: 'shaft';
  title: string;
  floor: number;
  bossEvery: number;
  /** Libellé d'un étage, déjà traduit. */
  floorLabel: (floor: number) => string;
  panel?: TowerPanel;
};

/** Marqueurs de la carte, expliqués dans le guide. */
export type TowerLegendMarker = 'PAWN' | 'TARGET' | 'CLEARED' | 'KEY' | 'BADGE' | 'POWER' | 'WANDERER' | 'PATH' | 'PENNANT' | 'FOG';

/**
 * Une ligne de légende : une salle telle que la carte la dessine, ou un marqueur. `locked` : salle
 * piégée pas encore rencontrée, sous cadenas. `hidden` : salle piégée découverte, dessinée sous
 * son apparence avec un avertissement.
 */
export type TowerLegendEntry =
  | { room: TowerRoomType; label: string; locked?: boolean; hidden?: TowerRoomType }
  | { marker: TowerLegendMarker; label: string };

export type TowerLegendImage = {
  kind: 'legend';
  title: string;
  entries: TowerLegendEntry[];
};

export type TowerImageInput = TowerMapImage | TowerShaftImage | TowerLegendImage;

// ─────────────────────────────────────────────────────────────
// Décor
// ─────────────────────────────────────────────────────────────

/**
 * Ciel étoilé, à positions fixes : la même tour ne scintille pas différemment à chaque clic.
 * `moon` : position de la lune, absente d'une nuit sans lune.
 */
function drawSky(ctx: SKRSContext2D, w: number, h: number, palette: Palette = PALETTES.STONE, moon: { x: number; y: number } | null = null): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, palette.sky1);
  sky.addColorStop(1, palette.sky2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  ctx.fillStyle = C.star;
  for (let i = 0; i < palette.stars; i++) {
    const r = next() < 0.85 ? 1 : 1.8;
    ctx.beginPath();
    ctx.arc(next() * w, next() * h * 0.8, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (moon) drawMoon(ctx, moon.x, moon.y, 15, palette.sky1);
}

/** Croissant de lune, avec son halo. */
function drawMoon(ctx: SKRSContext2D, cx: number, cy: number, r: number, sky: string): void {
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.6);
  halo.addColorStop(0, 'rgba(254, 243, 199, 0.22)');
  halo.addColorStop(1, 'rgba(254, 243, 199, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Le croissant : l'ombre du ciel mord dans la lune.
  ctx.fillStyle = sky;
  ctx.beginPath();
  ctx.arc(cx + r * 0.45, cy - r * 0.2, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Maçonnerie en quinconce sur un rectangle. */
function drawBricks(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, base: string = C.stone, brick = 14): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.mortar;
  ctx.lineWidth = 1;
  const bw = brick * 2;
  for (let row = 0; row * brick < h; row++) {
    const by = y + row * brick;
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x + w, by);
    ctx.stroke();
    const offset = row % 2 === 0 ? 0 : brick;
    for (let bx = x - offset; bx < x + w; bx += bw) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by + brick);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Créneaux sur le haut de la tour, en nombre impair pour tomber juste aux deux angles. */
function drawBattlements(ctx: SKRSContext2D, x: number, y: number, w: number, height: number, palette: Palette = PALETTES.STONE): { x: number; w: number }[] {
  let count = Math.max(5, Math.round(w / 38));
  if (count % 2 === 0) count += 1;
  const unit = w / count;
  const merlons: { x: number; w: number }[] = [];
  for (let i = 0; i < count; i += 2) {
    drawBricks(ctx, x + i * unit, y, unit, height, palette.stoneLight, 12);
    merlons.push({ x: x + i * unit, w: unit });
  }
  drawBricks(ctx, x - 6, y + height, w + 12, 12, palette.stoneLight, 12);
  return merlons;
}

/** Mât et bannière au sommet. */
function drawBanner(ctx: SKRSContext2D, cx: number, baseY: number, color: string = C.accent): void {
  ctx.strokeStyle = C.textDim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, baseY - 46);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 46);
  ctx.lineTo(cx + 34, baseY - 38);
  ctx.lineTo(cx + 24, baseY - 31);
  ctx.lineTo(cx + 34, baseY - 24);
  ctx.lineTo(cx, baseY - 24);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color: string, align: 'left' | 'center' | 'right' = 'left', weight: 'normal' | 'bold' = 'bold'): void {
  ctx.font = canvasFont(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

/** Plaque de titre sur le socle. */
function drawPlaque(ctx: SKRSContext2D, cx: number, cy: number, label: string, background: string = C.stoneDark): void {
  ctx.font = canvasFont(18, 'bold');
  const width = Math.max(160, ctx.measureText(label).width + 44);
  roundRect(ctx, cx - width / 2, cy - 18, width, 36, 8);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, cx, cy + 1, 18, C.gold, 'center');
}

// ─────────────────────────────────────────────────────────────
// Pictogrammes, tracés à la main : aucune police d'emojis n'est garantie sur le serveur
// ─────────────────────────────────────────────────────────────

function glyph(ctx: SKRSContext2D, type: TowerRoomType, cx: number, cy: number, size: number, color: string): void {
  const s = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size / 10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (type) {
    case 'START': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.6, cy - s * 0.1);
      ctx.arc(cx, cy - s * 0.1, s * 0.6, Math.PI, 0);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.8);
      ctx.stroke();
      break;
    }
    case 'WELL': {
      // Un trou : deux cercles, le fond plus sombre.
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ENTRANCE': {
      // Une porte et la flèche qui y entre.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.6, cy - s * 0.1);
      ctx.arc(cx, cy - s * 0.1, s * 0.6, Math.PI, 0);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.4);
      ctx.lineTo(cx, cy + s * 0.4);
      ctx.moveTo(cx - s * 0.25, cy + s * 0.15);
      ctx.lineTo(cx, cy + s * 0.4);
      ctx.lineTo(cx + s * 0.25, cy + s * 0.15);
      ctx.stroke();
      break;
    }
    case 'COLLAPSE': {
      // Des marches fendues.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, cy + s * 0.7);
      ctx.lineTo(cx - s * 0.8, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.25, cy - s * 0.25);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.25);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = C.floor;
      ctx.lineWidth = Math.max(1.5, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.1, cy - s * 0.9);
      ctx.lineTo(cx - s * 0.1, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.15, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.8);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'TOLL': {
      // Une pièce.
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = C.floor;
      ctx.lineWidth = Math.max(1.5, s * 0.14);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'PRISONER': {
      // Des barreaux.
      for (const dx of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * dx, cy - s * 0.8);
        ctx.lineTo(cx + s * dx, cy + s * 0.8);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.8);
      ctx.moveTo(cx - s * 0.8, cy + s * 0.8);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.8);
      ctx.stroke();
      break;
    }
    case 'ORACLE': {
      // Un œil ouvert.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.85, cy);
      ctx.quadraticCurveTo(cx, cy - s * 0.75, cx + s * 0.85, cy);
      ctx.quadraticCurveTo(cx, cy + s * 0.75, cx - s * 0.85, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'FOUNTAIN': {
      // Une goutte.
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.85);
      ctx.quadraticCurveTo(cx + s * 0.75, cy + s * 0.05, cx + s * 0.55, cy + s * 0.45);
      ctx.arc(cx, cy + s * 0.3, s * 0.58, 0.25, Math.PI - 0.25);
      ctx.quadraticCurveTo(cx - s * 0.75, cy + s * 0.05, cx, cy - s * 0.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'MONSTER': {
      for (const dir of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.7 * dir, cy - s * 0.7);
        ctx.lineTo(cx + s * 0.7 * dir, cy + s * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.35 * dir - s * 0.25, cy + s * 0.35 + s * 0.25 * dir);
        ctx.lineTo(cx + s * 0.35 * dir + s * 0.25, cy + s * 0.35 - s * 0.25 * dir);
        ctx.stroke();
      }
      break;
    }
    case 'ELITE': {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.15, s * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - s * 0.35, cy + s * 0.3, s * 0.7, s * 0.45);
      ctx.fillStyle = C.floor;
      for (const dx of [-0.25, 0.25]) {
        ctx.beginPath();
        ctx.arc(cx + s * dx, cy - s * 0.15, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'BOSS': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.8, cy - s * 0.5);
      ctx.lineTo(cx - s * 0.4, cy);
      ctx.lineTo(cx, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.4, cy);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.5);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'CHEST': {
      ctx.strokeRect(cx - s * 0.75, cy - s * 0.45, s * 1.5, s * 1.05);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.75, cy - s * 0.05);
      ctx.lineTo(cx + s * 0.75, cy - s * 0.05);
      ctx.stroke();
      ctx.fillRect(cx - s * 0.12, cy - s * 0.2, s * 0.24, s * 0.3);
      break;
    }
    case 'CAMPFIRE': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.85);
      ctx.bezierCurveTo(cx + s * 0.75, cy - s * 0.15, cx + s * 0.6, cy + s * 0.6, cx, cy + s * 0.6);
      ctx.bezierCurveTo(cx - s * 0.6, cy + s * 0.6, cx - s * 0.75, cy - s * 0.15, cx, cy - s * 0.85);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy + s * 0.85);
      ctx.lineTo(cx + s * 0.7, cy + s * 0.6);
      ctx.moveTo(cx + s * 0.7, cy + s * 0.85);
      ctx.lineTo(cx - s * 0.7, cy + s * 0.6);
      ctx.stroke();
      break;
    }
    case 'MERCHANT': {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'EXIT': {
      // Flèche qui monte : on passe sans rien avoir à ouvrir.
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.7, cy);
      ctx.lineTo(cx + s * 0.25, cy);
      ctx.lineTo(cx + s * 0.25, cy + s * 0.75);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.75);
      ctx.lineTo(cx - s * 0.25, cy);
      ctx.lineTo(cx - s * 0.7, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'STAIRS': {
      // Trois marches qui montent vers la droite.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, cy + s * 0.7);
      ctx.lineTo(cx - s * 0.8, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.25, cy - s * 0.25);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.25);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'TRIAL': {
      // Sablier : on tient jusqu'à la dernière vague.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.8);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.6, cy + s * 0.8);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'GATE': {
      // Arche fermée de barreaux.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.7, cy - s * 0.1);
      ctx.arc(cx, cy - s * 0.1, s * 0.7, Math.PI, 0);
      ctx.lineTo(cx + s * 0.7, cy + s * 0.8);
      ctx.stroke();
      for (const dx of [-0.3, 0, 0.3]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * dx, cy - s * 0.5);
        ctx.lineTo(cx + s * dx, cy + s * 0.8);
        ctx.stroke();
      }
      break;
    }
    case 'SEAL': {
      // Sceau : deux cercles et un point, comme une rune.
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'TRAP': {
      // Rangée de pointes.
      for (const dx of [-0.6, 0, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * (dx - 0.3), cy + s * 0.6);
        ctx.lineTo(cx + s * dx, cy - s * 0.6);
        ctx.lineTo(cx + s * (dx + 0.3), cy + s * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'MERCENARY': {
      // Silhouette casquée : tête, épaules et épée levée.
      ctx.beginPath();
      ctx.arc(cx - s * 0.15, cy - s * 0.35, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy + s * 0.8);
      ctx.quadraticCurveTo(cx - s * 0.15, cy - s * 0.1, cx + s * 0.4, cy + s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.45, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.8);
      ctx.stroke();
      break;
    }
    case 'MENTOR': {
      // Livre ouvert : deux pages et leur reliure.
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.45);
      ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.7, cx - s * 0.85, cy - s * 0.5);
      ctx.lineTo(cx - s * 0.85, cy + s * 0.6);
      ctx.quadraticCurveTo(cx - s * 0.4, cy + s * 0.4, cx, cy + s * 0.65);
      ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.4, cx + s * 0.85, cy + s * 0.6);
      ctx.lineTo(cx + s * 0.85, cy - s * 0.5);
      ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.7, cx, cy - s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = C.floor;
      ctx.lineWidth = Math.max(1.5, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.45);
      ctx.lineTo(cx, cy + s * 0.65);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'WARP_A':
    case 'WARP_B': {
      // Tourbillon et lettre : A et B se reconnaissent d'un coup d'œil.
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.8, s * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = canvasFont(Math.round(size * 0.6), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type === 'WARP_A' ? 'A' : 'B', cx, cy + size * 0.03);
      break;
    }
    case 'EVENT': {
      ctx.font = canvasFont(Math.round(size * 0.9), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy + size * 0.04);
      break;
    }
    case 'SHRINE': {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI / 4) * i - Math.PI / 2;
        const radius = i % 2 === 0 ? s * 0.85 : s * 0.3;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Pastille d'alerte sur une salle : nombre de traits du monstre qui l'habite. */
function drawBadge(ctx: SKRSContext2D, cx: number, cy: number, radius: number, count: number): void {
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = C.sky1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  text(ctx, String(count), cx, cy + 0.5, Math.round(radius * 1.3), C.text, 'center');
  ctx.restore();
}

/** Puissance réglée sur la salle, dans le coin bas droit : rouge si renforcée, verte si affaiblie. */
function drawPower(ctx: SKRSContext2D, right: number, bottom: number, size: number, percent: number): void {
  const label = `×${percent / 100}`;
  ctx.save();
  ctx.font = canvasFont(size, 'bold');
  const width = ctx.measureText(label).width + 6;
  roundRect(ctx, right - width, bottom - size - 4, width, size + 4, 4);
  ctx.fillStyle = percent > 100 ? '#ef4444' : '#22c55e';
  ctx.fill();
  text(ctx, label, right - width / 2, bottom - size / 2 - 2, size, C.sky1, 'center');
  ctx.restore();
}

/** Petite clé dorée dans un coin de salle : elle ouvre l'escalier scellé. */
function drawKey(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(2, size / 5);
  ctx.beginPath();
  ctx.arc(x + size * 0.3, y - size * 0.3, size * 0.25, 0, Math.PI * 2);
  ctx.moveTo(x + size * 0.5, y - size * 0.5);
  ctx.lineTo(x + size, y - size);
  ctx.moveTo(x + size * 0.8, y - size * 0.8);
  ctx.lineTo(x + size * 0.95, y - size * 0.65);
  ctx.stroke();
  ctx.restore();
}

/** Case sous le brouillard : une brume sombre, jamais tout à fait uniforme. */
function drawFog(ctx: SKRSContext2D, x: number, y: number, size: number, seed: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(13, 10, 26, 0.92)';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(167, 159, 191, 0.07)';
  const offset = (seed % 7) / 7;
  ctx.beginPath();
  ctx.arc(x + size * (0.3 + offset * 0.4), y + size * 0.45, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Fanion d'une salle conquise par le clan : un mât et une flamme dorée, en haut à gauche. */
function drawPennant(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = C.text;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size * 0.8, y + size * 0.25);
  ctx.lineTo(x, y + size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function checkMark(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = C.done;
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.4, cy);
  ctx.lineTo(cx - size * 0.1, cy + size * 0.3);
  ctx.lineTo(cx + size * 0.45, cy - size * 0.35);
  ctx.stroke();
  ctx.restore();
}

/** Le joueur : un pion doré, cerclé de lumière. */
function pawn(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
  glow.addColorStop(0, 'rgba(251, 191, 36, 0.55)');
  glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.gold;
  ctx.strokeStyle = C.sky1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.28, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.32, cy + size * 0.45);
  ctx.quadraticCurveTo(cx, cy - size * 0.2, cx + size * 0.32, cy + size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Monstre errant : un œil rouge dans la salle où il se tient. */
function drawWandererEye(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.4, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.sky1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Cadenas d'une salle piégée pas encore rencontrée, dans le guide. */
function drawLock(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = C.textDim;
  ctx.fillStyle = C.textDim;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.1, size * 0.22, Math.PI, 0);
  ctx.stroke();
  roundRect(ctx, cx - size * 0.32, cy - size * 0.1, size * 0.64, size * 0.5, size * 0.08);
  ctx.fill();
  ctx.restore();
}

/** Point d'exclamation rouge : ce qui se cache derrière l'apparence d'une salle piégée. */
function drawWarning(ctx: SKRSContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = C.sky1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  text(ctx, '!', cx, cy + 0.5, Math.round(radius * 1.4), C.text, 'center');
  ctx.restore();
}

function upArrow(ctx: SKRSContext2D, cx: number, cy: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.8, cy);
  ctx.lineTo(cx - size * 0.8, cy);
  ctx.closePath();
  ctx.fill();
}

// ─────────────────────────────────────────────────────────────
// Ambiance : effets d'étage et décor, sans rien changer à ce que la carte dit
// ─────────────────────────────────────────────────────────────

/** Géométrie de la tour dessinée, partagée par les couches d'ambiance. */
type Scene = {
  W: number;
  H: number;
  bodyX: number;
  bodyY: number;
  bodyW: number;
  bodyH: number;
  /** Épaisseur du mur autour des salles. */
  wall: number;
  top: number;
  crenel: number;
  palette: Palette;
  theme: TowerResolvedTheme;
  modifier: TowerFloorModifier;
  /** Graine tirée de la carte : le décor d'un étage reste le même d'un clic à l'autre. */
  seed: number;
};

function layoutSeed(layout: TowerLayout): number {
  return parseInt(towerLayoutKey(layout), 36) | 0;
}

/** Hasard reproductible (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(value: string, seed: number): number {
  let hash = seed ^ 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Flamme en goutte, pointe en haut. */
function flame(ctx: SKRSContext2D, cx: number, baseY: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, baseY - h);
  ctx.quadraticCurveTo(cx + w * 0.7, baseY - h * 0.35, cx + w * 0.45, baseY);
  ctx.lineTo(cx - w * 0.45, baseY);
  ctx.quadraticCurveTo(cx - w * 0.7, baseY - h * 0.35, cx, baseY - h);
  ctx.closePath();
  ctx.fill();
}

/** Derrière la tour : lueurs, pluie, neige, braises et brume du ciel. */
function drawAmbienceBehind(ctx: SKRSContext2D, scene: Scene): void {
  const { W, H, bodyX, bodyW, top } = scene;
  const rng = seeded(scene.seed ^ 0x2545f491);
  ctx.save();
  switch (scene.modifier) {
    case 'BLESSED': {
      const cx = bodyX + bodyW / 2;
      const glow = ctx.createRadialGradient(cx, top, 10, cx, top, bodyW * 0.9);
      glow.addColorStop(0, 'rgba(251, 191, 36, 0.35)');
      glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(253, 230, 138, 0.14)';
      ctx.lineWidth = 6;
      for (let ray = 0; ray < 9; ray++) {
        const angle = Math.PI * (1.05 + ray * 0.1);
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx + Math.cos(angle) * W, top + Math.sin(angle) * W);
        ctx.stroke();
      }
      break;
    }
    case 'BURNING': {
      const heat = ctx.createLinearGradient(0, H * 0.35, 0, H);
      heat.addColorStop(0, 'rgba(249, 115, 22, 0)');
      heat.addColorStop(1, 'rgba(249, 115, 22, 0.4)');
      ctx.fillStyle = heat;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rng() < 0.5 ? 'rgba(251, 146, 60, 0.8)' : 'rgba(253, 224, 71, 0.7)';
        ctx.beginPath();
        ctx.arc(rng() * W, rng() * H, 1 + rng() * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'FLOODED': {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 90; i++) {
        const x = rng() * W;
        const y = rng() * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y + 12);
        ctx.stroke();
      }
      break;
    }
    case 'FROST': {
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      for (let i = 0; i < 70; i++) {
        ctx.beginPath();
        ctx.arc(rng() * W, rng() * H, 0.8 + rng() * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'MIST': {
      for (let band = 0; band < 5; band++) {
        const y = H * (0.15 + band * 0.18) + rng() * 20;
        const mist = ctx.createLinearGradient(0, y - 30, 0, y + 30);
        mist.addColorStop(0, 'rgba(226, 232, 240, 0)');
        mist.addColorStop(0.5, 'rgba(226, 232, 240, 0.24)');
        mist.addColorStop(1, 'rgba(226, 232, 240, 0)');
        ctx.fillStyle = mist;
        ctx.fillRect(0, y - 30, W, 60);
      }
      break;
    }
    case 'MOONLESS':
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, W, H);
      break;
    default:
      break;
  }
  ctx.restore();
}

/** Décor des murs : torches, toiles d'araignée et touches propres au décor de l'étage. */
function drawWallDecor(ctx: SKRSContext2D, scene: Scene): void {
  const { bodyX, bodyY, bodyW, bodyH, wall, palette, theme, top, crenel } = scene;
  const rng = seeded(scene.seed ^ 0x68e31da4);
  ctx.save();

  // Touches du décor, sur les murs d'enceinte et le socle.
  const wallSpots = (count: number) => Array.from({ length: count }, () => {
    const side = rng();
    if (side < 0.35) return { x: bodyX + rng() * wall, y: bodyY + rng() * bodyH };
    if (side < 0.7) return { x: bodyX + bodyW - rng() * wall, y: bodyY + rng() * bodyH };
    return { x: bodyX - 14 + rng() * (bodyW + 28), y: bodyY + bodyH + rng() * 22 };
  });
  switch (theme) {
    case 'MOSS':
      for (const spot of wallSpots(16)) {
        ctx.fillStyle = rng() < 0.5 ? 'rgba(74, 222, 128, 0.35)' : 'rgba(34, 197, 94, 0.45)';
        ctx.beginPath();
        ctx.ellipse(spot.x, spot.y, 5 + rng() * 7, 3 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      // Lierre qui pend du chemin de ronde.
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
      ctx.lineWidth = 2;
      for (let vine = 0; vine < 5; vine++) {
        const x = bodyX + 10 + rng() * (bodyW - 20);
        const length = 14 + rng() * 26;
        ctx.beginPath();
        ctx.moveTo(x, top + crenel + 12);
        ctx.quadraticCurveTo(x + 6, top + crenel + 12 + length / 2, x - 2, top + crenel + 12 + length);
        ctx.stroke();
      }
      break;
    case 'CRYPT': {
      // Crânes posés sur le socle.
      const skulls = 3;
      for (let index = 0; index < skulls; index++) {
        const x = bodyX + bodyW * ((index + 0.5) / skulls) + (rng() - 0.5) * 30;
        drawSkull(ctx, x, bodyY + bodyH + 11, 7, 'rgba(226, 232, 240, 0.8)');
      }
      break;
    }
    case 'ICE':
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bodyX + 1, bodyY + 1, bodyW - 2, bodyH - 2);
      drawIcicles(ctx, bodyX - 6, top + crenel + 12, bodyW + 12, rng, 'rgba(186, 230, 253, 0.8)');
      break;
    case 'FORGE':
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.8)';
      ctx.lineWidth = 1.6;
      for (const spot of wallSpots(7)) drawCrack(ctx, spot.x, spot.y, 16, rng);
      break;
    case 'ARCANE':
      ctx.shadowColor = '#e879f9';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(232, 121, 249, 0.75)';
      ctx.lineWidth = 1.5;
      for (const spot of wallSpots(6)) drawRune(ctx, spot.x, spot.y, 6, rng);
      break;
    case 'ABYSS':
      ctx.shadowColor = '#6366f1';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.6)';
      ctx.lineWidth = 2;
      for (const spot of wallSpots(6)) drawCrack(ctx, spot.x, spot.y, 22, rng);
      break;
    default:
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1.4;
      for (const spot of wallSpots(5)) drawCrack(ctx, spot.x, spot.y, 14, rng);
      break;
  }
  ctx.restore();

  // Toiles d'araignée dans un ou deux angles de l'enceinte.
  const corners = [
    { x: bodyX, y: bodyY, dx: 1, dy: 1 },
    { x: bodyX + bodyW, y: bodyY, dx: -1, dy: 1 },
    { x: bodyX, y: bodyY + bodyH, dx: 1, dy: -1 },
    { x: bodyX + bodyW, y: bodyY + bodyH, dx: -1, dy: -1 },
  ];
  for (const corner of corners) {
    if (rng() < 0.45) drawCobweb(ctx, corner.x, corner.y, corner.dx, corner.dy, wall * 1.3);
  }

  // Torches sur les deux murs, à hauteur tirée de la carte.
  for (const x of [bodyX + wall / 2, bodyX + bodyW - wall / 2]) {
    const count = bodyH > 260 ? 2 : 1;
    for (let index = 0; index < count; index++) {
      const y = bodyY + bodyH * ((index + 0.5) / count) + (rng() - 0.5) * bodyH * 0.2;
      drawTorch(ctx, x, y, palette.torch);
    }
  }
}

/** Par-dessus la maçonnerie, sous les salles : neige, flammes, eau, brume, lumière. */
function drawAmbienceFront(ctx: SKRSContext2D, scene: Scene, merlons: { x: number; w: number }[]): void {
  const { W, H, bodyX, bodyY, bodyW, bodyH, wall, top, crenel } = scene;
  const rng = seeded(scene.seed ^ 0x1b873593);
  ctx.save();
  switch (scene.modifier) {
    case 'FROST': {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      for (const merlon of merlons) {
        roundRect(ctx, merlon.x - 1, top - 3, merlon.w + 2, 7, 3);
        ctx.fill();
      }
      roundRect(ctx, bodyX - 7, top + crenel - 3, bodyW + 14, 6, 3);
      ctx.fill();
      drawIcicles(ctx, bodyX - 6, top + crenel + 12, bodyW + 12, rng, 'rgba(224, 242, 254, 0.9)');
      // Givre sur l'enceinte.
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.35)';
      ctx.lineWidth = wall * 0.6;
      ctx.strokeRect(bodyX + wall * 0.3, bodyY + wall * 0.3, bodyW - wall * 0.6, bodyH - wall * 0.6);
      break;
    }
    case 'BURNING': {
      const scorch = ctx.createLinearGradient(0, bodyY + bodyH * 0.6, 0, bodyY + bodyH);
      scorch.addColorStop(0, 'rgba(0, 0, 0, 0)');
      scorch.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = scorch;
      ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
      const baseY = bodyY + bodyH + 22;
      for (let x = bodyX - 10; x < bodyX + bodyW + 14; x += 16) {
        const h = 18 + rng() * 22;
        flame(ctx, x + rng() * 6, baseY, 16, h, 'rgba(239, 68, 68, 0.85)');
        flame(ctx, x + 3 + rng() * 4, baseY, 10, h * 0.7, 'rgba(251, 146, 60, 0.9)');
        flame(ctx, x + 4 + rng() * 3, baseY, 5, h * 0.4, 'rgba(253, 224, 71, 0.95)');
      }
      break;
    }
    case 'FLOODED': {
      const waterTop = bodyY + bodyH - wall * 0.6;
      const water = ctx.createLinearGradient(0, waterTop, 0, H);
      water.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
      water.addColorStop(1, 'rgba(14, 116, 144, 0.6)');
      ctx.fillStyle = water;
      ctx.fillRect(0, waterTop, W, H - waterTop);
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.6)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 3; row++) {
        const y = waterTop + 4 + row * 14;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const wave = y + Math.sin((x + row * 17) / 11) * 2.5;
          if (x === 0) ctx.moveTo(x, wave);
          else ctx.lineTo(x, wave);
        }
        ctx.stroke();
      }
      break;
    }
    case 'BLESSED': {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.lineWidth = 3;
      ctx.strokeRect(bodyX + 1.5, bodyY + 1.5, bodyW - 3, bodyH - 3);
      for (let i = 0; i < 12; i++) drawSparkle(ctx, bodyX + rng() * bodyW, top + rng() * (crenel + 12), 3 + rng() * 3);
      break;
    }
    case 'MIST': {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.14)';
      ctx.fillRect(bodyX - 14, top, bodyW + 28, bodyY + bodyH + 22 - top);
      // Volutes au pied de la tour et le long des murs.
      for (let i = 0; i < 14; i++) {
        const x = bodyX - 20 + rng() * (bodyW + 40);
        const y = i < 8 ? bodyY + bodyH - 10 + rng() * 30 : bodyY + rng() * bodyH;
        const puff = ctx.createRadialGradient(x, y, 2, x, y, 34);
        puff.addColorStop(0, 'rgba(226, 232, 240, 0.28)');
        puff.addColorStop(1, 'rgba(226, 232, 240, 0)');
        ctx.fillStyle = puff;
        ctx.beginPath();
        ctx.arc(x, y, 34, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'MOONLESS':
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(bodyX - 14, top, bodyW + 28, bodyY + bodyH + 22 - top);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawIcicles(ctx: SKRSContext2D, x: number, y: number, w: number, rng: () => number, color: string): void {
  ctx.fillStyle = color;
  for (let ix = x + 4; ix < x + w - 4; ix += 9 + rng() * 8) {
    const length = 5 + rng() * 12;
    ctx.beginPath();
    ctx.moveTo(ix - 3, y);
    ctx.lineTo(ix + 3, y);
    ctx.lineTo(ix, y + length);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCrack(ctx: SKRSContext2D, x: number, y: number, length: number, rng: () => number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x;
  let cy = y;
  for (let step = 0; step < 3; step++) {
    cx += (rng() - 0.5) * length * 0.6;
    cy += length / 3;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}

function drawRune(ctx: SKRSContext2D, cx: number, cy: number, r: number, rng: () => number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const angle = rng() * Math.PI;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  ctx.lineTo(cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
  ctx.moveTo(cx, cy - r * 0.6);
  ctx.lineTo(cx, cy + r * 0.6);
  ctx.stroke();
}

function drawSparkle(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = 'rgba(253, 230, 138, 0.9)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.25, cy - r * 0.25);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx + r * 0.25, cy + r * 0.25);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.25, cy + r * 0.25);
  ctx.lineTo(cx - r, cy);
  ctx.lineTo(cx - r * 0.25, cy - r * 0.25);
  ctx.closePath();
  ctx.fill();
}

function drawSkull(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.15, r, Math.PI, 0);
  ctx.lineTo(cx + r * 0.65, cy + r * 0.7);
  ctx.lineTo(cx - r * 0.65, cy + r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(15, 12, 24, 0.9)';
  for (const dx of [-0.38, 0.38]) {
    ctx.beginPath();
    ctx.arc(cx + dx * r, cy, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCobweb(ctx: SKRSContext2D, x: number, y: number, dx: number, dy: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.4)';
  ctx.lineWidth = 1;
  const spokes = 4;
  for (let spoke = 0; spoke <= spokes; spoke++) {
    const angle = (spoke / spokes) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * size * dx, y + Math.sin(angle) * size * dy);
    ctx.stroke();
  }
  for (const ring of [0.4, 0.7, 1]) {
    ctx.beginPath();
    for (let spoke = 0; spoke <= spokes; spoke++) {
      const angle = (spoke / spokes) * (Math.PI / 2);
      const px = x + Math.cos(angle) * size * ring * dx;
      const py = y + Math.sin(angle) * size * ring * dy;
      if (spoke === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTorch(ctx: SKRSContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy - 6, 1, cx, cy - 6, 22);
  glow.addColorStop(0, withAlpha(color, 0.45));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy - 6, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b4636';
  ctx.fillRect(cx - 2, cy - 2, 4, 10);
  ctx.fillStyle = '#3f3128';
  ctx.fillRect(cx - 4, cy - 3, 8, 3);
  flame(ctx, cx, cy - 3, 8, 12, color);
  flame(ctx, cx, cy - 3, 4, 7, 'rgba(254, 243, 199, 0.9)');
  ctx.restore();
}

/** Accessoires des salles vides, par décor. */
const ROOM_PROPS: Record<TowerResolvedTheme, readonly RoomProp[]> = {
  STONE: ['bones', 'crack', 'web', 'pebbles'],
  MOSS: ['moss', 'mushroom', 'pebbles', 'bones'],
  CRYPT: ['skull', 'bones', 'web', 'candle'],
  ICE: ['crystal', 'crack', 'pebbles', 'bones'],
  FORGE: ['ember', 'crack', 'pebbles', 'bones'],
  ARCANE: ['rune', 'crystal', 'candle', 'web'],
  ABYSS: ['crack', 'bones', 'rune', 'skull'],
};
type RoomProp = 'bones' | 'crack' | 'web' | 'pebbles' | 'moss' | 'mushroom' | 'skull' | 'candle' | 'crystal' | 'ember' | 'rune';

function drawRoomProp(ctx: SKRSContext2D, scene: Scene, id: string, x: number, y: number, size: number): void {
  const rng = seeded(hashText(id, scene.seed));
  // Une salle vide sur trois reste nue : un décor partout ne se remarquerait plus.
  if (rng() < 0.33) return;
  const props = ROOM_PROPS[scene.theme];
  const prop = props[Math.floor(rng() * props.length)];
  const s = size * 0.13;
  const cx = x + size * 0.24;
  const cy = y + size * 0.76;
  ctx.save();
  ctx.globalAlpha = 0.65;
  switch (prop) {
    case 'bones':
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(1.5, s * 0.35);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - s, cy + s * 0.4);
      ctx.lineTo(cx + s, cy - s * 0.4);
      ctx.moveTo(cx - s, cy - s * 0.4);
      ctx.lineTo(cx + s, cy + s * 0.4);
      ctx.stroke();
      break;
    case 'crack':
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1.4;
      drawCrack(ctx, cx, cy - s * 1.2, s * 2.4, rng);
      break;
    case 'web':
      drawCobweb(ctx, x + 1, y + size - 1, 1, -1, size * 0.34);
      break;
    case 'pebbles':
      ctx.fillStyle = '#94a3b8';
      for (const [dx, dy, r] of [[-0.6, 0.2, 0.45], [0.3, 0.4, 0.35], [0.5, -0.3, 0.3]] as const) {
        ctx.beginPath();
        ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'moss':
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 1.2, s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'mushroom':
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(cx - s * 0.18, cy - s * 0.2, s * 0.36, s * 0.8);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.2, s * 0.6, Math.PI, 0);
      ctx.fill();
      break;
    case 'skull':
      drawSkull(ctx, cx, cy, s * 0.8, '#e2e8f0');
      break;
    case 'candle':
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(cx - s * 0.25, cy - s * 0.5, s * 0.5, s * 1.1);
      flame(ctx, cx, cy - s * 0.5, s * 0.5, s * 0.9, '#fbbf24');
      break;
    case 'crystal':
      ctx.fillStyle = scene.theme === 'ARCANE' ? '#e879f9' : '#7dd3fc';
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 1.2);
      ctx.lineTo(cx + s * 0.5, cy);
      ctx.lineTo(cx, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.5, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ember':
      ctx.fillStyle = '#fb923c';
      for (const [dx, dy] of [[-0.5, 0.2], [0.2, 0.5], [0.5, -0.2]] as const) {
        ctx.beginPath();
        ctx.arc(cx + dx * s, cy + dy * s, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'rune':
      ctx.strokeStyle = scene.theme === 'ABYSS' ? '#818cf8' : '#e879f9';
      ctx.lineWidth = 1.4;
      drawRune(ctx, cx, cy, s * 0.8, rng);
      break;
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// Vue de l'étage en cours (carte dessinée)
// ─────────────────────────────────────────────────────────────

const LADDER_WIDTH = 250;

function renderMap(input: TowerMapImage): Buffer {
  const { layout } = input;
  const tile = Math.max(30, Math.min(56, Math.floor(460 / Math.max(layout.width, layout.height))));
  const wall = 22;
  const bodyW = layout.width * tile + wall * 2;
  const bodyH = layout.height * tile + wall * 2;
  const margin = 36;
  const crenel = 26;
  const top = 70;
  const W = margin + bodyW + margin + LADDER_WIDTH + 24;
  const H = top + crenel + 12 + bodyH + 70;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const theme = resolveTowerTheme(layout.theme, input.floor ?? 1);
  const palette = PALETTES[theme];
  const modifier = layout.modifier ?? 'NONE';
  const bodyX = margin;
  const bodyY = top + crenel + 12;
  const scene: Scene = { W, H, bodyX, bodyY, bodyW, bodyH, wall, top, crenel, palette, theme, modifier, seed: layoutSeed(layout) };
  drawSky(ctx, W, H, palette, modifier === 'MOONLESS' ? null : { x: bodyX + bodyW - 34, y: 34 });
  drawAmbienceBehind(ctx, scene);
  drawBanner(ctx, bodyX + bodyW / 2, top, palette.banner);
  const merlons = drawBattlements(ctx, bodyX, top, bodyW, crenel, palette);
  drawBricks(ctx, bodyX, bodyY, bodyW, bodyH, palette.stone);
  // Socle, plus large que le fût.
  drawBricks(ctx, bodyX - 14, bodyY + bodyH, bodyW + 28, 22, palette.stoneDark, 11);
  drawWallDecor(ctx, scene);
  drawAmbienceFront(ctx, scene, merlons);
  drawPlaque(ctx, bodyX + bodyW / 2, bodyY + bodyH + 44, input.title, palette.stoneDark);

  const gx = bodyX + wall;
  const gy = bodyY + wall;
  const cells = occupancy(layout);
  const visible = input.visible ? new Set(input.visible) : null;
  const seen = (id: string) => !visible || visible.has(id);
  const center = (x: number, y: number) => ({ x: gx + x * tile + tile / 2, y: gy + y * tile + tile / 2 });

  // Couloirs d'abord : les salles les recouvrent, il n'en reste que le passage entre deux.
  ctx.fillStyle = palette.corridor;
  const corridor = tile * 0.36;
  for (const room of layout.rooms) {
    for (const [x, y] of roomCells(room)) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const other = cells.get(`${x + dx},${y + dy}`);
        if (!other || !seen(room.id) || !seen(other.id)) continue;
        const a = center(x, y);
        const b = center(x + dx, y + dy);
        if (dx === 1) ctx.fillRect(a.x, a.y - corridor / 2, b.x - a.x, corridor);
        else ctx.fillRect(a.x - corridor / 2, a.y, corridor, b.y - a.y);
      }
    }
  }

  // Le lien des portails, en pointillés, dès que les deux sont connus.
  const warpA = layout.rooms.find((room) => room.type === 'WARP_A');
  const warpB = layout.rooms.find((room) => room.type === 'WARP_B');
  if (warpA && warpB && seen(warpA.id) && seen(warpB.id)) {
    const a = center(warpA.x, warpA.y);
    const b = center(warpB.x, warpB.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  const inset = Math.max(3, Math.round(tile * 0.08));
  for (const room of layout.rooms) {
    if (!seen(room.id)) continue;
    const span = room.type === 'BOSS' ? 2 : 1;
    // Une mimique se dessine en coffre, une embuscade en couloir : rien ne les trahit avant.
    const shown: TowerRoomType = room.type === 'MIMIC' ? 'CHEST' : room.type === 'AMBUSH' || room.type === 'WANDERER' ? 'EMPTY' : room.type;
    const x = gx + room.x * tile + inset;
    const y = gy + room.y * tile + inset;
    const size = span * tile - inset * 2;
    const color = ROOM_COLOR[shown];
    const cleared = input.cleared.includes(room.id) && !isEntryRoom(room.type);

    roundRect(ctx, x, y, size, size, span === 2 ? 12 : 7);
    ctx.fillStyle = palette.floor;
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = cleared ? 0.12 : shown === 'EMPTY' ? 0.14 : 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.globalAlpha = cleared ? 0.35 : 0.9;
    ctx.lineWidth = span === 2 ? 3 : 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Chemin de l'oracle : un liseré doré jusqu'à la sortie.
    if (input.path?.includes(room.id)) {
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 3;
      roundRect(ctx, x - 1, y - 1, size + 2, size + 2, span === 2 ? 13 : 8);
      ctx.stroke();
      ctx.restore();
    }

    if (input.targets.includes(room.id)) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 2, y - 2, size + 4, size + 4, span === 2 ? 14 : 9);
      ctx.stroke();
      ctx.restore();
    }

    const cx = x + size / 2;
    const cy = y + size / 2;
    if (input.conquered?.includes(room.id)) drawPennant(ctx, x + 3, y + 3, Math.max(9, tile * 0.22));
    // Une salle vide garde un bout de décor dans un coin, tiré de la carte : il ne bouge pas.
    if (shown === 'EMPTY') drawRoomProp(ctx, scene, room.id, x, y, size);
    if (cleared) {
      checkMark(ctx, cx, cy, size * 0.42);
    } else {
      ctx.save();
      ctx.globalAlpha = shown === 'EMPTY' ? 0.5 : 1;
      glyph(ctx, shown, cx, cy, size * (span === 2 ? 0.42 : 0.55), color);
      ctx.restore();
      const badge = input.badges?.[room.id] ?? 0;
      if (badge > 0) drawBadge(ctx, x + size - 2, y + 2, Math.max(7, tile * 0.16), badge);
      if (input.keys?.includes(room.id)) drawKey(ctx, x + 3, y + size - 3, Math.max(8, tile * 0.2));
      const power = room.powerPercent ?? 100;
      // Une embuscade ou le repaire d'un errant ne s'annoncent pas, renforcés ou non.
      if (power !== 100 && hasTowerPower(room.type) && room.type !== 'AMBUSH' && room.type !== 'WANDERER') {
        drawPower(ctx, x + size - 2, y + size - 2, Math.max(9, Math.round(tile * 0.2)), power);
      }
    }
  }

  // Brouillard : tout ce qui n'est pas une salle visible disparaît sous la brume.
  if (visible) {
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const room = cells.get(`${x},${y}`);
        if (room && seen(room.id)) continue;
        drawFog(ctx, gx + x * tile, gy + y * tile, tile, x * 31 + y * 17);
      }
    }
  }

  // Monstres errants : un œil rouge dans la salle où ils se tiennent, s'ils sont en vue.
  for (const id of input.wanderers ?? []) {
    const room = layout.rooms.find((candidate) => candidate.id === id);
    if (!room || !seen(room.id) || room.id === input.pos) continue;
    drawWandererEye(ctx, gx + (room.x + 0.5) * tile, gy + (room.y + 0.5) * tile, tile * 0.22);
  }

  // Pas de pion tant que le joueur n'est pas entré : devant les entrées au choix, il n'est nulle part.
  const here = layout.rooms.find((room) => room.id === input.pos && input.cleared.includes(room.id));
  if (here) {
    const span = here.type === 'BOSS' ? 2 : 1;
    pawn(ctx, gx + (here.x + span / 2) * tile, gy + (here.y + span / 2) * tile, tile * 0.55);
  }

  drawLadder(ctx, bodyX + bodyW + margin, top, LADDER_WIDTH, H - top - 24, input.ladder);
  return canvas.toBuffer('image/png');
}

/** Échelle des étages : ceux à venir au-dessus, l'étage en cours éclairé, ceux franchis dessous. */
function drawLadder(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, ladder: TowerLadderEntry[]): void {
  if (ladder.length === 0) return;
  const pitch = Math.min(64, (h - 20) / ladder.length);
  const cardH = pitch - 12;
  const startY = y + (h - pitch * ladder.length) / 2;

  // Le fil de la montée, derrière les cartes.
  ctx.strokeStyle = 'rgba(167, 159, 191, 0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 22, startY);
  ctx.lineTo(x + 22, startY + pitch * ladder.length - 12);
  ctx.stroke();

  ladder.forEach((entry, index) => {
    const cy = startY + index * pitch;
    const current = entry.status === 'current';
    roundRect(ctx, x, cy, w, cardH, 10);
    ctx.fillStyle = current ? 'rgba(139, 92, 246, 0.28)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = current ? C.accent : 'rgba(196, 168, 255, 0.18)';
    ctx.lineWidth = current ? 2.5 : 1;
    ctx.stroke();

    const mid = cy + cardH / 2;
    if (entry.status === 'done') checkMark(ctx, x + 22, mid, 16);
    else if (current) pawn(ctx, x + 22, mid, 16);
    else upArrow(ctx, x + 22, mid + 6, 9, C.textDim);

    const color = current ? C.text : entry.status === 'done' ? C.textDim : 'rgba(237, 233, 247, 0.6)';
    ctx.font = canvasFont(current ? 17 : 15, 'bold');
    let label = entry.label;
    const maxWidth = w - 52;
    while (ctx.measureText(label).width > maxWidth && label.length > 4) label = `${label.slice(0, -2)}…`;
    text(ctx, label, x + 44, mid, current ? 17 : 15, color);
  });
}

// ─────────────────────────────────────────────────────────────
// Vue de face (portes aléatoires)
// ─────────────────────────────────────────────────────────────

const SHAFT_BELOW = 2;
const SHAFT_ABOVE = 3;

const PANEL_WIDTH = 300;

/** Encart de texte à droite, sur fond de parchemin sombre. */
function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, panel: TowerPanel): void {
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(196, 168, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const fit = (value: string, size: number, maxWidth: number) => {
    ctx.font = canvasFont(size, 'bold');
    let label = value;
    while (ctx.measureText(label).width > maxWidth && label.length > 4) label = `${label.slice(0, -2)}…`;
    return label;
  };
  text(ctx, fit(panel.title, 20, w - 36), x + 18, y + 30, 20, C.gold);
  panel.lines.slice(0, 9).forEach((line, index) => {
    text(ctx, fit(line, 15, w - 36), x + 18, y + 68 + index * 30, 15, index === 0 ? C.text : C.textDim);
  });
}

function renderShaft(input: TowerShaftImage): Buffer {
  const palette = PALETTES[resolveTowerTheme('AUTO', input.floor)];
  const bandH = 58;
  const bodyW = 340;
  const towerW = 520;
  const W = towerW + (input.panel ? PANEL_WIDTH + 20 : 0);
  const top = 40;
  const rows = SHAFT_ABOVE + 1 + SHAFT_BELOW;
  const H = top + rows * bandH + 90;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawSky(ctx, W, H, palette, { x: towerW - 46, y: 30 });

  const bodyX = (towerW - bodyW) / 2;
  const bodyY = top;
  drawBricks(ctx, bodyX, bodyY, bodyW, rows * bandH, palette.stone);

  for (let row = 0; row < rows; row++) {
    const floor = input.floor + SHAFT_ABOVE - row;
    const y = bodyY + row * bandH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(bodyX, y + bandH - 4, bodyW, 4);
    if (floor < 1) continue;
    const status = floor === input.floor ? 'current' : floor < input.floor ? 'done' : 'next';

    // Fenêtres : éclairées sur l'étage du joueur, tièdes en dessous, noires au-dessus.
    for (const wx of [bodyX + 40, bodyX + bodyW - 70]) {
      roundRect(ctx, wx, y + 12, 30, bandH - 26, 12);
      ctx.fillStyle = status === 'current' ? C.lit : status === 'done' ? 'rgba(244, 184, 96, 0.3)' : palette.sky1;
      ctx.fill();
    }
    const boss = input.bossEvery > 0 && floor % input.bossEvery === 0;
    const cx = towerW / 2;
    const cy = y + bandH / 2 - 2;
    if (status === 'current') {
      roundRect(ctx, bodyX + 4, y + 3, bodyW - 8, bandH - 10, 8);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      pawn(ctx, cx - 70, cy, 20);
    }
    text(ctx, input.floorLabel(floor), cx + 10, cy, status === 'current' ? 19 : 16, status === 'next' ? C.textDim : C.text, 'center');
    if (boss) glyph(ctx, 'BOSS', bodyX + bodyW - 100, cy, 20, status === 'done' ? 'rgba(245, 158, 11, 0.5)' : ROOM_COLOR.BOSS);
    if (status === 'done') checkMark(ctx, bodyX + 100, cy, 14);
  }

  // La tour se perd dans la nuit : on ne voit jamais son sommet.
  const fade = ctx.createLinearGradient(0, bodyY, 0, bodyY + bandH * 1.6);
  fade.addColorStop(0, palette.sky1);
  fade.addColorStop(1, withAlpha(palette.sky1, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(bodyX - 2, bodyY - 2, bodyW + 4, bandH * 1.6);
  upArrow(ctx, towerW / 2, bodyY + 14, 12, C.textDim);

  drawBricks(ctx, bodyX - 16, bodyY + rows * bandH, bodyW + 32, 22, palette.stoneDark, 11);
  drawPlaque(ctx, towerW / 2, bodyY + rows * bandH + 54, input.title, palette.stoneDark);
  if (input.panel) drawPanel(ctx, towerW, top, PANEL_WIDTH, rows * bandH, input.panel);
  return canvas.toBuffer('image/png');
}

// ─────────────────────────────────────────────────────────────
// Légende du guide des salles
// ─────────────────────────────────────────────────────────────

const LEGEND_COLUMNS = 2;
const LEGEND_TILE = 46;
const LEGEND_ROW = 62;
const LEGEND_COLUMN_W = 330;

/**
 * Légende du guide : chaque salle dessinée comme sur la carte, avec les mêmes couleurs et les
 * mêmes pictogrammes, pour que le joueur y reconnaisse ce qu'il voit en jeu.
 */
function renderLegend(input: TowerLegendImage): Buffer {
  const rows = Math.max(1, Math.ceil(input.entries.length / LEGEND_COLUMNS));
  const margin = 28;
  const top = 76;
  const W = margin * 2 + LEGEND_COLUMNS * LEGEND_COLUMN_W;
  const H = top + rows * LEGEND_ROW + margin;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawSky(ctx, W, H);
  drawBricks(ctx, margin - 10, top - 14, W - (margin - 10) * 2, rows * LEGEND_ROW + 20, C.stoneDark, 12);
  drawPlaque(ctx, W / 2, 36, input.title);

  input.entries.forEach((entry, index) => {
    const column = index % LEGEND_COLUMNS;
    const row = Math.floor(index / LEGEND_COLUMNS);
    const x = margin + column * LEGEND_COLUMN_W + 6;
    const y = top + row * LEGEND_ROW + (LEGEND_ROW - LEGEND_TILE) / 2;
    drawLegendTile(ctx, entry, x, y, LEGEND_TILE);

    ctx.font = canvasFont(17, 'bold');
    const maxWidth = LEGEND_COLUMN_W - LEGEND_TILE - 30;
    let label = entry.label;
    while (ctx.measureText(label).width > maxWidth && label.length > 4) label = `${label.slice(0, -2)}…`;
    const locked = 'room' in entry && entry.locked === true;
    text(ctx, label, x + LEGEND_TILE + 14, y + LEGEND_TILE / 2, 17, locked ? C.textDim : C.text);
  });

  return canvas.toBuffer('image/png');
}

function drawLegendTile(ctx: SKRSContext2D, entry: TowerLegendEntry, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  roundRect(ctx, x, y, size, size, 7);
  ctx.fillStyle = C.floor;
  ctx.fill();

  if ('marker' in entry) {
    ctx.strokeStyle = C.corridor;
    ctx.lineWidth = 2;
    ctx.stroke();
    switch (entry.marker) {
      case 'PAWN': pawn(ctx, cx, cy, size * 0.55); break;
      case 'TARGET':
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = C.text;
        roundRect(ctx, x - 2, y - 2, size + 4, size + 4, 9);
        ctx.stroke();
        ctx.restore();
        break;
      case 'CLEARED': checkMark(ctx, cx, cy, size * 0.42); break;
      case 'KEY': drawKey(ctx, x + 6, y + size - 6, Math.max(8, size * 0.4)); break;
      case 'BADGE': drawBadge(ctx, cx, cy, size * 0.2, 1); break;
      case 'POWER': drawPower(ctx, x + size - 4, y + size - 4, 12, 150); break;
      case 'WANDERER': drawWandererEye(ctx, cx, cy, size * 0.22); break;
      case 'PATH':
        ctx.save();
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 3;
        roundRect(ctx, x - 1, y - 1, size + 2, size + 2, 8);
        ctx.stroke();
        ctx.restore();
        break;
      case 'PENNANT': drawPennant(ctx, cx - size * 0.2, cy - size * 0.3, size * 0.6); break;
      case 'FOG': drawFog(ctx, x, y, size, 3); break;
    }
    return;
  }

  if (entry.locked) {
    drawFog(ctx, x, y, size, 5);
    ctx.strokeStyle = C.corridor;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, 7);
    ctx.stroke();
    drawLock(ctx, cx, cy, size * 0.6);
    return;
  }

  // Une salle piégée se dessine sous son apparence : c'est ce que le joueur verra sur la carte.
  const shown = entry.hidden ?? entry.room;
  const color = ROOM_COLOR[shown];
  ctx.save();
  ctx.globalAlpha = shown === 'EMPTY' ? 0.14 : 0.3;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.globalAlpha = shown === 'EMPTY' ? 0.5 : 1;
  glyph(ctx, shown, cx, cy, size * 0.55, color);
  ctx.restore();
  if (entry.hidden) drawWarning(ctx, x + size - 3, y + 3, Math.max(7, size * 0.17));
}

export async function renderTowerImage(input: TowerImageInput): Promise<Buffer | null> {
  try {
    ensureCanvasFonts();
    if (input.kind === 'legend') return renderLegend(input);
    return input.kind === 'map' ? renderMap(input) : renderShaft(input);
  } catch (error) {
    logger.error('RpgTower', 'Rendu de la tour en échec :', error);
    return null;
  }
}
