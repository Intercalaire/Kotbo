/**
 * Apparence et textes des giveaways.
 *
 * Tout ce qu'un concours affiche était écrit en dur dans `giveawayService` :
 * couleurs Discord, titre « GIVEAWAY : ... », libellé du bouton, phrases
 * d'annonce. Un serveur ne pouvait donc ni traduire ses concours, ni les
 * accorder à son identité visuelle. Ce module porte le style effectif d'un
 * concours et le rendu de ses gabarits.
 *
 * Le style effectif est la fusion, dans cet ordre : valeurs d'usine, réglages
 * du serveur, surcharges du concours. Une surcharge absente laisse donc passer
 * le réglage du serveur, et un serveur sans réglage retrouve exactement le
 * rendu historique.
 */
import { ButtonStyle } from 'discord.js';
import type { BotLocale } from '../../utils/i18n.js';

export type GiveawayButtonStyleName = 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';

/**
 * Alias d'objet et non interface : ces réglages partent dans une colonne JSON,
 * et seul un alias est vu par TypeScript comme indexable par chaîne, donc
 * acceptable là où Prisma attend du JSON.
 */
export type GiveawayAppearance = {
  embedColorActive: string;
  embedColorPending: string;
  embedColorEnded: string;
  embedColorValidated: string;
  titleTemplate: string;
  descriptionTemplate: string;
  footerTemplate: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  joinButtonLabel: string;
  joinButtonEmoji: string;
  joinButtonStyle: GiveawayButtonStyleName;
  announceWinnersTemplate: string;
  announceNoWinnerTemplate: string;
  joinReplyTemplate: string;
  leaveReplyTemplate: string;
  deniedBlockedTemplate: string;
  deniedRequiredTemplate: string;
  deniedAccountAgeTemplate: string;
  deniedMemberAgeTemplate: string;
  deniedLevelTemplate: string;
  deniedLinkedTemplate: string;
};

/**
 * Textes d'usine, par langue du serveur.
 *
 * Ils vivent ici et non dans les messages traduits : le compilateur de messages
 * lit toute accolade comme un paramètre, et les gabarits en sont faits. Une
 * colonne vide en base vaut « ce texte-là », si bien qu'un serveur qui change de
 * langue voit ses concours suivre tant qu'il n'a rien personnalisé.
 */
export const DEFAULT_APPEARANCE_BY_LOCALE: Record<BotLocale, GiveawayAppearance> = {
  fr: {
    embedColorActive: '#5865F2',
    embedColorPending: '#FAA81A',
    embedColorEnded: '#ED4245',
    embedColorValidated: '#57F287',
    titleTemplate: 'GIVEAWAY : {prize}',
    descriptionTemplate: '{description}Cliquez sur le bouton ci-dessous pour participer !\n{bonus}{bonusRoles}\n**Fin :** {endsRelative} ({endsAt})\n**Nombre de gagnants :** {winnerCount}\n**Participants :** {participants}',
    footerTemplate: 'ID : {id}',
    thumbnailUrl: null,
    imageUrl: null,
    joinButtonLabel: 'Rejoindre',
    joinButtonEmoji: '',
    joinButtonStyle: 'PRIMARY',
    announceWinnersTemplate: 'Félicitations à {winners} qui gagne(nt) **{prize}** !',
    announceNoWinnerTemplate: 'Personne n\'a participé au giveaway pour **{prize}**, il n\'y a donc pas de gagnant.',
    joinReplyTemplate: 'Inscription validée ! Bonne chance !',
    leaveReplyTemplate: 'Vous vous êtes retiré du giveaway.',
    deniedBlockedTemplate: 'L\'un de tes rôles t\'exclut des giveaways de ce serveur.',
    deniedRequiredTemplate: 'Tu n\'as pas le rôle requis pour participer aux giveaways de ce serveur.',
    deniedAccountAgeTemplate: 'Ton compte Discord doit avoir au moins {minAccountAgeDays} jour(s) pour participer.',
    deniedMemberAgeTemplate: 'Tu dois être sur le serveur depuis au moins {minMemberAgeDays} jour(s) pour participer.',
    deniedLevelTemplate: 'Tu dois être niveau {minLevel} au minimum pour participer.',
    deniedLinkedTemplate: 'Un autre de tes comptes participe déjà à ce concours.',
  },
  en: {
    embedColorActive: '#5865F2',
    embedColorPending: '#FAA81A',
    embedColorEnded: '#ED4245',
    embedColorValidated: '#57F287',
    titleTemplate: 'GIVEAWAY: {prize}',
    descriptionTemplate: '{description}Click the button below to enter!\n{bonus}{bonusRoles}\n**Ends:** {endsRelative} ({endsAt})\n**Winners:** {winnerCount}\n**Entrants:** {participants}',
    footerTemplate: 'ID: {id}',
    thumbnailUrl: null,
    imageUrl: null,
    joinButtonLabel: 'Enter',
    joinButtonEmoji: '',
    joinButtonStyle: 'PRIMARY',
    announceWinnersTemplate: 'Congratulations {winners}, you won **{prize}**!',
    announceNoWinnerTemplate: 'Nobody entered the giveaway for **{prize}**, so there is no winner.',
    joinReplyTemplate: 'You are in! Good luck!',
    leaveReplyTemplate: 'You have withdrawn from the giveaway.',
    deniedBlockedTemplate: 'One of your roles keeps you out of this server\'s giveaways.',
    deniedRequiredTemplate: 'You do not have the role required to enter this server\'s giveaways.',
    deniedAccountAgeTemplate: 'Your Discord account must be at least {minAccountAgeDays} day(s) old to enter.',
    deniedMemberAgeTemplate: 'You must have been on the server for at least {minMemberAgeDays} day(s) to enter.',
    deniedLevelTemplate: 'You must be level {minLevel} or above to enter.',
    deniedLinkedTemplate: 'Another of your accounts has already entered this giveaway.',
  },
};

/** Textes et couleurs d'usine pour une langue donnée. */
export function defaultAppearance(locale: BotLocale): GiveawayAppearance {
  return DEFAULT_APPEARANCE_BY_LOCALE[locale] ?? DEFAULT_APPEARANCE_BY_LOCALE.en;
}

/**
 * Gabarits dont la colonne accepte le vide, qui vaut alors « texte d'usine ».
 *
 * Les couleurs et le style du bouton n'en sont pas : leurs colonnes refusent le
 * vide, et les effacer ferait échouer l'enregistrement.
 */
export const RESETTABLE_TEXT_KEYS = [
  'titleTemplate',
  'descriptionTemplate',
  'footerTemplate',
  'joinButtonLabel',
  'joinButtonEmoji',
  'announceWinnersTemplate',
  'announceNoWinnerTemplate',
  'joinReplyTemplate',
  'leaveReplyTemplate',
  'deniedBlockedTemplate',
  'deniedRequiredTemplate',
  'deniedAccountAgeTemplate',
  'deniedMemberAgeTemplate',
  'deniedLevelTemplate',
  'deniedLinkedTemplate',
] as const satisfies readonly (keyof GiveawayAppearance)[];

const COLOR_KEYS = [
  'embedColorActive',
  'embedColorPending',
  'embedColorEnded',
  'embedColorValidated',
] as const satisfies readonly (keyof GiveawayAppearance)[];

const URL_KEYS = ['thumbnailUrl', 'imageUrl'] as const satisfies readonly (keyof GiveawayAppearance)[];

/**
 * Longueur maximale acceptée pour chaque gabarit texte. Un texte vide y est
 * refusé : plutôt que publier un embed sans titre, on garde le réglage en place.
 */
const TEXT_LIMITS: Partial<Record<keyof GiveawayAppearance, number>> = {
  titleTemplate: 200,
  descriptionTemplate: 3_000,
  footerTemplate: 200,
  joinButtonLabel: 80,
  announceWinnersTemplate: 1_500,
  announceNoWinnerTemplate: 1_500,
  joinReplyTemplate: 1_500,
  leaveReplyTemplate: 1_500,
  deniedBlockedTemplate: 1_500,
  deniedRequiredTemplate: 1_500,
  deniedAccountAgeTemplate: 1_500,
  deniedMemberAgeTemplate: 1_500,
  deniedLevelTemplate: 1_500,
  deniedLinkedTemplate: 1_500,
};

/**
 * Textes qu'un champ vidé doit vraiment effacer. Un bouton sans emoji est un
 * choix de présentation légitime, alors qu'un bouton sans libellé n'existe pas.
 */
const CLEARABLE_TEXT_LIMITS: Partial<Record<keyof GiveawayAppearance, number>> = {
  joinButtonEmoji: 64,
};

const BUTTON_STYLES: Record<GiveawayButtonStyleName, ButtonStyle> = {
  PRIMARY: ButtonStyle.Primary,
  SECONDARY: ButtonStyle.Secondary,
  SUCCESS: ButtonStyle.Success,
  DANGER: ButtonStyle.Danger,
};

export function resolveButtonStyle(name: string | null | undefined): ButtonStyle {
  return BUTTON_STYLES[(name ?? '') as GiveawayButtonStyleName] ?? ButtonStyle.Primary;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

/**
 * Discord refuse toute image dont l'adresse n'est pas en HTTPS, et une URL
 * invalide fait échouer l'envoi complet de l'embed : on préfère ignorer le
 * réglage plutôt que casser la publication du concours.
 */
function normalizeImageUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) return undefined;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return undefined;
  return trimmed;
}

/**
 * Ne garde d'un objet libre que les réglages d'apparence exploitables.
 *
 * Sert aussi bien aux surcharges reçues du dashboard qu'à celles relues en
 * base : une valeur devenue invalide entre-temps disparaît au lieu de faire
 * échouer le rendu du concours.
 */
export function normalizeAppearancePatch(value: unknown): Partial<GiveawayAppearance> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const patch: Partial<GiveawayAppearance> = {};

  for (const key of COLOR_KEYS) {
    const color = normalizeColor(source[key]);
    if (color) patch[key] = color;
  }

  for (const key of URL_KEYS) {
    if (!(key in source)) continue;
    const url = normalizeImageUrl(source[key]);
    if (url !== undefined) patch[key] = url;
  }

  for (const [key, limit] of Object.entries(TEXT_LIMITS) as [keyof GiveawayAppearance, number][]) {
    const text = normalizeText(source[key], limit);
    if (text !== undefined) (patch as Record<string, string>)[key] = text;
  }

  for (const [key, limit] of Object.entries(CLEARABLE_TEXT_LIMITS) as [keyof GiveawayAppearance, number][]) {
    if (!(key in source)) continue;
    const raw = source[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > limit) continue;
    (patch as Record<string, string>)[key] = trimmed;
  }

  if (typeof source.joinButtonStyle === 'string') {
    const style = source.joinButtonStyle.toUpperCase() as GiveawayButtonStyleName;
    if (style in BUTTON_STYLES) patch.joinButtonStyle = style;
  }

  return patch;
}

/**
 * Empile les couches d'apparence, de la plus générale à la plus précise.
 *
 * Seules les clefs d'apparence traversent : une couche peut être la
 * configuration complète du serveur, qui porte aussi ses rôles et ses seuils,
 * et rien de tout cela n'a sa place dans le rendu d'un embed.
 */
export function mergeAppearance(
  locale: BotLocale,
  ...layers: (Partial<GiveawayAppearance> | null | undefined)[]
): GiveawayAppearance {
  const merged: GiveawayAppearance = { ...defaultAppearance(locale) };

  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(merged) as (keyof GiveawayAppearance)[]) {
      const value = layer[key];
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * Applique la surcharge d'un concours sur l'apparence déjà résolue du serveur.
 *
 * Les réglages du serveur portent tous les champs, langue comprise : on part
 * d'eux plutôt que des textes d'usine, sinon une surcharge de couleur ferait
 * retomber les gabarits dans la langue de repli.
 */
export function applyAppearanceOverrides(
  base: GiveawayAppearance,
  overrides: unknown,
): GiveawayAppearance {
  const patch = normalizeAppearancePatch(overrides);
  const merged: GiveawayAppearance = { ...base };

  for (const key of Object.keys(merged) as (keyof GiveawayAppearance)[]) {
    const value = patch[key];
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }

  return merged;
}

export interface GiveawayTextContext {
  id: string;
  prize: string;
  winnerCount: number;
  participantCount: number;
  endsAt: Date;
  /** Mentions déjà formatées des gagnants, vide tant qu'aucun tirage n'a eu lieu. */
  winners?: string;
  /** Description du concours, saut de ligne compris, vide quand il n'y en a pas. */
  descriptionBlock?: string;
  /** Bloc des récompenses bonus, déjà mis en forme, vide quand il n'y en a pas. */
  bonusBlock?: string;
  /** Bloc des rôles avantagés, déjà mis en forme, vide quand aucun ne l'est. */
  bonusRolesBlock?: string;
  /** Mention de l'auteur du concours, vide pour les concours d'avant la colonne. */
  host?: string;
  guildName?: string;
  minAccountAgeDays?: number;
  minMemberAgeDays?: number;
  minLevel?: number;
}

/**
 * Remplace les placeholders d'un gabarit de giveaway.
 *
 * Table dédiée plutôt que `utils/placeholders` : les valeurs utiles ici
 * (lot, gagnants, fin) n'existent pas ailleurs, et ce rendu doit fonctionner
 * sans objet `Guild` sous la main, par exemple depuis le cron de clôture.
 */
export function renderGiveawayText(template: string, ctx: GiveawayTextContext): string {
  const endsSec = Math.floor(ctx.endsAt.getTime() / 1000);
  const values: Record<string, string> = {
    '{id}': ctx.id,
    '{prize}': ctx.prize,
    '{lot}': ctx.prize,
    '{winnerCount}': String(ctx.winnerCount),
    '{gagnants}': String(ctx.winnerCount),
    '{participants}': String(ctx.participantCount),
    '{winners}': ctx.winners ?? '',
    '{description}': ctx.descriptionBlock ?? '',
    '{bonus}': ctx.bonusBlock ?? '',
    '{bonusRoles}': ctx.bonusRolesBlock ?? '',
    '{host}': ctx.host ?? '',
    '{organisateur}': ctx.host ?? '',
    '{server}': ctx.guildName ?? '',
    '{serveur}': ctx.guildName ?? '',
    '{endsAt}': `<t:${endsSec}:f>`,
    '{endsRelative}': `<t:${endsSec}:R>`,
    '{minAccountAgeDays}': String(ctx.minAccountAgeDays ?? 0),
    '{minMemberAgeDays}': String(ctx.minMemberAgeDays ?? 0),
    '{minLevel}': String(ctx.minLevel ?? 0),
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(values)) {
    if (result.includes(placeholder)) result = result.replaceAll(placeholder, value);
  }
  return result;
}
