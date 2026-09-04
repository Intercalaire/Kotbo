/**
 * Le parcours de mise en place, partage entre la page et la coquille du tunnel.
 *
 * `Setup` affiche les etapes ; la barre du tunnel, elle, a besoin de la meme
 * chose pour savoir quoi proposer - tant que les points essentiels manquent,
 * l'activation ne se met pas en avant, elle attend. Deux appels separes
 * donneraient deux verites au meme moment sur le meme ecran : la page annoncant
 * « tout est prêt » pendant que la barre en-dessous continue de temporiser.
 *
 * Le parcours est recalcule cote serveur a partir de la configuration reelle :
 * ce cache-ci n'est qu'une lecture partagee, jamais une source. `load()` le
 * rafraichit apres chaque changement qui pourrait cocher une etape.
 */
import { fetchSetupJourney } from '../api';
import { authStore } from './auth.svelte';

export type SetupGroup = 'fondations' | 'moderation' | 'accueil' | 'engagement';

export type SetupStep = {
  key: string;
  group: SetupGroup;
  label: string;
  why: string;
  done: boolean;
  /** Vrai quand le serveur fonctionne mal sans ce point, pas quand il irait mieux avec. */
  essential: boolean;
  href: string;
  detail?: string;
};

export type SetupProgress = {
  done: number;
  total: number;
  essentialDone: number;
  essentialTotal: number;
  /** Les points essentiels sont couverts : le tunnel peut conclure. */
  ready: boolean;
};

const EMPTY_PROGRESS: SetupProgress = {
  done: 0,
  total: 0,
  essentialDone: 0,
  essentialTotal: 0,
  ready: false,
};

let steps = $state<SetupStep[]>([]);
let progress = $state<SetupProgress>({ ...EMPTY_PROGRESS });
let loading = $state(false);
let loaded = $state(false);
/** Le parcours appartient a un serveur : celui pour lequel il a ete calcule. */
let loadedGuildId: string | null = null;

export const setupJourney = {
  get steps() { return steps; },
  get progress() { return progress; },
  get loading() { return loading; },
  get loaded() { return loaded; },

  get remaining() { return steps.filter((step) => !step.done); },
  /** Ce qui manque et qui compte vraiment - la file d'attente du tunnel. */
  get remainingEssentials() { return steps.filter((step) => !step.done && step.essential); },

  get percent() {
    return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  },

  doneIn(group: SetupGroup) {
    const inGroup = steps.filter((step) => step.group === group);
    return { done: inGroup.filter((step) => step.done).length, total: inGroup.length };
  },

  async load(guildId = authStore.selectedGuildId): Promise<void> {
    if (!guildId) return;
    loading = true;
    try {
      const data = await fetchSetupJourney(guildId);
      steps = data?.steps ?? [];
      progress = { ...EMPTY_PROGRESS, ...(data?.progress ?? {}) };
      loadedGuildId = guildId;
      loaded = true;
    } finally {
      loading = false;
    }
  },

  /** Charge une fois, sans reprendre le calcul a chaque montage d'un consommateur. */
  async ensure(guildId = authStore.selectedGuildId): Promise<void> {
    if (!guildId) return;
    if (loading) return;
    if (loaded && loadedGuildId === guildId) return;
    await this.load(guildId);
  },

  /** Changer de serveur invalide le parcours : il decrit l'autre. */
  reset(): void {
    steps = [];
    progress = { ...EMPTY_PROGRESS };
    loaded = false;
    loadedGuildId = null;
  },
};
