import { dashboardFetch } from '../api';
import { authStore } from './auth.svelte';
import { announceNotifications, onNotificationOpened } from '../notificationAlerts';
import { categoryOf } from '../notificationCategories';
import { userPrefs } from './userPreferences.svelte';

export type Notification = {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  link?: string;
  isRead: boolean;
  createdAt: string;
};

class NotificationsStore {
  items = $state<Notification[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  private inflight: Promise<void> | null = null;
  private inflightGuildId: string | null = null;
  private loadedGuildId: string | null = null;
  private fetchedAt = 0;

  private static readonly FRESH_FOR_MS = 30_000;
  /** Une notification plus ancienne n'est plus « nouvelle », meme jamais vue. */
  private static readonly ANNOUNCE_WITHIN_MS = 15 * 60_000;

  /**
   * Les identifiants deja vus pour la guilde `knownGuildId`. Le premier
   * chargement d'une guilde sert de reference et n'annonce rien : sinon chaque
   * rechargement de page ou changement de serveur sonnerait pour toute la boite.
   */
  private knownIds = new Set<string>();
  private knownGuildId: string | null = null;

  constructor() {
    onNotificationOpened((id) => {
      const notif = this.items.find((n) => n.id === id);
      if (notif && !notif.isRead) void this.markAsRead(id);
    });
  }

  private detectNew(guildId: string, incoming: Notification[]) {
    if (this.knownGuildId === guildId) {
      const now = Date.now();
      const fresh = incoming.filter(
        (n) =>
          !n.isRead &&
          !this.knownIds.has(n.id) &&
          now - Date.parse(n.createdAt) < NotificationsStore.ANNOUNCE_WITHIN_MS,
      );
      const wanted = fresh.filter((n) => this.isWanted(n));
      if (wanted.length > 0) void announceNotifications(wanted);
    }
    this.knownIds = new Set(incoming.map((n) => n.id));
    this.knownGuildId = guildId;
  }

  /** La personne a choisi de recevoir cette famille de notifications. */
  isWanted(notification: Notification): boolean {
    const muted = userPrefs.prefs.mutedNotificationCategories ?? [];
    return !muted.includes(categoryOf(notification.link));
  }

  /** Ce que la cloche affiche : sans les familles coupees dans les preferences. */
  get visibleItems() {
    return this.items.filter((n) => this.isWanted(n));
  }

  get unreadCount() {
    return this.visibleItems.filter(n => !n.isRead).length;
  }

  async fetchNotifications(force = false): Promise<void> {
    if (!authStore.selectedGuildId || !authStore.token) return;

    const guildId = authStore.selectedGuildId;
    if (
      !force &&
      this.loadedGuildId === guildId &&
      Date.now() - this.fetchedAt < NotificationsStore.FRESH_FOR_MS
    ) {
      return;
    }
    if (this.inflight && this.inflightGuildId === guildId) return this.inflight;

    this.loadedGuildId = guildId;
    this.inflightGuildId = guildId;
    this.loading = true;
    this.inflight = (async () => {
      try {
        const res = await dashboardFetch(`/notifications`, { guildId,
          headers: {
            'Accept': 'application/json'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (authStore.selectedGuildId === guildId) {
            this.items = data.notifications || [];
            this.detectNew(guildId, this.items);
            this.error = null;
            this.fetchedAt = Date.now();
          }
        } else if (authStore.selectedGuildId === guildId) {
          this.error = 'Impossible de récupérer les notifications. Réessaie.';
        }
      } catch {
        if (authStore.selectedGuildId === guildId) {
          this.error = 'Erreur réseau';
        }
      } finally {
        if (authStore.selectedGuildId === guildId) {
          this.loading = false;
        }
        if (this.inflightGuildId === guildId) {
          this.inflight = null;
          this.inflightGuildId = null;
        }
      }
    })();

    return this.inflight;
  }

  async markAsRead(id: string) {
    if (!authStore.selectedGuildId || !authStore.token) return;

    // Optimistic update
    const notif = this.items.find(n => n.id === id);
    if (notif) notif.isRead = true;

    try {
      await dashboardFetch(`/notifications/${id}/read`, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      // Revert on error
      if (notif) notif.isRead = false;
    }
  }

  async markAllAsRead() {
    if (!authStore.selectedGuildId || !authStore.token) return;

    // Optimistic update
    const prev = JSON.parse(JSON.stringify(this.items));
    this.items.forEach(n => n.isRead = true);

    try {
      await dashboardFetch(`/notifications/mark-all-read`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      // Revert on error
      this.items = prev;
    }
  }
}

export const notificationsStore = new NotificationsStore();
