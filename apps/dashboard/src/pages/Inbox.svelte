<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from 'tinro';
  import { resolveTabFromUrl, gotoTab } from '../lib/tabRouting';
  import { notificationsStore } from '../lib/stores/notifications.svelte';
  import { fade, fly } from 'svelte/transition';
  import Papicon from '../lib/components/Papicon.svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import { m, dateLocale } from '../lib/i18n';

  const inboxTabs = ['tous', 'modération', 'recrutement', 'staff', 'système'] as const;
  let currentTab = $state('tous');

  $effect(() => {
    const _path = $router.path;
    currentTab = resolveTabFromUrl('/inbox', inboxTabs, 'tous');
  });

  onMount(() => {
    notificationsStore.fetchNotifications();
  });

  const getIconForType = (type: string) => {
    switch (type) {
      case 'SUCCESS': return 'check-circle';
      case 'WARNING': return 'alert-triangle';
      case 'ERROR': return 'alert-circle';
      default: return 'info';
    }
  };

  const getColorForType = (type: string) => {
    switch (type) {
      case 'SUCCESS': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'WARNING': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'ERROR': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      default: return 'text-primary bg-primary/10 border-primary/20';
    }
  };

  const getCategory = (notif: any) => {
    const title = notif.title.toLowerCase();
    const link = (notif.link || '').toLowerCase();

    if (title.includes('sanction') || title.includes('bannissement') || title.includes('exclusion') || title.includes('timeout') || title.includes('avertissement')) return 'modération';
    if (title.includes('candidature') || link.includes('recruitment')) return 'recrutement';
    if (title.includes('staff') || title.includes('management') || title.includes('note') || link.includes('absences') || link.includes('meeting')) return 'staff';
    if (title.includes('bot') || title.includes('système') || title.includes('erreur')) return 'système';
    return 'tous';
  };

  const filteredNotifications = $derived(
    currentTab === 'tous' 
      ? notificationsStore.items 
      : notificationsStore.items.filter(n => getCategory(n) === currentTab)
  );

  const tabLabel = (id: string) => {
    switch (id) {
      case 'modération': return m.inbox_tab_moderation();
      case 'recrutement': return m.inbox_tab_recruitment();
      case 'staff': return m.inbox_tab_staff();
      case 'système': return m.inbox_tab_system();
      default: return m.inbox_tab_all();
    }
  };

  const tabs = [
    { id: 'tous', icon: 'layers' },
    { id: 'modération', icon: 'shield' },
    { id: 'recrutement', icon: 'users' },
    { id: 'staff', icon: 'user-check' },
    { id: 'système', icon: 'cpu' },
  ];
</script>

<ModulePage
  title={m.nav_inbox()}
  description={m.inbox_page_desc()}
  icon="inbox"
  featureKey="inbox"
>
  {#snippet actions()}
    {#if notificationsStore.unreadCount > 0}
      <button
        onclick={() => notificationsStore.markAllAsRead()}
        class="group flex items-center gap-2 px-4 py-2 bg-primary text-white font-semibold text-sm rounded-lg active:scale-[0.98] transition-all"
      >
        <Papicon icon="check" size={16} />
        {m.inbox_mark_all_read()}
      </button>
    {/if}
    <button
      onclick={() => notificationsStore.fetchNotifications()}
      class="p-2 bg-surface-container-high text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-all border border-outline-variant/30"
      title={m.common_refresh()}
    >
      <Papicon icon="refresh-cw" size={18} class={notificationsStore.loading ? 'animate-spin' : ''} />
    </button>
  {/snippet}

  <!-- Sur téléphone, le filtre natif reste entièrement lisible et ne demande
       pas de deviner qu'une rangée d'onglets continue hors écran. -->
  <label class="inbox-mobile-filter">
    <span>{m.common_filter()}</span>
    <select
      value={currentTab}
      onchange={(event) => gotoTab('/inbox', event.currentTarget.value, 'tous')}
    >
      {#each tabs as tab}
        <option value={tab.id}>{tabLabel(tab.id)}</option>
      {/each}
    </select>
  </label>

  <!-- Tabs desktop -->
  <div class="inbox-tabs items-center gap-2 p-1.5 bg-surface-container-lowest border border-outline-variant/20 rounded-[22px] overflow-x-auto no-scrollbar shadow-sm">
    {#each tabs as tab}
      <button
        onclick={() => gotoTab('/inbox', tab.id, 'tous')}
        class="relative flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300
 {currentTab === tab.id ? 'text-white' : 'text-on-surface-variant hover:bg-surface-container-high'}"
      >
        {#if currentTab === tab.id}
          <div 
            class="absolute inset-0 bg-primary rounded-lg shadow-[0_4px_12px_rgba(var(--color-primary),0.25)]"
            in:fade={{ duration: 200 }}
          ></div>
        {/if}
        <span class="relative z-10 flex items-center gap-2.5">
          <Papicon icon={tab.icon} size={18} />
          {tabLabel(tab.id)}
          
          {#if tab.id === 'tous' && notificationsStore.unreadCount > 0}
            <span class="px-1.5 py-0.5 bg-white/20 text-white rounded-lg text-[10px] font-semibold">
              {notificationsStore.unreadCount}
            </span>
          {/if}
        </span>
      </button>
    {/each}
  </div>

  <!-- Content -->
  <div class="space-y-4">
    {#if notificationsStore.loading && notificationsStore.items.length === 0}
      <div class="grid gap-4">
        {#each Array(5) as _}
          <div class="h-32 bg-surface-container-lowest border border-outline-variant/20 rounded-xl animate-pulse"></div>
        {/each}
      </div>
    {:else if filteredNotifications.length === 0}
      <div class="py-24 flex flex-col items-center justify-center text-on-surface-variant/40 bg-surface-container-lowest border border-outline-variant/20 rounded-[40px] shadow-sm" in:fade>
        <div class="w-24 h-24 bg-surface-container-high rounded-[32px] flex items-center justify-center mb-8 border border-outline-variant/20 rotate-3">
          <Papicon icon="inbox" size={48} />
        </div>
        <h2 class="text-2xl font-semibold text-on-surface">{m.inbox_empty_title()}</h2>
        <p class="text-sm mt-3 max-w-xs text-center font-medium opacity-60">
          {m.inbox_empty_desc_before()}<b>{tabLabel(currentTab)}</b>{m.inbox_empty_desc_after()}
        </p>
      </div>
    {:else}
      <div class="grid gap-4">
        {#each filteredNotifications as notif (notif.id)}
          <div 
            class="inbox-notification-card group relative flex items-start gap-5 p-6 bg-surface-container-lowest border border-outline-variant/20 rounded-[32px] hover:border-primary/30 transition-all duration-300 shadow-sm hover:shadow-xl hover:-translate-y-1 {notif.isRead ? 'opacity-80' : 'after:absolute after:left-0 after:top-8 after:bottom-8 after:w-1 after:bg-primary after:rounded-full'}"
            in:fly={{ y: 20, duration: 400 }}
          >
            <!-- Type Icon -->
            <div class="shrink-0 w-14 h-14 rounded-lg flex items-center justify-center border {getColorForType(notif.type)} shadow-sm transition-transform group-">
              <Papicon icon={getIconForType(notif.type)} size={28} />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 mb-2">
                <div class="flex items-center gap-2">
                  <h3 class="inbox-notification-card__title text-lg font-semibold text-on-surface tracking-tight">
                    {notif.title}
                  </h3>
                  {#if !notif.isRead}
                    <span class="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--color-primary),0.8)]"></span>
                  {/if}
                </div>
                <span class="text-xs font-bold text-on-surface-variant/50 whitespace-nowrap bg-surface-container-high px-3 py-1.5 rounded-full border border-outline-variant/20">
                  {new Date(notif.createdAt).toLocaleString(dateLocale(), {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
              
              <p class="text-[15px] leading-relaxed text-on-surface-variant/80 mb-5 max-w-3xl font-medium">
                {notif.message}
              </p>
              
              <div class="inbox-notification-card__footer flex items-center justify-between gap-3">
                <div class="inbox-notification-card__actions flex flex-wrap gap-2">
                  {#if notif.link}
                    <a 
                      href={notif.link}
                      class="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl active:scale-[0.98] transition-all shadow-sm"
                    >
                      <Papicon icon="external-link" size={14} />
                      {m.inbox_notification_view()}
                    </a>
                  {/if}
                  
                  {#if !notif.isRead}
                    <button 
                      onclick={() => notificationsStore.markAsRead(notif.id)}
                      class="inline-flex items-center gap-2 px-5 py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-semibold rounded-xl transition-all border border-outline-variant/30"
                    >
                      <Papicon icon="check" size={14} />
                      {m.inbox_notification_mark_read()}
                    </button>
                  {/if}
                </div>

                <div class="hidden sm:flex items-center gap-2 text-xs font-medium text-on-surface-variant/30">
                  <span class="w-1.5 h-1.5 rounded-full bg-current opacity-30"></span>
                  {tabLabel(getCategory(notif))}
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</ModulePage>

<style>
  .inbox-tabs {
    display: flex;
  }

  .inbox-mobile-filter {
    display: none;
  }

  /* A row of tabs cannot hold every notification category on a phone, so the
     same filter becomes a native select the OS renders full screen. */
  @media (max-width: 767px) {
    .inbox-tabs {
      display: none;
    }

    .inbox-mobile-filter {
      display: grid;
      gap: 0.4rem;
      color: var(--on-surface-variant);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .inbox-mobile-filter select {
      width: 100%;
      border: 1px solid var(--outline-variant);
      border-radius: 0.875rem;
      background: var(--surface-container-lowest);
      color: var(--on-surface);
      font-weight: 650;
    }

    .inbox-notification-card {
      gap: 0.875rem;
      border-radius: 1.125rem;
    }

    .inbox-notification-card > :first-child {
      width: 2.75rem;
      height: 2.75rem;
    }

    .inbox-notification-card__title {
      overflow-wrap: anywhere;
      line-height: 1.25;
    }

    .inbox-notification-card__footer {
      align-items: flex-start;
      flex-direction: column;
    }

    .inbox-notification-card__actions {
      width: 100%;
    }

    .inbox-notification-card__actions > :where(a, button) {
      min-height: 2.625rem;
      flex: 1 1 auto;
      justify-content: center;
    }
  }

  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
