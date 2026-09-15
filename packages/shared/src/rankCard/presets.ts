import type { RankCardBackgroundPreset } from './types.js';

/**
 * Les fonds sont décrits comme des recettes de peinture (dégradés + halos)
 * plutôt que comme des images : rien à héberger, rien à modérer, et le rendu
 * reste net quelle que soit la taille de la carte.
 */
export const RANK_CARD_BACKGROUNDS: RankCardBackgroundPreset[] = [
  {
    id: 'default',
    label: { fr: 'Kotbo', en: 'Kotbo' },
    gradient: [
      { offset: 0, color: '#0a0d13' },
      { offset: 0.5, color: '#0f1219' },
      { offset: 1, color: '#0a0d13' },
    ],
    glows: [
      { x: 0.75, y: 0.4, radius: 300, color: 'rgba(88, 101, 242, 0.1)' },
      { x: 0.16, y: 0.5, radius: 200, color: 'rgba(87, 242, 135, 0.06)' },
    ],
    accentBar: [
      { offset: 0, color: '#5865f2' },
      { offset: 0.5, color: '#7b68ee' },
      { offset: 1, color: '#57f287' },
    ],
    avatarBackdrop: '#0a0d13',
  },
  {
    id: 'midnight',
    label: { fr: 'Minuit', en: 'Midnight' },
    gradient: [
      { offset: 0, color: '#05070f' },
      { offset: 1, color: '#101a33' },
    ],
    glows: [
      { x: 0.8, y: 0.2, radius: 340, color: 'rgba(59, 130, 246, 0.16)' },
      { x: 0.1, y: 0.9, radius: 260, color: 'rgba(129, 140, 248, 0.1)' },
    ],
    accentBar: [
      { offset: 0, color: '#1d4ed8' },
      { offset: 1, color: '#60a5fa' },
    ],
    avatarBackdrop: '#05070f',
  },
  {
    id: 'sunset',
    label: { fr: 'Coucher de soleil', en: 'Sunset' },
    gradient: [
      { offset: 0, color: '#1b0b12' },
      { offset: 1, color: '#3a1220' },
    ],
    glows: [
      { x: 0.78, y: 0.75, radius: 320, color: 'rgba(249, 115, 22, 0.2)' },
      { x: 0.2, y: 0.2, radius: 240, color: 'rgba(236, 72, 153, 0.14)' },
    ],
    accentBar: [
      { offset: 0, color: '#f97316' },
      { offset: 1, color: '#ec4899' },
    ],
    avatarBackdrop: '#1b0b12',
  },
  {
    id: 'forest',
    label: { fr: 'Forêt', en: 'Forest' },
    gradient: [
      { offset: 0, color: '#06120c' },
      { offset: 1, color: '#0d2418' },
    ],
    glows: [
      { x: 0.72, y: 0.35, radius: 300, color: 'rgba(34, 197, 94, 0.16)' },
      { x: 0.15, y: 0.8, radius: 220, color: 'rgba(163, 230, 53, 0.08)' },
    ],
    accentBar: [
      { offset: 0, color: '#16a34a' },
      { offset: 1, color: '#a3e635' },
    ],
    avatarBackdrop: '#06120c',
  },
  {
    id: 'crimson',
    label: { fr: 'Cramoisi', en: 'Crimson' },
    gradient: [
      { offset: 0, color: '#140506' },
      { offset: 1, color: '#2e0a10' },
    ],
    glows: [
      { x: 0.75, y: 0.5, radius: 320, color: 'rgba(239, 68, 68, 0.18)' },
      { x: 0.12, y: 0.25, radius: 230, color: 'rgba(251, 146, 60, 0.08)' },
    ],
    accentBar: [
      { offset: 0, color: '#b91c1c' },
      { offset: 1, color: '#f87171' },
    ],
    avatarBackdrop: '#140506',
  },
  {
    id: 'aurora',
    label: { fr: 'Aurore', en: 'Aurora' },
    gradient: [
      { offset: 0, color: '#050b14' },
      { offset: 0.5, color: '#0a1a24' },
      { offset: 1, color: '#0b1020' },
    ],
    glows: [
      { x: 0.3, y: 0.1, radius: 300, color: 'rgba(45, 212, 191, 0.18)' },
      { x: 0.85, y: 0.85, radius: 300, color: 'rgba(167, 139, 250, 0.16)' },
    ],
    accentBar: [
      { offset: 0, color: '#2dd4bf' },
      { offset: 1, color: '#a78bfa' },
    ],
    avatarBackdrop: '#050b14',
  },
  {
    id: 'gold',
    label: { fr: 'Or', en: 'Gold' },
    gradient: [
      { offset: 0, color: '#12100a' },
      { offset: 1, color: '#241d0c' },
    ],
    glows: [
      { x: 0.76, y: 0.45, radius: 320, color: 'rgba(234, 179, 8, 0.18)' },
      { x: 0.14, y: 0.7, radius: 220, color: 'rgba(253, 224, 71, 0.08)' },
    ],
    accentBar: [
      { offset: 0, color: '#b45309' },
      { offset: 1, color: '#fde047' },
    ],
    avatarBackdrop: '#12100a',
  },
  {
    id: 'mono',
    label: { fr: 'Monochrome', en: 'Monochrome' },
    gradient: [
      { offset: 0, color: '#0b0b0c' },
      { offset: 1, color: '#1a1a1d' },
    ],
    glows: [
      { x: 0.7, y: 0.3, radius: 300, color: 'rgba(255, 255, 255, 0.06)' },
    ],
    accentBar: [
      { offset: 0, color: '#52525b' },
      { offset: 1, color: '#e4e4e7' },
    ],
    avatarBackdrop: '#0b0b0c',
  },
  {
    id: 'ocean',
    label: { fr: 'Océan', en: 'Ocean' },
    gradient: [
      { offset: 0, color: '#04121a' },
      { offset: 1, color: '#07293a' },
    ],
    glows: [
      { x: 0.8, y: 0.6, radius: 320, color: 'rgba(14, 165, 233, 0.18)' },
      { x: 0.18, y: 0.2, radius: 240, color: 'rgba(34, 211, 238, 0.1)' },
    ],
    accentBar: [
      { offset: 0, color: '#0284c7' },
      { offset: 1, color: '#22d3ee' },
    ],
    avatarBackdrop: '#04121a',
  },
  {
    id: 'candy',
    label: { fr: 'Bonbon', en: 'Candy' },
    gradient: [
      { offset: 0, color: '#160b1f' },
      { offset: 1, color: '#2a0f33' },
    ],
    glows: [
      { x: 0.75, y: 0.3, radius: 320, color: 'rgba(217, 70, 239, 0.18)' },
      { x: 0.2, y: 0.8, radius: 250, color: 'rgba(56, 189, 248, 0.12)' },
    ],
    accentBar: [
      { offset: 0, color: '#d946ef' },
      { offset: 1, color: '#38bdf8' },
    ],
    avatarBackdrop: '#160b1f',
  },
  {
    id: 'prism',
    label: { fr: 'Prisme', en: 'Prism' },
    gradient: [
      { offset: 0, color: '#0b0a18' },
      { offset: 0.5, color: '#120d22' },
      { offset: 1, color: '#08121c' },
    ],
    glows: [
      { x: 0.2, y: 0.15, radius: 260, color: 'rgba(244, 114, 182, 0.16)' },
      { x: 0.55, y: 0.9, radius: 280, color: 'rgba(250, 204, 21, 0.1)' },
      { x: 0.9, y: 0.25, radius: 300, color: 'rgba(34, 211, 238, 0.16)' },
    ],
    accentBar: [
      { offset: 0, color: '#f472b6' },
      { offset: 0.35, color: '#facc15' },
      { offset: 0.7, color: '#34d399' },
      { offset: 1, color: '#22d3ee' },
    ],
    avatarBackdrop: '#0b0a18',
    unlockedBy: 'supporter_1',
  },
  {
    id: 'royal',
    label: { fr: 'Royal', en: 'Royal' },
    gradient: [
      { offset: 0, color: '#12071f' },
      { offset: 1, color: '#2a1140' },
    ],
    glows: [
      { x: 0.78, y: 0.35, radius: 320, color: 'rgba(168, 85, 247, 0.2)' },
      { x: 0.15, y: 0.85, radius: 240, color: 'rgba(251, 191, 36, 0.12)' },
    ],
    accentBar: [
      { offset: 0, color: '#a855f7' },
      { offset: 1, color: '#fbbf24' },
    ],
    avatarBackdrop: '#12071f',
    unlockedBy: 'supporter_12',
  },
  {
    id: 'staff',
    label: { fr: 'Kotbo Staff', en: 'Kotbo Staff' },
    gradient: [
      { offset: 0, color: '#070913' },
      { offset: 0.6, color: '#0e1230' },
      { offset: 1, color: '#15112a' },
    ],
    glows: [
      { x: 0.72, y: 0.3, radius: 340, color: 'rgba(88, 101, 242, 0.24)' },
      { x: 0.12, y: 0.2, radius: 220, color: 'rgba(250, 204, 21, 0.12)' },
    ],
    accentBar: [
      { offset: 0, color: '#facc15' },
      { offset: 0.5, color: '#5865f2' },
      { offset: 1, color: '#facc15' },
    ],
    avatarBackdrop: '#070913',
    unlockedBy: 'kotbo_staff',
  },
  {
    id: 'summit',
    label: { fr: 'Sommet', en: 'Summit' },
    gradient: [
      { offset: 0, color: '#08131c' },
      { offset: 1, color: '#16283a' },
    ],
    glows: [
      { x: 0.8, y: 0.2, radius: 320, color: 'rgba(224, 242, 254, 0.14)' },
      { x: 0.2, y: 0.9, radius: 260, color: 'rgba(125, 211, 252, 0.12)' },
    ],
    accentBar: [
      { offset: 0, color: '#7dd3fc' },
      { offset: 1, color: '#f8fafc' },
    ],
    avatarBackdrop: '#08131c',
    unlockedBy: 'level_100',
  },
  {
    id: 'champion',
    label: { fr: 'Champion', en: 'Champion' },
    gradient: [
      { offset: 0, color: '#170a04' },
      { offset: 1, color: '#2e1606' },
    ],
    glows: [
      { x: 0.76, y: 0.4, radius: 330, color: 'rgba(245, 158, 11, 0.22)' },
      { x: 0.14, y: 0.8, radius: 230, color: 'rgba(239, 68, 68, 0.12)' },
    ],
    accentBar: [
      { offset: 0, color: '#ef4444' },
      { offset: 0.5, color: '#f59e0b' },
      { offset: 1, color: '#fde68a' },
    ],
    avatarBackdrop: '#170a04',
    unlockedBy: 'first_place',
  },
];

export const DEFAULT_RANK_CARD_BACKGROUND_ID = 'default';

export function getRankCardBackground(id: string | null | undefined): RankCardBackgroundPreset {
  return (
    RANK_CARD_BACKGROUNDS.find((preset) => preset.id === id)
    ?? RANK_CARD_BACKGROUNDS[0]
  );
}
