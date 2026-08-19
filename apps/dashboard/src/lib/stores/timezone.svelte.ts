import { DEFAULT_TIMEZONE } from '@kotbo/contracts';
import { authStore } from './auth.svelte';
import { fetchGuildTimezone } from '../api/guild';

/**
 * Fuseau du serveur selectionne, partage entre toutes les pages qui saisissent
 * une date. Regroupe en un seul appel : sans cache, Meetings, Planning et le
 * formulaire de rappels lanceraient chacun leur propre GET a l'ouverture.
 *
 * Le fuseau du navigateur reste expose pour les libelles d'aide : « heure
 * saisie dans Europe/Paris (comme sur ton PC) » se lit differemment selon que
 * les deux correspondent ou non.
 */
class TimezoneStore {
  timezone = $state<string>(DEFAULT_TIMEZONE);
  loaded = $state(false);
  loadedGuildId: string | null = null;

  readonly browserTimezone: string = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    } catch {
      return DEFAULT_TIMEZONE;
    }
  })();

  async ensureLoaded(force = false): Promise<void> {
    const guildId = authStore.selectedGuildId;
    if (!guildId) return;
    if (!force && this.loadedGuildId === guildId) return;

    const state = await fetchGuildTimezone();
    // La selection a pu changer pendant l'appel : n'ecrit que si on est encore
    // sur le serveur demande, sinon on ecraserait un chargement plus recent.
    if (authStore.selectedGuildId !== guildId) return;
    if (state?.timezone) {
      this.timezone = state.timezone;
      this.loaded = true;
      this.loadedGuildId = guildId;
    }
  }

  /** Vrai si le fuseau du serveur diffère de celui du navigateur. */
  get differsFromBrowser(): boolean {
    return this.timezone !== this.browserTimezone;
  }
}

export const timezoneStore = new TimezoneStore();
