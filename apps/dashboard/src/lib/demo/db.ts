/**
 * La mémoire de la démo : des documents JSON rangés par clé, dans le
 * `localStorage` du visiteur.
 *
 * Chaque clé part d'une valeur de départ (les données fictives) et n'est
 * écrite qu'au premier changement. Une démo jamais touchée ne laisse donc rien
 * dans le navigateur, et une démo réinitialisée revient exactement à son état
 * d'origine.
 *
 * Un numéro de version accompagne le tout : quand les données de départ
 * changent (nouvelle version du dashboard), une mémoire plus ancienne est
 * écartée plutôt que relue de travers.
 */
const STORAGE_KEY = 'kotbo-demo-db';
const VERSION = 1;

type Store = { version: number; docs: Record<string, unknown> };

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Store) : null;
    cache = parsed && parsed.version === VERSION && parsed.docs ? parsed : { version: VERSION, docs: {} };
  } catch {
    cache = { version: VERSION, docs: {} };
  }
  return cache;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // Navigation privée, quota plein : la démo vaut pour cette visite.
  }
}

/** Copie profonde : une réponse modifiée par une page ne doit jamais toucher la mémoire. */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export const demoDb = {
  /** Lit un document, ou sa valeur de départ s'il n'a jamais été écrit. */
  get<T>(key: string, seed: () => T): T {
    const docs = load().docs;
    if (!(key in docs)) return clone(seed());
    return clone(docs[key] as T);
  },

  set<T>(key: string, value: T): T {
    load().docs[key] = clone(value);
    save();
    return clone(value);
  },

  /** Lit, modifie, écrit. Le cas courant d'une écriture de la démo. */
  update<T>(key: string, seed: () => T, change: (current: T) => T): T {
    return this.set(key, change(this.get(key, seed)));
  },

  /** Le visiteur a-t-il déjà changé quelque chose ? Le bandeau propose alors de tout remettre. */
  get touched(): boolean {
    return Object.keys(load().docs).length > 0;
  },

  /** Revient aux données de départ. */
  reset(): void {
    cache = { version: VERSION, docs: {} };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Rien à effacer.
    }
  },
};

/** Identifiant neuf pour un élément créé dans la démo. Au format Discord, comme les vrais. */
export function demoId(): string {
  return `9${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 18).padEnd(18, '0');
}
