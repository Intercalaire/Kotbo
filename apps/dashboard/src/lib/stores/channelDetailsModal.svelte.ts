/**
 * Ouverture globale de la vue détaillée d'un salon.
 *
 * Même pattern que `inviteDetailsModal` : la modale est montée une seule fois
 * dans App.svelte, n'importe quel composant peut l'ouvrir sans la monter
 * lui-même ni faire remonter un événement.
 */
class ChannelDetailsModalStore {
  open = $state(false);
  channelId = $state<string | null>(null);
  /** Nom connu par l'appelant, affiché en en-tête le temps du chargement. */
  channelName = $state<string | null>(null);

  show(channelId: string, channelName?: string | null) {
    if (!channelId) return;
    this.channelId = channelId;
    this.channelName = channelName ?? null;
    this.open = true;
  }

  close() {
    this.open = false;
    this.channelId = null;
    this.channelName = null;
  }
}

export const channelDetailsModal = new ChannelDetailsModalStore();
