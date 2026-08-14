/**
 * Bascule entre un réglage simple, où quelques curseurs à crans posent
 * plusieurs valeurs à la fois, et le réglage avancé qui montre ces valeurs
 * telles quelles.
 *
 * Le motif est identique partout où il sert : la préférence d'affichage est
 * retenue par navigateur, mais elle ne peut pas imposer le mode simple. Une
 * configuration réglée finement ne tombe sur aucun cran, et les curseurs en
 * afficheraient un qui ne correspond pas à ce qui est enregistré.
 */
export type SimpleModePreference = ReturnType<typeof createSimpleModePreference>;

export function createSimpleModePreference(storageKey: string) {
  function stored(): 'simple' | 'advanced' | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(storageKey);
      return raw === 'simple' || raw === 'advanced' ? raw : null;
    } catch {
      return null;
    }
  }

  // Initialisé dès le rendu : sans ça, un échec de chargement des données
  // laisserait les curseurs à l'écran alors que le mode avancé a été choisi.
  let simple = $state(stored() !== 'advanced');

  return {
    get simple() {
      return simple;
    },

    /** Choix explicite de l'utilisateur : il est retenu. */
    set(value: boolean) {
      simple = value;
      try {
        localStorage.setItem(storageKey, value ? 'simple' : 'advanced');
      } catch { /* ignore */ }
    },

    /**
     * À appeler une fois la configuration chargée. `representable` dit si elle
     * tombe sur les crans du mode simple ; sinon on ouvre en avancé quelle que
     * soit la préférence.
     */
    resolve(representable: boolean) {
      simple = stored() === 'advanced' ? false : representable;
    },
  };
}

/** Cran le plus proche d'une valeur, indexé à partir de 1 comme le sont les curseurs. */
export function nearestStep(values: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i;
  }
  return best + 1;
}
