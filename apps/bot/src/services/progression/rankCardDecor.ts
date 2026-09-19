import { loadImage, Path2D, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import {
  getRankCardAchievement,
  RANK_CARD_BADGE_ICONS,
  RANK_CARD_TIER_COLORS,
  type RankCardAchievementTier,
  type RankCardBadgeIconId,
} from '@kotbo/shared';
import { logger } from '../../utils/logger.js';

type Gradient = ReturnType<SKRSContext2D['createLinearGradient']>;

const GOLD = ['#fde68a', '#f59e0b', '#b45309'];
const PRISM = ['#f472b6', '#facc15', '#34d399', '#22d3ee', '#a78bfa', '#f472b6'];

const BADGE_IMAGE_DIR = fileURLToPath(new URL('../../../assets/rank-badges/', import.meta.url));

// `null` memorise un fichier manquant : sans lui, un asset absent relancait un
// acces disque a chaque carte rendue. Le badge retombe alors sur son trace.
const badgeImages = new Map<string, Image | null>();

async function loadBadgeImage(image: string): Promise<Image | null> {
  const cached = badgeImages.get(image);
  if (cached !== undefined) return cached;

  try {
    const loaded = await loadImage(`${BADGE_IMAGE_DIR}${image}.png`);
    badgeImages.set(image, loaded);
    return loaded;
  } catch (error) {
    logger.warn('RankCard', `Image de badge ${image}.png illisible:`, error);
    badgeImages.set(image, null);
    return null;
  }
}

const iconPaths = new Map<RankCardBadgeIconId, Path2D>();

function iconPath(icon: RankCardBadgeIconId): Path2D {
  let path = iconPaths.get(icon);
  if (!path) {
    path = new Path2D(RANK_CARD_BADGE_ICONS[icon]);
    iconPaths.set(icon, path);
  }
  return path;
}

function linearGradient(ctx: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, colors: string[]): Gradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  colors.forEach((color, index) => gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color));
  return gradient;
}

/** Tirage pseudo-aléatoire à graine fixe : l'aperçu et `/rank` doivent dessiner le même ciel. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawRankCardPattern(ctx: SKRSContext2D, patternId: string, width: number, height: number): void {
  if (patternId === 'none') return;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 22);
  ctx.clip();
  ctx.lineWidth = 1;

  if (patternId === 'grid') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.beginPath();
    for (let x = 28; x < width; x += 28) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 28; y < height; y += 28) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  } else if (patternId === 'dots') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let row = 0, y = 11; y < height; row++, y += 22) {
      for (let x = row % 2 ? 22 : 11; x < width; x += 22) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (patternId === 'diagonal') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    for (let x = -height; x < width; x += 16) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height, height);
    }
    ctx.stroke();
  } else if (patternId === 'hexagons') {
    const radius = 20;
    const stepX = Math.sqrt(3) * radius;
    const stepY = 1.5 * radius;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.beginPath();
    for (let row = 0; row * stepY < height + radius; row++) {
      for (let col = -1; col * stepX < width + stepX; col++) {
        const cx = col * stepX + (row % 2 ? stepX / 2 : 0);
        const cy = row * stepY;
        for (let side = 0; side <= 6; side++) {
          const angle = Math.PI / 6 + (side * Math.PI) / 3;
          const px = cx + radius * Math.cos(angle);
          const py = cy + radius * Math.sin(angle);
          if (side === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
    }
    ctx.stroke();
  } else if (patternId === 'stars') {
    const random = seededRandom(7);
    for (let i = 0; i < 110; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.08 + random() * 0.27).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, 0.6 + random() * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (let group = 0; group < 4; group++) {
      const originX = (group + 0.5) * (width / 4) + (random() - 0.5) * 80;
      const originY = 40 + random() * (height - 80);
      const points = Array.from({ length: 4 }, () => [originX + (random() - 0.5) * 120, originY + (random() - 0.5) * 90]);
      ctx.beginPath();
      points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (patternId === 'circuit') {
    const random = seededRandom(23);
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    for (let y = 18; y < height; y += 34) {
      for (let x = 10; x < width; x += 60) {
        if (random() < 0.45) continue;
        const run = 18 + random() * 26;
        const bend = (random() < 0.5 ? -1 : 1) * (8 + random() * 10);
        const endX = x + run + Math.abs(bend);
        const endY = y + bend;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + run, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        for (const [px, py] of [[x, y], [endX, endY]]) {
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.restore();
}

function fillDisc(ctx: SKRSContext2D, cx: number, cy: number, radius: number, fill: string | Gradient): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export type AvatarFrameGeometry = {
  cx: number;
  cy: number;
  radius: number;
  accentStart: string;
  accentEnd: string;
  backdrop: string;
};

/** Anneau et disque de fond, dessinés sous l'avatar. */
export function drawAvatarFrameBase(ctx: SKRSContext2D, frameId: string, frame: AvatarFrameGeometry): void {
  const { cx, cy, radius, accentStart, accentEnd, backdrop } = frame;
  const accent = linearGradient(ctx, cx - radius, cy - radius, cx + radius, cy + radius, [accentStart, accentEnd]);

  switch (frameId) {
    case 'double':
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      fillDisc(ctx, cx, cy, radius + 4, accent);
      break;
    case 'dashed': {
      const segments = 18;
      const span = ((Math.PI * 2) / segments) * 0.62;
      ctx.save();
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = accent;
      for (let i = 0; i < segments; i++) {
        const start = (i * Math.PI * 2) / segments - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, start, start + span);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'glow':
      ctx.save();
      ctx.shadowColor = accentEnd;
      ctx.shadowBlur = 26;
      fillDisc(ctx, cx, cy, radius + 4, accent);
      ctx.restore();
      break;
    case 'laurel':
      fillDisc(ctx, cx, cy, radius + 4, linearGradient(ctx, cx, cy - radius, cx, cy + radius, GOLD));
      break;
    case 'radar': {
      // Repères aux quatre points cardinaux seulement : la pastille de statut
      // occupe la diagonale bas-droite.
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      for (const offset of [11, 18]) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + offset, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let quarter = 0; quarter < 4; quarter++) {
        const angle = (quarter * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * (radius + 7), cy + Math.sin(angle) * (radius + 7));
        ctx.lineTo(cx + Math.cos(angle) * (radius + 21), cy + Math.sin(angle) * (radius + 21));
        ctx.stroke();
      }
      ctx.restore();
      fillDisc(ctx, cx, cy, radius + 4, accent);
      break;
    }
    case 'prism': {
      const conic = ctx.createConicGradient(0, cx, cy);
      PRISM.forEach((color, index) => conic.addColorStop(index / (PRISM.length - 1), color));
      fillDisc(ctx, cx, cy, radius + 6, conic);
      break;
    }
    default:
      fillDisc(ctx, cx, cy, radius + 4, accent);
  }

  fillDisc(ctx, cx, cy, radius + 1, backdrop);
}

/** Ornements qui débordent sur l'avatar, dessinés après lui. */
export function drawAvatarFrameOverlay(ctx: SKRSContext2D, frameId: string, frame: AvatarFrameGeometry): void {
  const { cx, cy, radius, backdrop } = frame;

  if (frameId === 'laurel') {
    const leafRadius = radius + 14;
    const tilt = 0.45;
    ctx.save();
    ctx.fillStyle = linearGradient(ctx, cx, cy - leafRadius, cx, cy + leafRadius, GOLD);
    ctx.strokeStyle = backdrop;
    ctx.lineWidth = 1.5;
    for (let degrees = 120; degrees <= 240; degrees += 20) {
      const left = (degrees * Math.PI) / 180;
      const right = Math.PI - left;
      for (const [angle, rotation] of [[left, left + Math.PI / 2 + tilt], [right, right + Math.PI / 2 - tilt]]) {
        ctx.beginPath();
        ctx.ellipse(cx + leafRadius * Math.cos(angle), cy + leafRadius * Math.sin(angle), 8, 3.4, rotation, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  if (frameId === 'crown') {
    const size = 40;
    const scale = size / 24;
    // La base de la couronne (y = 22 sur la grille de l'icône) mord sur l'anneau
    // pour qu'elle paraisse posée sur l'avatar et non flottante au-dessus.
    const x = cx - 12 * scale;
    const y = cy - radius + 8 - 22 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const path = iconPath('crown');
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = backdrop;
    ctx.stroke(path);
    ctx.fillStyle = linearGradient(ctx, 0, 5, 0, 22, GOLD);
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }
}

export type ProgressBarGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  progress: number;
  accentStart: string;
  accentEnd: string;
};

function roundRectPath(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

export function drawProgressBar(ctx: SKRSContext2D, barStyleId: string, bar: ProgressBarGeometry): void {
  const { x, y, width, height, progress, accentStart, accentEnd } = bar;
  const radius = height / 2;
  const track = 'rgba(255, 255, 255, 0.06)';

  if (barStyleId === 'segmented') {
    const segments = 24;
    const gap = 4;
    const segmentWidth = (width - gap * (segments - 1)) / segments;
    const filled = Math.round(progress * segments);
    const fill = linearGradient(ctx, x, 0, x + width, 0, [accentStart, accentEnd]);
    for (let i = 0; i < segments; i++) {
      roundRectPath(ctx, x + i * (segmentWidth + gap), y, segmentWidth, height, 4);
      ctx.fillStyle = i < filled ? fill : track;
      ctx.fill();
    }
    return;
  }

  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = track;
  ctx.fill();
  if (progress <= 0) return;

  const filledWidth = Math.max(height, width * progress);
  roundRectPath(ctx, x, y, filledWidth, height, radius);
  ctx.fillStyle = linearGradient(ctx, x, 0, x + filledWidth, 0, [accentStart, accentEnd]);
  ctx.fill();

  if (barStyleId === 'striped') {
    ctx.save();
    roundRectPath(ctx, x, y, filledWidth, height, radius);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (let stripe = x - height; stripe < x + filledWidth; stripe += 14) {
      ctx.beginPath();
      ctx.moveTo(stripe, y + height);
      ctx.lineTo(stripe + height, y);
      ctx.lineTo(stripe + height + 7, y);
      ctx.lineTo(stripe + 7, y + height);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

export const RANK_BADGE_RADIUS = 15;
const RANK_BADGE_GAP = 10;

export function tierTextColor(tier: RankCardAchievementTier): string {
  return RANK_CARD_TIER_COLORS[tier][0];
}

/** Aligne les badges à partir de `startX`, centrés verticalement sur `centerY`. */
export async function drawRankCardBadges(
  ctx: SKRSContext2D,
  badges: string[],
  startX: number,
  centerY: number,
): Promise<void> {
  let cx = startX + RANK_BADGE_RADIUS;

  for (const id of badges) {
    const achievement = getRankCardAchievement(id);
    if (!achievement) continue;
    const colors = RANK_CARD_TIER_COLORS[achievement.tier];
    const image = achievement.image ? await loadBadgeImage(achievement.image) : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, centerY, RANK_BADGE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = linearGradient(ctx, cx - RANK_BADGE_RADIUS, centerY - RANK_BADGE_RADIUS, cx + RANK_BADGE_RADIUS, centerY + RANK_BADGE_RADIUS, colors);
    ctx.stroke();

    // Une image de badge est une tuile carrée : à taille égale elle paraît plus
    // petite qu'une icône pleine. Sa demi-diagonale reste sous le rayon du
    // badge, elle ne déborde donc pas du liseré.
    const size = RANK_BADGE_RADIUS * (image ? 1.35 : 1.2);
    if (image) {
      ctx.drawImage(image, cx - size / 2, centerY - size / 2, size, size);
    } else {
      const scale = size / 24;
      ctx.translate(cx - size / 2, centerY - size / 2);
      ctx.scale(scale, scale);
      ctx.fillStyle = linearGradient(ctx, 0, 0, 24, 24, colors);
      ctx.fill(iconPath(achievement.icon), 'evenodd');
    }
    ctx.restore();

    cx += RANK_BADGE_RADIUS * 2 + RANK_BADGE_GAP;
  }
}
