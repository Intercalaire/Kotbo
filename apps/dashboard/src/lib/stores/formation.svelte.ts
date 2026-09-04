/**
 * Ce que le premier utilisateur a deja manipule, par serveur.
 *
 * Les reglages se lisent de la configuration : ils n'ont pas besoin d'etre
 * memorises ici. Les gestes, eux, ne laissent aucune trace exploitable - on ne
 * sait pas depuis la base si quelqu'un a ouvert son salon de logs et compris ce
 * qu'il y voyait. Ils se declarent, et cette declaration se garde.
 *
 * Elle se garde dans le navigateur, et c'est volontaire. Une formation est
 * personnelle : deux administrateurs du meme serveur se forment chacun de son
 * cote, et cocher pour l'un effacerait la piste de l'autre. Le prix est qu'elle
 * ne suit pas d'un appareil a l'autre - acceptable pour une case qui ne se
 * coche qu'une fois, et qui se recoche en dix secondes.
 *
 * La cle porte l'identifiant du serveur : la formation d'un serveur ne dit rien
 * du suivant.
 */
import { formationTracks, totalGestures } from '../formationTracks';
import type { SetupGroup } from './setupJourney.svelte';

type FormationState = {
  doneGestures: string[];
  /** L'ecran de deverrouillage ne se montre qu'une fois par serveur. */
  unlockSeen: boolean;
};

const DEFAULT_STATE: FormationState = { doneGestures: [], unlockSeen: false };

const storageKey = (guildId: string) => `formation-${guildId}`;

function readState(guildId: string): FormationState {
  try {
    const raw = localStorage.getItem(storageKey(guildId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      doneGestures: Array.isArray(parsed?.doneGestures) ? parsed.doneGestures : [],
    };
  } catch {
    // Stockage indisponible ou contenu illisible : la formation repart a zero
    // plutot que de faire echouer la page.
    return { ...DEFAULT_STATE };
  }
}

function writeState(guildId: string | null, state: FormationState): void {
  if (!guildId) return;
  try {
    localStorage.setItem(storageKey(guildId), JSON.stringify(state));
  } catch {
    // Mode prive, quota plein : la formation vaut pour la session en cours.
  }
}

let guildId = $state<string | null>(null);
let state = $state<FormationState>({ ...DEFAULT_STATE });

export const formationStore = {
  get initialized() { return guildId !== null; },
  get doneGestures() { return state.doneGestures; },
  get doneCount() { return state.doneGestures.length; },
  get totalCount() { return totalGestures; },
  get allDone() { return state.doneGestures.length >= totalGestures; },
  get unlockSeen() { return state.unlockSeen; },

  isDone(gestureId: string): boolean {
    return state.doneGestures.includes(gestureId);
  },

  /** Avancement des gestes d'une categorie - le reste vient du parcours. */
  doneIn(group: SetupGroup): { done: number; total: number } {
    const track = formationTracks.find((candidate) => candidate.group === group);
    if (!track) return { done: 0, total: 0 };
    return {
      done: track.gestures.filter((gesture) => state.doneGestures.includes(gesture.id)).length,
      total: track.gestures.length,
    };
  },

  initialize(newGuildId: string): void {
    if (guildId === newGuildId) return;
    guildId = newGuildId;
    state = readState(newGuildId);
  },

  toggle(gestureId: string): void {
    // Decochable : quelqu'un qui coche par erreur, ou qui reprend la formation
    // apres avoir tout oublie, doit pouvoir revenir en arriere.
    state.doneGestures = state.doneGestures.includes(gestureId)
      ? state.doneGestures.filter((id) => id !== gestureId)
      : [...state.doneGestures, gestureId];
    writeState(guildId, state);
  },

  markUnlockSeen(): void {
    if (state.unlockSeen) return;
    state.unlockSeen = true;
    writeState(guildId, state);
  },
};
