import { dashboardFetch } from '../api';
import { authStore } from './auth.svelte';

class StaffStore {
  absences = $state<any[]>([]);
  meetings = $state<any[]>([]);
  members = $state<any[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  private inflight: Promise<void> | null = null;
  private inflightGuildId: string | null = null;
  private loadedGuildId: string | null = null;
  private fetchedAt = 0;

  private static readonly FRESH_FOR_MS = 30_000;

  async fetchAll(force = false): Promise<void> {
    if (!authStore.selectedGuildId || !authStore.token) return;

    const guildId = authStore.selectedGuildId;
    if (
      !force &&
      this.loadedGuildId === guildId &&
      Date.now() - this.fetchedAt < StaffStore.FRESH_FOR_MS
    ) {
      return;
    }
    if (this.inflight && this.inflightGuildId === guildId) return this.inflight;

    this.loadedGuildId = guildId;
    this.inflightGuildId = guildId;
    this.loading = true;
    this.inflight = (async () => {
      try {
        const headers = { Authorization: `Bearer ${authStore.token}` };

        const [absencesRes, meetingsRes, membersRes] = await Promise.all([
          dashboardFetch(`/absences`, { guildId, headers }),
          dashboardFetch(`/meetings`, { guildId, headers }),
          dashboardFetch(`/staff/members`, { guildId, headers })
        ]);

        if (authStore.selectedGuildId !== guildId) return;

        if (absencesRes.ok) {
          const data = await absencesRes.json();
          this.absences = data.absences || [];
        }

        if (meetingsRes.ok) {
          const data = await meetingsRes.json();
          this.meetings = data.meetings || [];
        }

        if (membersRes.ok) {
          const data = await membersRes.json();
          this.members = data.members || [];
        }

        this.error = null;
        this.fetchedAt = Date.now();
      } catch (err) {
        console.error('StaffStore fetch error:', err);
        if (authStore.selectedGuildId === guildId) {
          this.error = 'Erreur lors du chargement des données staff';
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

  get pendingAbsences() {
    return this.absences.filter(a => a.status === 'PENDING' || a.status === 'ACKNOWLEDGED');
  }

  get upcomingMeetings() {
    return this.meetings
      .filter(m => new Date(m.scheduledAt) > new Date())
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }
}

export const staffStore = new StaffStore();
