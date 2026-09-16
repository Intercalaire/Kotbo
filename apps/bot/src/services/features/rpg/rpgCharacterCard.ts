/**
 * Carte de personnage : le rendu image de la fiche RPG.
 *
 * La fiche se lisait en une colonne de champs d'embed — on ne « voyait » jamais son
 * personnage, on lisait une liste de nombres. La carte met le portrait, l'équipement porté
 * et les jauges sur une seule image, dans la disposition d'une feuille de personnage.
 *
 * ELLE NE DÉCIDE RIEN : tout ce qu'elle affiche lui est fourni. Recalculer une statistique
 * ici la ferait diverger de `getEffectiveStats`, et la carte mentirait au joueur sur ce
 * que le combat va réellement utiliser.
 *
 * Le rendu ne doit jamais faire échouer l'écran qui l'appelle : l'appelant passe par
 * `renderCharacterCard`, qui rend `null` sur incident plutôt que de lever.
 */

import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { logger } from '../../../utils/logger.js';
import { canvasFont, ensureCanvasFonts } from '../../../utils/canvasFonts.js';

const W = 900;
const H = 470;

// ─────────────────────────────────────────────────────────────
// Rythme vertical du panneau droit
//
// Les repères sont nommés parce qu'ils se répondent : déplacer les jauges sans
// déplacer l'intitulé qui les annonce rouvrait le trou qu'on vient de combler.
// ─────────────────────────────────────────────────────────────

/** Marge intérieure des panneaux. La dernière jauge s'arrête à cette distance du bord. */
const PANEL_PADDING = 20;
/** Hauteur d'une ligne d'équipement, et pas entre deux lignes. */
const SLOT_HEIGHT = 34;
const SLOT_PITCH = 44;
const SLOTS_TOP = 66;
/** Hauteur d'une barre de jauge, et pas entre deux jauges. */
const GAUGE_HEIGHT = 16;
const GAUGE_PITCH = 42;
/** La dernière barre finit à `PANEL_PADDING` du bas du panneau, les autres au-dessus. */
const GAUGES_TOP = H - PANEL_PADDING - GAUGE_HEIGHT - PANEL_PADDING - GAUGE_PITCH * 2;
/** L'intitulé se pose au-dessus du libellé de la première jauge. */
const GAUGES_HEADER_Y = GAUGES_TOP - 32;

/** Nom du fichier joint. L'embed le référence en `attachment://`. */
export const CHARACTER_CARD_FILENAME = 'personnage.png';

/**
 * Palette propre au RPG, distincte de la charte « tableau noir » du reste du bot.
 *
 * Le module a sa direction artistique — améthyste et parchemin — et une carte de
 * personnage rendue aux couleurs des cartes de statistiques n'aurait aucune parenté
 * visuelle avec les écrans qu'elle accompagne.
 */
const CARD = {
  bg1: '#161221',
  bg2: '#1F1930',
  panel: 'rgba(255, 255, 255, 0.05)',
  panelAlt: 'rgba(255, 255, 255, 0.03)',
  border: 'rgba(196, 168, 255, 0.22)',
  accent: '#8b5cf6',
  accentSoft: 'rgba(139, 92, 246, 0.18)',
  text: '#EDE9F7',
  textDim: '#A79FBF',
  textFaint: '#6E6688',
  hp: '#e05263',
  xp: '#4cc9f0',
  energy: '#f4d35e',
  locked: 'rgba(255, 255, 255, 0.10)',
} as const;

/** Teinte de rareté, partagée avec les icônes du panneau. */
const RARITY_COLOR: Record<string, string> = {
  COMMON: '#9AA0A6',
  UNCOMMON: '#4ade80',
  RARE: '#60a5fa',
  EPIC: '#c084fc',
  LEGENDARY: '#fbbf24',
};

export type CardSlot = {
  label: string;
  /** Nom de l'objet porté. `null` quand l'emplacement est vide. */
  itemName: string | null;
  rarity: string | null;
  /** Niveau de forge, ajouté au nom sous la forme « +7 ». */
  upgrade: number;
  /** Emplacement pas encore débloqué : il s'affiche grisé, avec son niveau requis. */
  lockedAtLevel: number | null;
};

export type CardGauge = { current: number; max: number };

export type CharacterCardInput = {
  displayName: string;
  avatarUrl: string | null;
  level: number;
  className: string | null;
  /** Statistiques EFFECTIVES, telles que le combat les utilisera. */
  stats: { attack: number; defense: number; speed: number; critChance: number };
  hp: CardGauge;
  xp: CardGauge;
  energy: CardGauge;
  slots: CardSlot[];
  /** Nom de la guilde RPG, affiché sous le nom du personnage. */
  guildName: string | null;
};

// ─────────────────────────────────────────────────────────────
// Primitives de dessin
// ─────────────────────────────────────────────────────────────

function roundRect(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number, r: number,
  fill?: string | CanvasGradient,
  stroke?: string,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

/** Coupe un texte trop long en le terminant par une ellipse, à la largeur disponible. */
function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawBackground(ctx: SKRSContext2D): void {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, CARD.bg1);
  base.addColorStop(1, CARD.bg2);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Halo d'accent derrière le portrait : il donne une profondeur au panneau de gauche,
  // qui sans lui se lit comme un simple rectangle plus clair.
  const glow = ctx.createRadialGradient(170, 200, 20, 170, 200, 320);
  glow.addColorStop(0, CARD.accentSoft);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawGauge(
  ctx: SKRSContext2D,
  x: number, y: number, w: number,
  label: string,
  gauge: CardGauge,
  color: string,
): void {
  const h = GAUGE_HEIGHT;
  // Le maximum peut valoir zéro sur un profil incohérent : sans cette garde, la barre
  // vaudrait NaN et ne se dessinerait pas du tout.
  const ratio = gauge.max > 0 ? Math.min(1, Math.max(0, gauge.current / gauge.max)) : 0;

  ctx.font = canvasFont(13, 'bold');
  ctx.fillStyle = CARD.textDim;
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);

  ctx.font = canvasFont(13);
  ctx.fillStyle = CARD.text;
  ctx.textAlign = 'right';
  ctx.fillText(`${gauge.current} / ${gauge.max}`, x + w, y - 6);

  roundRect(ctx, x, y, w, h, h / 2, CARD.locked);
  if (ratio > 0) {
    const fill = ctx.createLinearGradient(x, y, x + w * ratio, y);
    fill.addColorStop(0, color);
    fill.addColorStop(1, `${color}AA`);
    roundRect(ctx, x, y, Math.max(h, w * ratio), h, h / 2, fill);
  }
}

/** Portrait circulaire. Sans avatar exploitable, on grave l'initiale dans le médaillon. */
async function drawPortrait(ctx: SKRSContext2D, url: string | null, cx: number, cy: number, radius: number, name: string): Promise<void> {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let drawn = false;
  if (url) {
    try {
      const image = await loadImage(url);
      ctx.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
      drawn = true;
    } catch (error) {
      // Un avatar injoignable ne doit pas emporter la carte : on retombe sur l'initiale.
      logger.warn('RpgCard', `Avatar illisible pour la carte de ${name} :`, error);
    }
  }

  if (!drawn) {
    ctx.fillStyle = CARD.accentSoft;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = CARD.text;
    ctx.font = canvasFont(radius, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name.trim()[0] ?? '?').toUpperCase(), cx, cy);
  }

  ctx.restore();

  // Anneau d'accent, dessiné hors du masque pour rester net.
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = CARD.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** Bloc d'une statistique de combat : sa valeur en gros, son nom en dessous. */
function drawStatTile(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, value: string, label: string): void {
  roundRect(ctx, x, y, w, h, 10, CARD.panelAlt, CARD.border);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = canvasFont(22, 'bold');
  ctx.fillStyle = CARD.text;
  ctx.fillText(value, x + w / 2, y + h / 2 + 4);

  ctx.font = canvasFont(11);
  ctx.fillStyle = CARD.textFaint;
  ctx.fillText(label, x + w / 2, y + h - 9);
}

/** Ligne d'équipement : l'emplacement à gauche, l'objet porté à droite, teinté par rareté. */
function drawSlotRow(ctx: SKRSContext2D, x: number, y: number, w: number, slot: CardSlot): void {
  const h = SLOT_HEIGHT;
  const locked = slot.lockedAtLevel !== null;

  roundRect(ctx, x, y, w, h, 8, locked ? 'rgba(0,0,0,0.18)' : CARD.panel, CARD.border);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.font = canvasFont(12, 'bold');
  ctx.fillStyle = locked ? CARD.textFaint : CARD.textDim;
  ctx.fillText(fitText(ctx, slot.label, 110), x + 12, y + h / 2);

  const valueX = x + 132;
  const valueWidth = w - 144;

  if (locked) {
    ctx.font = canvasFont(13);
    ctx.fillStyle = CARD.textFaint;
    ctx.fillText(fitText(ctx, `Verrouillé — niveau ${slot.lockedAtLevel}`, valueWidth), valueX, y + h / 2);
    return;
  }

  if (!slot.itemName) {
    ctx.font = canvasFont(13);
    ctx.fillStyle = CARD.textFaint;
    ctx.fillText('—', valueX, y + h / 2);
    return;
  }

  const name = slot.upgrade > 0 ? `${slot.itemName} +${slot.upgrade}` : slot.itemName;
  ctx.font = canvasFont(14, 'bold');
  ctx.fillStyle = RARITY_COLOR[slot.rarity ?? 'COMMON'] ?? CARD.text;
  ctx.fillText(fitText(ctx, name, valueWidth), valueX, y + h / 2);
}

// ─────────────────────────────────────────────────────────────
// Rendu
// ─────────────────────────────────────────────────────────────

function draw(ctx: SKRSContext2D, input: CharacterCardInput): void {
  drawBackground(ctx);

  // ── Panneau de gauche : identité et statistiques de combat ──
  const leftW = 300;
  roundRect(ctx, 20, 20, leftW, H - 40, 16, CARD.panel, CARD.border);

  // ── Panneau de droite : équipement et jauges ──
  const rightX = leftW + 40;
  const rightW = W - rightX - 20;
  roundRect(ctx, rightX, 20, rightW, H - 40, 16, CARD.panel, CARD.border);

  // Nom, classe, guilde.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = canvasFont(24, 'bold');
  ctx.fillStyle = CARD.text;
  ctx.fillText(fitText(ctx, input.displayName, leftW - 40), 20 + leftW / 2, 280);

  ctx.font = canvasFont(14);
  ctx.fillStyle = CARD.textDim;
  const subtitle = input.className
    ? `${input.className} · Niveau ${input.level}`
    : `Niveau ${input.level}`;
  ctx.fillText(fitText(ctx, subtitle, leftW - 40), 20 + leftW / 2, 304);

  if (input.guildName) {
    ctx.font = canvasFont(12);
    ctx.fillStyle = CARD.textFaint;
    ctx.fillText(fitText(ctx, input.guildName, leftW - 40), 20 + leftW / 2, 326);
  }

  // Trois statistiques de combat, plus le critique.
  const tileW = 80;
  const tileGap = 10;
  const tilesX = 20 + (leftW - (tileW * 3 + tileGap * 2)) / 2;
  drawStatTile(ctx, tilesX, 348, tileW, 56, String(input.stats.attack), 'ATTAQUE');
  drawStatTile(ctx, tilesX + tileW + tileGap, 348, tileW, 56, String(input.stats.defense), 'DÉFENSE');
  drawStatTile(ctx, tilesX + (tileW + tileGap) * 2, 348, tileW, 56, String(input.stats.speed), 'VITESSE');

  ctx.textAlign = 'center';
  ctx.font = canvasFont(12);
  ctx.fillStyle = CARD.textFaint;
  ctx.fillText(`Critique ${Math.round(input.stats.critChance * 100)} %`, 20 + leftW / 2, 428);

  // Équipement.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = canvasFont(13, 'bold');
  ctx.fillStyle = CARD.accent;
  ctx.fillText('ÉQUIPEMENT', rightX + 20, 52);

  let slotY = SLOTS_TOP;
  for (const slot of input.slots) {
    drawSlotRow(ctx, rightX + 20, slotY, rightW - 40, slot);
    slotY += SLOT_PITCH;
  }

  // Un intitulé sépare l'équipement des jauges : sans lui, les cinquante pixels qui
  // les séparent passaient pour un trou dans la carte plutôt que pour une respiration.
  ctx.font = canvasFont(13, 'bold');
  ctx.fillStyle = CARD.accent;
  ctx.fillText('PROGRESSION', rightX + 20, GAUGES_HEADER_Y);

  // Jauges, calées en bas du panneau pour qu'un équipement plus court ne les déplace pas.
  // La dernière barre s'arrête à `PANEL_PADDING` du bord : à `H - 34`, elle dépassait du
  // panneau et venait mordre sa bordure.
  const gaugeX = rightX + 20;
  const gaugeW = rightW - 40;
  drawGauge(ctx, gaugeX, GAUGES_TOP, gaugeW, 'POINTS DE VIE', input.hp, CARD.hp);
  drawGauge(ctx, gaugeX, GAUGES_TOP + GAUGE_PITCH, gaugeW, 'EXPÉRIENCE', input.xp, CARD.xp);
  drawGauge(ctx, gaugeX, GAUGES_TOP + GAUGE_PITCH * 2, gaugeW, 'ÉNERGIE', input.energy, CARD.energy);
}

/**
 * Rend la carte, ou `null` si le rendu échoue.
 *
 * Aucun incident graphique ne doit priver le joueur de sa fiche : l'écran appelant
 * retombe alors sur ses champs texte, qui portent la même information.
 */
export async function renderCharacterCard(input: CharacterCardInput): Promise<Buffer | null> {
  try {
    ensureCanvasFonts();

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Le fond et les panneaux d'abord, le portrait par-dessus : il occupe le haut du
    // panneau gauche, au-dessus de la zone où le nom et les statistiques sont écrits.
    draw(ctx, input);
    await drawPortrait(ctx, input.avatarUrl, 170, 160, 96, input.displayName);

    return canvas.toBuffer('image/png');
  } catch (error) {
    logger.error('RpgCard', 'Rendu de la carte de personnage en échec :', error);
    return null;
  }
}
