/**
 * imageForensics.ts - Analyse d'image pour la modération.
 *
 * Deux capacités, toutes deux locales (aucun appel réseau, aucune image
 * transmise à un tiers) :
 *
 *  1. Empreinte perceptuelle (dHash). Le SHA-256 des octets casse dès qu'un
 *     pixel change ou que l'image est recompressée — ce que font justement les
 *     campagnes qui rediffusent une capture d'arnaque. Le dHash compare la
 *     structure de l'image et survit au recadrage léger, au rééchantillonnage
 *     et au changement de qualité JPEG.
 *
 *  2. Détection de code QR. Le phishing par QR de connexion Discord (faire
 *     scanner un code qui autorise la session de l'attaquant) est une campagne
 *     massive qu'aucun filtre de lien n'attrape, puisqu'il n'y a pas de lien.
 *     On ne décode pas le contenu : repérer la présence des motifs de
 *     repérage suffit à décider qu'un compte sans historique n'a rien à faire
 *     à poster ça.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { logger } from '../../utils/logger.js';

export type GrayscaleImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

/** Au-delà, l'image est réduite : la précision gagnée ne vaut pas le coût. */
const MAX_ANALYSIS_WIDTH = 512;

/**
 * Décode une image en niveaux de gris.
 * Retourne null si le format est illisible — un fichier corrompu ou exotique
 * ne doit pas faire échouer la modération du message.
 */
export async function toGrayscale(buffer: Buffer): Promise<GrayscaleImage | null> {
  try {
    const image = await loadImage(buffer);
    const scale = Math.min(1, MAX_ANALYSIS_WIDTH / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Luminance perçue (Rec. 601), suffisante et bien moins chère qu'une
      // conversion colorimétrique exacte.
      gray[p] = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
    }

    return { data: gray, width, height };
  } catch (err) {
    logger.debug('ImageForensics', `Décodage impossible: ${String(err)}`);
    return null;
  }
}

/** Rééchantillonne en niveaux de gris par moyenne de blocs (box filter). */
function resizeGray(image: GrayscaleImage, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));

      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1 && sy < image.height; sy++) {
        for (let sx = x0; sx < x1 && sx < image.width; sx++) {
          sum += image.data[sy * image.width + sx];
          count++;
        }
      }
      out[y * width + x] = count === 0 ? 0 : Math.round(sum / count);
    }
  }
  return out;
}

/**
 * Empreinte perceptuelle 64 bits (dHash), rendue en hexadécimal.
 *
 * Principe : réduire à 9×8, puis comparer chaque pixel à son voisin de droite.
 * Ce sont les *variations* qui sont encodées, pas les valeurs absolues, ce qui
 * rend l'empreinte insensible à la luminosité et au contraste global.
 */
export function perceptualHash(image: GrayscaleImage): string {
  const width = 9;
  const height = 8;
  const small = resizeGray(image, width, height);

  let hex = '';
  let bits = 0;
  let acc = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = small[y * width + x];
      const right = small[y * width + x + 1];
      acc = (acc << 1) | (left > right ? 1 : 0);
      bits++;
      if (bits === 4) {
        hex += acc.toString(16);
        bits = 0;
        acc = 0;
      }
    }
  }

  return hex;
}

/** Nombre de bits différents entre deux empreintes hexadécimales. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;

  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (Number.isNaN(diff)) return Number.MAX_SAFE_INTEGER;
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/**
 * Distance maximale entre deux empreintes considérées comme la même image.
 * 8 bits sur 64 tolère la recompression et un léger recadrage sans confondre
 * deux images sans rapport.
 */
export const PHASH_MATCH_THRESHOLD = 8;

export function isPerceptualMatch(a: string, b: string, threshold = PHASH_MATCH_THRESHOLD): boolean {
  return hammingDistance(a, b) <= threshold;
}

// ─── Détection de code QR ───────────────────────────────────────────────────────

/**
 * Seuil global d'Otsu : sépare l'image en deux classes de luminance.
 *
 * La valeur retournée est la *dernière* de la classe sombre : la binarisation
 * doit donc tester `valeur <= seuil`. Sur une image purement bimodale (0/255),
 * comme un QR de synthèse, Otsu retourne 0 et un test strict exclurait tous les
 * pixels noirs.
 */
function otsuThreshold(data: Uint8Array): number {
  const histogram = new Array(256).fill(0);
  for (const value of data) histogram[value]++;

  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * Un motif de repérage QR se projette, sur toute ligne qui le traverse, en une
 * suite sombre-clair-sombre-clair-sombre de proportions 1:1:3:1:1.
 */
function matchesFinderRatio(counts: number[]): boolean {
  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (total < 7) return false;

  const moduleSize = total / 7;
  // Tolérance large : perspective, anticrénelage et compression déforment les
  // proportions. Un motif trop strict ne détecterait que les QR parfaits.
  const tolerance = moduleSize * 0.6;

  return (
    Math.abs(moduleSize - counts[0]) < tolerance &&
    Math.abs(moduleSize - counts[1]) < tolerance &&
    Math.abs(moduleSize * 3 - counts[2]) < tolerance * 3 &&
    Math.abs(moduleSize - counts[3]) < tolerance &&
    Math.abs(moduleSize - counts[4]) < tolerance
  );
}

export type QrDetection = {
  detected: boolean;
  /** Nombre de motifs de repérage distincts trouvés (un QR complet en a 3). */
  patterns: number;
};

/**
 * Détecte la présence probable d'un code QR.
 *
 * On balaie les lignes à la recherche de la signature 1:1:3:1:1, puis on
 * regroupe les candidats proches : un vrai motif produit des détections sur
 * plusieurs lignes consécutives, là où le bruit en produit une isolée.
 *
 * On exige deux motifs distincts plutôt que trois : un QR partiellement
 * recadré ou incrusté dans un visuel en perd souvent un.
 */
export function detectQrCode(image: GrayscaleImage): QrDetection {
  const { data, width, height } = image;
  if (width < 40 || height < 40) return { detected: false, patterns: 0 };

  const threshold = otsuThreshold(data);
  const candidates: { x: number; y: number; size: number }[] = [];

  // Une ligne sur deux : un motif de repérage fait au moins quelques pixels de
  // haut, il ne peut pas passer entre les mailles.
  for (let y = 0; y < height; y += 2) {
    const counts = [0, 0, 0, 0, 0];
    let state = 0;
    const rowStart = y * width;

    for (let x = 0; x < width; x++) {
      const isDark = data[rowStart + x] <= threshold;

      if (isDark === (state % 2 === 0)) {
        // Toujours dans la même bande.
        counts[state]++;
        continue;
      }

      if (state === 4) {
        if (matchesFinderRatio(counts)) {
          const total = counts.reduce((s, c) => s + c, 0);
          candidates.push({ x: x - total / 2, y, size: total });
        }
        // Glisse la fenêtre de deux bandes pour chercher un motif chevauchant.
        counts[0] = counts[2];
        counts[1] = counts[3];
        counts[2] = counts[4];
        counts[3] = 1;
        counts[4] = 0;
        state = 3;
        continue;
      }

      state++;
      counts[state] = 1;
    }

    if (state === 4 && matchesFinderRatio(counts)) {
      const total = counts.reduce((s, c) => s + c, 0);
      candidates.push({ x: width - total / 2, y, size: total });
    }
  }

  if (candidates.length === 0) return { detected: false, patterns: 0 };

  // Regroupe les candidats en motifs : même abscisse à un module près, lignes
  // proches. Un motif isolé sur une seule ligne est du bruit.
  type Cluster = { x: number; y: number; size: number; hits: number };
  const clusters: Cluster[] = [];

  for (const candidate of candidates) {
    const cluster = clusters.find(
      (c) =>
        Math.abs(c.x - candidate.x) < candidate.size / 2 &&
        Math.abs(c.y - candidate.y) < candidate.size * 1.5 &&
        Math.abs(c.size - candidate.size) < candidate.size / 2
    );

    if (cluster) {
      cluster.x = (cluster.x * cluster.hits + candidate.x) / (cluster.hits + 1);
      cluster.y = candidate.y;
      cluster.hits++;
    } else {
      clusters.push({ ...candidate, hits: 1 });
    }
  }

  const solid = clusters.filter((c) => c.hits >= 3);
  return { detected: solid.length >= 2, patterns: solid.length };
}

export type ImageAnalysis = {
  phash: string;
  qr: QrDetection;
  width: number;
  height: number;
};

/** Analyse complète d'un tampon d'image. null si le format est illisible. */
export async function analyzeImage(buffer: Buffer): Promise<ImageAnalysis | null> {
  const gray = await toGrayscale(buffer);
  if (!gray) return null;

  return {
    phash: perceptualHash(gray),
    qr: detectQrCode(gray),
    width: gray.width,
    height: gray.height,
  };
}
