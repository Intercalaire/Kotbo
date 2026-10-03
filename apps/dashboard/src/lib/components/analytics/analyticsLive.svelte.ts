import { dashboardLifecycle } from '../../dashboardLifecycle';
import { subscribeRealtime } from '../../stores/realtime.svelte';

/** Instantané poussé par le bot toutes les 5 secondes (cf. analyticsLiveService). */
export interface LiveSnapshot {
  guildId: string;
  at: string;
  since: string;
  windowMinutes: number;
  minutes: Array<{ at: string; messages: number; joins: number; leaves: number }>;
  messages: number;
  joins: number;
  leaves: number;
  authors: number;
  perMinute: number;
  channels: Array<{ channelId: string; name: string | null; messages: number }>;
  voiceNow: number;
  voiceChannels: Array<{ channelId: string; name: string | null; members: number }>;
  onlineNow: number;
}

/**
 * Temps réel d'un serveur, par le WebSocket du dashboard. À appeler pendant
 * l'initialisation d'un composant : l'abonnement suit `guildId()` et tombe
 * avec le composant. La démo n'a pas de serveur : un flux simulé la remplace.
 */
export function analyticsLive(guildId: () => string | null) {
  const state = $state({ snapshot: null as LiveSnapshot | null, denied: false });

  $effect(() => {
    const id = guildId();
    state.snapshot = null;
    state.denied = false;
    if (!id) return;

    if (import.meta.env.VITE_DEMO === '1') {
      const tick = () => (state.snapshot = simulatedSnapshot(id));
      tick();
      const timer = setInterval(tick, 5_000);
      return () => clearInterval(timer);
    }

    const stopEvents = subscribeRealtime({
      types: ['analytics_live', 'analytics_live_denied'],
      throttleMs: 0,
      onUpdate: (event) => {
        if (!event) {
          // Reconnexion : le gestionnaire renvoie l'abonnement de lui-même.
          return;
        }
        if (event.guildId !== id) return;
        if (event.type === 'analytics_live_denied') state.denied = true;
        else state.snapshot = event as unknown as LiveSnapshot;
      },
    });
    const stopLive = dashboardLifecycle.subscribeAnalyticsLive(id);
    return () => {
      stopLive();
      stopEvents();
    };
  });

  return state;
}

// ── Démo ────────────────────────────────────────────────────────────────

const DEMO_CHANNELS = [
  { channelId: '900000000000000313', name: 'général', weight: 0.5 },
  { channelId: '900000000000000314', name: 'recherche-de-groupe', weight: 0.22 },
  { channelId: '900000000000000315', name: 'niveaux', weight: 0.12 },
  { channelId: '900000000000000320', name: 'suggestions', weight: 0.08 },
];

function simulatedSnapshot(guildId: string): LiveSnapshot {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const minutes = Array.from({ length: 30 }, (_, i) => {
    const m = minute - 29 + i;
    const wave = 4 + Math.round(3 * Math.sin(m / 4) + ((m * 7919) % 5));
    return { at: new Date(m * 60_000).toISOString(), messages: Math.max(0, wave), joins: m % 11 === 0 ? 1 : 0, leaves: m % 23 === 0 ? 1 : 0 };
  });
  const messages = minutes.reduce((s, x) => s + x.messages, 0);
  return {
    guildId,
    at: new Date(now).toISOString(),
    since: new Date(now - 3 * 3600_000).toISOString(),
    windowMinutes: 30,
    minutes,
    messages,
    joins: minutes.reduce((s, x) => s + x.joins, 0),
    leaves: minutes.reduce((s, x) => s + x.leaves, 0),
    authors: Math.round(messages / 6.5),
    perMinute: Math.round((minutes.slice(-5).reduce((s, x) => s + x.messages, 0) / 5) * 10) / 10,
    channels: DEMO_CHANNELS.map((c) => ({ channelId: c.channelId, name: c.name, messages: Math.round(messages * c.weight) })),
    voiceNow: 5 + (minute % 3),
    voiceChannels: [{ channelId: '900000000000000330', name: 'Squad', members: 4 + (minute % 3) }, { channelId: '900000000000000331', name: 'Réunion staff', members: 1 }],
    onlineNow: 74 + (minute % 9),
  };
}
