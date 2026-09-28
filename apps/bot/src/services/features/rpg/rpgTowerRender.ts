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
import { hasTowerPower, isEntryRoom, occupancy, roomCells, type TowerLayout, type TowerRoomType } from './rpgTowerMap.js';

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

const ROOM_COLOR: Record<TowerRoomType, string> = {
  START: '#94a3b8',
  WELL: '#64748b',
  ENTRANCE: '#94a3b8',
  COLLAPSE: '#fb923c',
  TOLL: '#facc15',
  FOUNTAIN: '#38bdf8',
  AMBUSH: '#94a3b8',
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

export type TowerImageInput = TowerMapImage | TowerShaftImage;

// ─────────────────────────────────────────────────────────────
// Décor
// ─────────────────────────────────────────────────────────────

/** Étoiles à positions fixes : la même tour ne scintille pas différemment à chaque clic. */
function drawSky(ctx: SKRSContext2D, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, C.sky1);
  sky.addColorStop(1, C.sky2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  ctx.fillStyle = C.star;
  for (let i = 0; i < 70; i++) {
    const r = next() < 0.85 ? 1 : 1.8;
    ctx.beginPath();
    ctx.arc(next() * w, next() * h * 0.8, r, 0, Math.PI * 2);
    ctx.fill();
  }
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
function drawBattlements(ctx: SKRSContext2D, x: number, y: number, w: number, height: number): void {
  let count = Math.max(5, Math.round(w / 38));
  if (count % 2 === 0) count += 1;
  const unit = w / count;
  for (let i = 0; i < count; i += 2) {
    drawBricks(ctx, x + i * unit, y, unit, height, C.stoneLight, 12);
  }
  drawBricks(ctx, x - 6, y + height, w + 12, 12, C.stoneLight, 12);
}

/** Mât et bannière au sommet. */
function drawBanner(ctx: SKRSContext2D, cx: number, baseY: number): void {
  ctx.strokeStyle = C.textDim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, baseY - 46);
  ctx.stroke();
  ctx.fillStyle = C.accent;
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
function drawPlaque(ctx: SKRSContext2D, cx: number, cy: number, label: string): void {
  ctx.font = canvasFont(18, 'bold');
  const width = Math.max(160, ctx.measureText(label).width + 44);
  roundRect(ctx, cx - width / 2, cy - 18, width, 36, 8);
  ctx.fillStyle = C.stoneDark;
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

  drawSky(ctx, W, H);
  const bodyX = margin;
  const bodyY = top + crenel + 12;
  drawBanner(ctx, bodyX + bodyW / 2, top);
  drawBattlements(ctx, bodyX, top, bodyW, crenel);
  drawBricks(ctx, bodyX, bodyY, bodyW, bodyH);
  // Socle, plus large que le fût.
  drawBricks(ctx, bodyX - 14, bodyY + bodyH, bodyW + 28, 22, C.stoneDark, 11);
  drawPlaque(ctx, bodyX + bodyW / 2, bodyY + bodyH + 44, input.title);

  const gx = bodyX + wall;
  const gy = bodyY + wall;
  const cells = occupancy(layout);
  const visible = input.visible ? new Set(input.visible) : null;
  const seen = (id: string) => !visible || visible.has(id);
  const center = (x: number, y: number) => ({ x: gx + x * tile + tile / 2, y: gy + y * tile + tile / 2 });

  // Couloirs d'abord : les salles les recouvrent, il n'en reste que le passage entre deux.
  ctx.fillStyle = C.corridor;
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
    const shown: TowerRoomType = room.type === 'MIMIC' ? 'CHEST' : room.type === 'AMBUSH' ? 'EMPTY' : room.type;
    const x = gx + room.x * tile + inset;
    const y = gy + room.y * tile + inset;
    const size = span * tile - inset * 2;
    const color = ROOM_COLOR[shown];
    const cleared = input.cleared.includes(room.id) && !isEntryRoom(room.type);

    roundRect(ctx, x, y, size, size, span === 2 ? 12 : 7);
    ctx.fillStyle = C.floor;
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
      // Une embuscade renforcée ne s'annonce pas plus qu'une autre.
      if (power !== 100 && hasTowerPower(room.type) && room.type !== 'AMBUSH') {
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
  const bandH = 58;
  const bodyW = 340;
  const towerW = 520;
  const W = towerW + (input.panel ? PANEL_WIDTH + 20 : 0);
  const top = 40;
  const rows = SHAFT_ABOVE + 1 + SHAFT_BELOW;
  const H = top + rows * bandH + 90;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawSky(ctx, W, H);

  const bodyX = (towerW - bodyW) / 2;
  const bodyY = top;
  drawBricks(ctx, bodyX, bodyY, bodyW, rows * bandH);

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
      ctx.fillStyle = status === 'current' ? C.lit : status === 'done' ? 'rgba(244, 184, 96, 0.3)' : C.sky1;
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
  fade.addColorStop(0, C.sky1);
  fade.addColorStop(1, 'rgba(13, 10, 26, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(bodyX - 2, bodyY - 2, bodyW + 4, bandH * 1.6);
  upArrow(ctx, towerW / 2, bodyY + 14, 12, C.textDim);

  drawBricks(ctx, bodyX - 16, bodyY + rows * bandH, bodyW + 32, 22, C.stoneDark, 11);
  drawPlaque(ctx, towerW / 2, bodyY + rows * bandH + 54, input.title);
  if (input.panel) drawPanel(ctx, towerW, top, PANEL_WIDTH, rows * bandH, input.panel);
  return canvas.toBuffer('image/png');
}

export async function renderTowerImage(input: TowerImageInput): Promise<Buffer | null> {
  try {
    ensureCanvasFonts();
    return input.kind === 'map' ? renderMap(input) : renderShaft(input);
  } catch (error) {
    logger.error('RpgTower', 'Rendu de la tour en échec :', error);
    return null;
  }
}
