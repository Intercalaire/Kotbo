/**
 * Ou l'on en est dans le parcours de configuration, et ce qu'on y a repondu.
 *
 * Chaque etape ecrit en la validant : ce qui est fait est donc lisible du
 * serveur lui-meme, et c'est lui qui fait foi a la reprise. Ce qui est garde
 * ici, ce sont les reponses que rien ne permet de relire - la vocation choisie,
 * le niveau de moderation retenu - et l'ecran courant, pour qu'un
 * rafraichissement ne renvoie pas au debut.
 *
 * Dans le navigateur, par serveur. Le parcours se traverse une fois, en une
 * seule session le plus souvent ; lui donner une colonne en base ferait payer
 * une migration a une donnee qui ne survit pas a la semaine. Le prix est qu'un
 * changement d'appareil en cours de route recommence a l'etape suivant ce que
 * le serveur porte deja - ce qui est precisement le comportement voulu.
 */
import type { ModerationLevel, ServerKind, ThemeKey, WizardStep } from '../onboardingWizard';
import { WIZARD_STEPS } from '../onboardingWizard';

type WizardState = {
  step: WizardStep;
  kind: ServerKind | null;
  theme: ThemeKey | null;
  moderation: ModerationLevel | null;
  /** Etapes validees, pour ne pas redemander ce qui a deja ete ecrit. */
  done: WizardStep[];
};

const DEFAULT_STATE: WizardState = {
  step: 'welcome',
  kind: null,
  theme: null,
  moderation: null,
  done: [],
};

const storageKey = (guildId: string) => `kotbo-wizard-${guildId}`;

function readState(guildId: string): WizardState {
  try {
    const raw = localStorage.getItem(storageKey(guildId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      done: Array.isArray(parsed?.done) ? parsed.done : [],
      // Une etape inconnue - parcours renomme depuis - ramene au debut plutot
      // que de laisser la page sur un ecran qui n'existe plus.
      step: WIZARD_STEPS.includes(parsed?.step) ? parsed.step : 'welcome',
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(guildId: string | null, state: WizardState): void {
  if (!guildId) return;
  try {
    localStorage.setItem(storageKey(guildId), JSON.stringify(state));
  } catch {
    // Mode prive, quota plein : le parcours vaut pour la session en cours.
  }
}

const initialGuildId = typeof localStorage !== 'undefined' ? localStorage.getItem('kotbo_guild_id') : null;
let guildId = $state<string | null>(initialGuildId);
let state = $state<WizardState>(initialGuildId ? readState(initialGuildId) : { ...DEFAULT_STATE });

export const wizard = {
  get ready() { return guildId !== null; },
  get step() { return state.step; },
  get kind() { return state.kind; },
  get theme() { return state.theme; },
  get moderation() { return state.moderation; },

  get index() { return WIZARD_STEPS.indexOf(state.step); },
  get total() { return WIZARD_STEPS.length; },
  get isFirst() { return this.index <= 0; },

  isDone(step: WizardStep): boolean {
    return state.done.includes(step);
  },

  initialize(newGuildId: string): void {
    if (guildId === newGuildId) return;
    guildId = newGuildId;
    state = readState(newGuildId);
  },

  goto(step: WizardStep): void {
    state.step = step;
    writeState(guildId, state);
  },

  next(): void {
    const at = WIZARD_STEPS.indexOf(state.step);
    if (at < 0 || at >= WIZARD_STEPS.length - 1) return;
    state.step = WIZARD_STEPS[at + 1];
    writeState(guildId, state);
  },

  back(): void {
    const at = WIZARD_STEPS.indexOf(state.step);
    if (at <= 0) return;
    state.step = WIZARD_STEPS[at - 1];
    writeState(guildId, state);
  },

  /** Marque l'etape ecrite, puis passe a la suivante. */
  complete(step: WizardStep): void {
    if (!state.done.includes(step)) state.done = [...state.done, step];
    writeState(guildId, state);
    this.next();
  },

  answer(patch: Partial<Pick<WizardState, 'kind' | 'theme' | 'moderation'>>): void {
    Object.assign(state, patch);
    writeState(guildId, state);
  },

  /**
   * Reprend au premier ecran qui n'a pas encore ete valide.
   *
   * Appele quand le serveur porte deja des traces d'un passage precedent - une
   * structure posee, par exemple. Sans cela, quelqu'un qui revient se verrait
   * proposer de reposer des salons qui existent.
   */
  resumeAfter(step: WizardStep): void {
    if (!state.done.includes(step)) state.done = [...state.done, step];
    const at = WIZARD_STEPS.indexOf(step);
    const current = WIZARD_STEPS.indexOf(state.step);
    if (at >= 0 && at >= current && at < WIZARD_STEPS.length - 1) {
      state.step = WIZARD_STEPS[at + 1];
    }
    writeState(guildId, state);
  },
};
