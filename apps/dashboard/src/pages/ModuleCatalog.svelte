<script lang="ts">
  /**
   * Hub des modules.
   *
   * La page précédente affichait une grille de cartes issue d'un tableau codé en
   * dur côté bot, sans rapport avec ce que le bot exécutait vraiment. Elle est
   * refaite à partir du registre partagé : chaque ligne correspond à un module
   * que la garde d'exécution connaît, et l'interrupteur agit pour de bon.
   *
   * Trois choses que la version en cartes ne pouvait pas montrer et qui pilotent
   * la mise en page ici :
   *   - les dépendances, qui rendent certains états impossibles ;
   *   - la distinction « éteint volontairement » / « bloqué par une dépendance » ;
   *   - les modules du cœur, qu'aucun interrupteur ne doit prétendre couper.
   *
   * Liste dense groupée par rubrique plutôt que grille de cartes : une trentaine
   * de modules ne se parcourt pas en scrollant des vignettes de 250 px.
   */
  import { fly, slide } from 'svelte/transition';
  import { MODULE_CATEGORIES, type ModuleCategory } from '@kotbo/contracts';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { applyGuildPreset, updateModuleStatus } from '../lib/api';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import RolePermissionSettings from '../lib/components/RolePermissionSettings.svelte';

  interface ModuleRow {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'inactive' | 'error';
    category?: ModuleCategory;
    icon?: string;
    isFixed?: boolean;
    requires?: string[];
    dependents?: string[];
    blockedBy?: string[];
    settingsPath?: string;
    interactions?: number;
    /**
     * Eteint parce que l'offre du serveur ne le comprend pas. A distinguer de
     * `blockedBy` : celui-la se debloque en rallumant un autre module, celui-ci
     * en changeant d'offre. L'API envoyait deja les deux champs ; ne pas les
     * lire laissait un interrupteur vivant sur un module verrouille, que la
     * garde d'execution rebasculait aussitot - le clic partait en boucle.
     */
    lockedByPlan?: boolean;
    requiredPlan?: string | null;
  }

  const PLAN_LABELS: Record<string, string> = {
    PRO: 'Pro',
    ULTIMATE: 'Ultimate',
    CUSTOM: 'Sur mesure',
  };

  const planLabel = (key?: string | null) => (key ? PLAN_LABELS[key] ?? key : 'payante');

  const modules = $derived((dashboardStore.state.modules ?? []) as ModuleRow[]);
  const moduleById = $derived(new Map(modules.map((mod) => [mod.id, mod])));
  const nameOf = (id: string) => moduleById.get(id)?.name ?? id;

  const canManageSettings = $derived(
    !!dashboardStore.state.featureAccess?.modules?.canConfigure
      || !!dashboardStore.state.access?.canManageSettings,
  );

  const canApplyPreset = $derived(
    !!dashboardStore.state.access?.canManageSettings
      || (!!dashboardStore.state.featureAccess?.modules?.canConfigure
        && !!dashboardStore.state.featureAccess?.commands?.canConfigure),
  );

  function canConfigureModule(moduleId: string) {
    return canManageSettings || !!dashboardStore.state.featureAccess?.[moduleId]?.canConfigure;
  }

  // ── Filtres ────────────────────────────────────────────────────────────
  let search = $state('');
  let statusFilter = $state<'all' | 'active' | 'inactive' | 'blocked' | 'locked'>('all');
  let collapsedCategories = $state<Record<string, boolean>>({});
  let selectedId = $state<string | null>(null);

  const normalize = (value: string) =>
    value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const filtered = $derived.by(() => {
    const needle = normalize(search.trim());
    return modules.filter((mod) => {
      const blocked = (mod.blockedBy?.length ?? 0) > 0 && !mod.lockedByPlan;
      if (statusFilter === 'active' && mod.status !== 'active') return false;
      if (statusFilter === 'inactive' && (mod.status === 'active' || blocked || mod.lockedByPlan)) return false;
      if (statusFilter === 'blocked' && !blocked) return false;
      if (statusFilter === 'locked' && !mod.lockedByPlan) return false;
      if (!needle) return true;
      return normalize(`${mod.name} ${mod.description} ${mod.id}`).includes(needle);
    });
  });

  const groups = $derived(
    MODULE_CATEGORIES.map((category) => ({
      ...category,
      items: filtered.filter((mod) => (mod.category ?? 'core') === category.key),
    })).filter((group) => group.items.length > 0),
  );

  const activeCount = $derived(modules.filter((mod) => mod.status === 'active').length);
  const inactiveCount = $derived(
    modules.filter(
      (mod) => mod.status !== 'active' && (mod.blockedBy?.length ?? 0) === 0 && !mod.lockedByPlan,
    ).length,
  );
  const blockedCount = $derived(
    modules.filter((mod) => (mod.blockedBy?.length ?? 0) > 0 && !mod.lockedByPlan).length,
  );
  const lockedCount = $derived(modules.filter((mod) => mod.lockedByPlan).length);

  const selected = $derived(selectedId ? moduleById.get(selectedId) ?? null : null);

  // ── Bascule ────────────────────────────────────────────────────────────
  //
  // État optimiste : l'aller-retour vers le bot passe par une invalidation de
  // cache et un rechargement complet de l'état du serveur. Attendre laissait
  // l'interrupteur figé une seconde entière, ce qui se lit comme un clic perdu.
  let pending = $state<Record<string, boolean>>({});
  let optimistic = $state<Record<string, 'active' | 'inactive'>>({});

  function clearOptimistic(moduleId: string) {
    return Object.fromEntries(
      Object.entries(optimistic).filter(([key]) => key !== moduleId),
    ) as Record<string, 'active' | 'inactive'>;
  }

  function displayedStatus(mod: ModuleRow) {
    return optimistic[mod.id] ?? mod.status;
  }

  async function toggleModule(mod: ModuleRow) {
    if (mod.isFixed || pending[mod.id] || !canConfigureModule(mod.id)) return;

    // Un module hors offre ne se bascule pas : l'API le refuse desormais, et
    // l'appeler quand meme ne ferait qu'afficher une erreur a laquelle
    // l'administrateur ne peut rien. On l'envoie la ou la reponse se trouve.
    if (mod.lockedByPlan) {
      toast.error(`« ${mod.name} » fait partie de l'offre ${planLabel(mod.requiredPlan)}.`);
      return;
    }

    const current = displayedStatus(mod);
    const next = current === 'active' ? 'inactive' : 'active';

    // Couper un module dont d'autres dépendent les coupe aussi : on l'annonce
    // avant, plutôt que de laisser l'administrateur découvrir après coup que
    // trois autres lignes se sont éteintes.
    if (next === 'inactive') {
      const activeDependents = (mod.dependents ?? []).filter(
        (key) => moduleById.get(key)?.status === 'active',
      );
      if (activeDependents.length > 0) {
        const confirmed = await confirmDialog.ask({
          title: `Désactiver « ${mod.name} » ?`,
          description:
            `${activeDependents.length} module(s) en dépendent et seront désactivés en même temps : `
            + `${activeDependents.map(nameOf).join(', ')}.`,
          confirmLabel: 'Désactiver quand même',
          variant: 'warning',
        });
        if (!confirmed) return;
      }
    }

    const missingRequirements = next === 'active'
      ? (mod.requires ?? []).filter((key) => moduleById.get(key)?.status !== 'active')
      : [];

    optimistic = { ...optimistic, [mod.id]: next };
    pending = { ...pending, [mod.id]: true };

    const result = await updateModuleStatus(mod.id, next);

    pending = { ...pending, [mod.id]: false };

    if (!result) {
      // Rollback : sans lui, la page afficherait un état que le bot n'a pas.
      optimistic = clearOptimistic(mod.id);
      toast.error(`Impossible de changer l'état de « ${mod.name} ».`);
      return;
    }

    if (missingRequirements.length > 0) {
      toast.success(
        `« ${mod.name} » activé, avec ses dépendances : ${missingRequirements.map(nameOf).join(', ')}.`,
      );
    } else {
      toast.success(`« ${mod.name} » ${next === 'active' ? 'activé' : 'désactivé'}.`);
    }

    await dashboardStore.refresh();
    // L'état du serveur fait de nouveau foi : on lâche la valeur optimiste.
    optimistic = clearOptimistic(mod.id);
  }

  // ── Presets ────────────────────────────────────────────────────────────
  const presets = [
    {
      key: 'general',
      title: 'Communauté générale',
      description: 'Traduction active, modules dev en veille, commandes admin sous contrôle.',
      icon: 'Users',
    },
    {
      key: 'gaming',
      title: 'Gaming / Esport',
      description: 'Traduction active, stack de modération simple, focus salons joueurs.',
      icon: 'Sparkles',
    },
    {
      key: 'dev',
      title: 'Dev / Tech',
      description: 'Daily Algo et Code Police actifs, commandes techniques ouvertes.',
      icon: 'Code',
    },
  ];

  let applyingPreset = $state<string | null>(null);

  async function applyPreset(presetKey: string) {
    if (!canApplyPreset || applyingPreset) return;
    const confirmed = await confirmDialog.ask({
      title: `Appliquer le preset « ${presetKey} » ?`,
      description: 'Certains réglages actuels seront remplacés.',
      confirmLabel: 'Appliquer',
      variant: 'warning',
    });
    if (!confirmed) return;

    applyingPreset = presetKey;
    const ok = await applyGuildPreset(presetKey);
    applyingPreset = null;
    if (ok) {
      toast.success('Preset appliqué.');
      await dashboardStore.refresh();
    }
  }

  function toggleCategory(key: string) {
    collapsedCategories = { ...collapsedCategories, [key]: !collapsedCategories[key] };
  }

  const isLoading = $derived(dashboardStore.state.loading && modules.length === 0);
</script>

<div class="max-w-6xl mx-auto px-4 md:px-8 pb-24 space-y-6">

  <!-- En-tête : compteurs + recherche + filtres -->
  <header class="pt-6 space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Papicon icon="Grid" size={20} />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl font-semibold text-on-surface tracking-tight leading-tight">Modules</h1>
          <p class="text-[13px] text-on-surface-variant leading-relaxed max-w-xl">
            Un module désactivé cesse réellement de fonctionner : ses commandes, ses boutons,
            ses tâches planifiées et sa page de configuration deviennent inaccessibles.
          </p>
        </div>
      </div>

      <div class="flex items-center gap-4 text-xs font-medium">
        <span class="flex items-center gap-2 text-on-surface-variant">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>{activeCount} actifs
        </span>
        <span class="flex items-center gap-2 text-on-surface-variant">
          <span class="w-2 h-2 rounded-full bg-on-surface-variant/30"></span>{inactiveCount} inactifs
        </span>
        {#if blockedCount > 0}
          <span class="flex items-center gap-2 text-amber-500">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>{blockedCount} bloqués
          </span>
        {/if}
        {#if lockedCount > 0}
          <a href="/billing" class="flex items-center gap-2 text-primary hover:underline">
            <Papicon icon="Lock" size={12} />{lockedCount} dans une offre supérieure
          </a>
        {/if}

        <a
          href="/setup#structure"
          class="flex items-center gap-2 h-9 px-3 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
        >
          <Papicon icon="sparkles" size={16} />
          Créer mon serveur
        </a>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-3">
      <label class="relative flex-1 min-w-0">
        <span class="sr-only">Rechercher un module</span>
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none">
          <Papicon icon="Search" size={16} />
        </span>
        <input
          type="search"
          bind:value={search}
          placeholder="Rechercher un module…"
          class="w-full h-10 pl-9 pr-3 rounded-lg bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
        />
      </label>

      <div class="flex gap-1 p-1 rounded-lg bg-surface-container-low border border-outline-variant/40 shrink-0">
        {#each [['all', 'Tous'], ['active', 'Actifs'], ['inactive', 'Inactifs'], ['blocked', 'Bloqués'], ...(lockedCount > 0 ? [['locked', 'Offre']] : [])] as [value, label]}
          <button
            type="button"
            onclick={() => (statusFilter = value as typeof statusFilter)}
            class="px-3 h-8 rounded-md text-xs font-medium transition-colors {statusFilter === value
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}"
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  </header>

  <!-- Liste groupée par rubrique -->
  {#if isLoading}
    <div class="space-y-3">
      {#each Array(6) as _}
        <div class="h-16 rounded-xl bg-surface-container-low/40 animate-pulse"></div>
      {/each}
    </div>
  {:else if groups.length === 0}
    <div class="py-20 text-center">
      <p class="text-sm text-on-surface-variant">Aucun module ne correspond à cette recherche.</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each groups as group (group.key)}
        {@const collapsed = collapsedCategories[group.key]}
        {@const groupActive = group.items.filter((m) => displayedStatus(m) === 'active').length}
        <section class="rounded-xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
          <button
            type="button"
            onclick={() => toggleCategory(group.key)}
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-low transition-colors"
          >
            <span class="w-7 h-7 rounded-lg bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">
              <Papicon icon={group.icon} size={15} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-on-surface leading-tight">{group.label}</span>
              <span class="block text-[12px] text-on-surface-variant/70 truncate">{group.description}</span>
            </span>
            <span class="text-[11px] font-medium text-on-surface-variant/60 tabular-nums shrink-0">
              {groupActive}/{group.items.length}
            </span>
            <span class="text-on-surface-variant/50 shrink-0 transition-transform {collapsed ? '' : 'rotate-90'}">
              <Papicon icon="ChevronRight" size={14} />
            </span>
          </button>

          {#if !collapsed}
            <ul transition:slide={{ duration: 180 }} class="divide-y divide-outline-variant/20 border-t border-outline-variant/20">
              {#each group.items as mod (mod.id)}
                {@const status = displayedStatus(mod)}
                {@const locked = !!mod.lockedByPlan}
                {@const blocked = !locked && (mod.blockedBy?.length ?? 0) > 0}
                {@const busy = pending[mod.id]}
                <li class="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/50 transition-colors {status === 'active' ? '' : 'opacity-70'}">
                  <span
                    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 {status === 'active'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-surface-container text-on-surface-variant/50'}"
                  >
                    <Papicon icon={mod.icon || 'Grid'} size={17} />
                  </span>

                  <button
                    type="button"
                    onclick={() => (selectedId = selectedId === mod.id ? null : mod.id)}
                    class="min-w-0 flex-1 text-left group"
                  >
                    <span class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">{mod.name}</span>
                      {#if mod.isFixed}
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-surface-container-high text-on-surface-variant/70">
                          <Papicon icon="Lock" size={9} /> Cœur
                        </span>
                      {/if}
                      {#if locked}
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-primary/15 text-primary">
                          <Papicon icon="Lock" size={9} /> {planLabel(mod.requiredPlan)}
                        </span>
                      {:else if blocked}
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600">
                          Bloqué
                        </span>
                      {/if}
                    </span>
                    <span class="block text-[12px] text-on-surface-variant/70 leading-snug line-clamp-1">
                      {#if locked}
                        Compris dans l'offre {planLabel(mod.requiredPlan)}.
                      {:else if blocked}
                        Inactif tant que {mod.blockedBy!.map(nameOf).join(', ')} {mod.blockedBy!.length > 1 ? 'sont éteints' : 'est éteint'}.
                      {:else}
                        {mod.description}
                      {/if}
                    </span>
                  </button>

                  {#if locked}
                    <a
                      href="/billing"
                      class="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px] font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors shrink-0"
                    >
                      Débloquer <Papicon icon="ArrowRight" size={11} />
                    </a>
                  {:else}
                    {#if mod.settingsPath && status === 'active'}
                      <a
                        href={mod.settingsPath}
                        class="hidden sm:inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px] font-medium text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-colors shrink-0"
                      >
                        Configurer <Papicon icon="ArrowRight" size={11} />
                      </a>
                    {/if}

                    <span class="shrink-0 {busy ? 'opacity-50 pointer-events-none' : ''}">
                      <ToggleSwitch
                        checked={status === 'active'}
                        disabled={mod.isFixed || !canConfigureModule(mod.id)}
                        ariaLabel={`Activer ou désactiver ${mod.name}`}
                        onToggle={() => toggleModule(mod)}
                      />
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  <!-- Presets, en bas : c'est une action de mise en route, pas le geste courant -->
  <section class="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-on-surface">Configurations types</h2>
      <p class="text-[13px] text-on-surface-variant mt-0.5">
        Applique en une fois un jeu de modules et de permissions adapté à un type de serveur.
        Remplace les réglages concernés.
      </p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {#each presets as preset}
        <div class="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant flex items-center justify-center">
              <Papicon icon={preset.icon} size={15} />
            </span>
            <span class="text-sm font-medium text-on-surface">{preset.title}</span>
          </div>
          <p class="text-[12px] text-on-surface-variant/80 leading-relaxed flex-1">{preset.description}</p>
          <button
            type="button"
            onclick={() => applyPreset(preset.key)}
            disabled={!canApplyPreset || !!applyingPreset}
            class="h-9 rounded-lg text-xs font-medium transition-colors {!canApplyPreset || applyingPreset
              ? 'bg-surface-container-high text-on-surface-variant/40 cursor-not-allowed'
              : 'bg-primary text-on-primary hover:bg-primary/90'}"
          >
            {applyingPreset === preset.key ? 'Application…' : 'Appliquer'}
          </button>
        </div>
      {/each}
    </div>
  </section>
</div>

<!-- Panneau latéral : détail d'un module -->
{#if selected}
  {@const mod = selected}
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
    role="button"
    tabindex="-1"
    aria-label="Fermer le panneau"
    onclick={() => (selectedId = null)}
    onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') selectedId = null; }}
  ></div>
  <aside
    transition:fly={{ x: 380, duration: 220 }}
    class="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-105 bg-surface border-l border-outline-variant/40 shadow-2xl overflow-y-auto"
  >
    <div class="sticky top-0 bg-surface/95 backdrop-blur border-b border-outline-variant/30 px-5 py-4 flex items-start gap-3">
      <span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 {displayedStatus(mod) === 'active' ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant/50'}">
        <Papicon icon={mod.icon || 'Grid'} size={19} />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-on-surface leading-tight">{mod.name}</h2>
        <p class="text-[12px] text-on-surface-variant/70 font-mono">{mod.id}</p>
      </div>
      <button
        type="button"
        onclick={() => (selectedId = null)}
        aria-label="Fermer"
        class="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container-high flex items-center justify-center shrink-0"
      >
        <Papicon icon="Cross" size={15} />
      </button>
    </div>

    <div class="p-5 space-y-6">
      <p class="text-[13px] text-on-surface-variant leading-relaxed">{mod.description}</p>

      <div class="flex items-center justify-between gap-3 rounded-lg border {mod.lockedByPlan ? 'border-primary/25 bg-primary/5' : 'border-outline-variant/30 bg-surface-container-low'} px-4 py-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-on-surface">
            {#if mod.lockedByPlan}
              Offre {planLabel(mod.requiredPlan)}
            {:else if mod.isFixed}
              Toujours actif
            {:else if displayedStatus(mod) === 'active'}
              Actif
            {:else}
              Inactif
            {/if}
          </p>
          <p class="text-[12px] text-on-surface-variant/70">
            {#if mod.lockedByPlan}
              Ce module n'est pas compris dans l'offre actuelle du serveur.
            {:else if mod.isFixed}
              Module du cœur : il ne peut pas être désactivé.
            {:else if (mod.blockedBy?.length ?? 0) > 0}
              Bloqué par {mod.blockedBy!.map(nameOf).join(', ')}.
            {:else if displayedStatus(mod) === 'active'}
              Commandes, événements et page de configuration disponibles.
            {:else}
              Commandes refusées, événements ignorés, page inaccessible.
            {/if}
          </p>
        </div>
        {#if mod.lockedByPlan}
          <a
            href="/billing"
            class="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[13px] font-medium text-on-primary bg-primary hover:opacity-90 transition-opacity shrink-0"
          >
            Voir les offres <Papicon icon="ArrowRight" size={12} />
          </a>
        {:else}
          <ToggleSwitch
            checked={displayedStatus(mod) === 'active'}
            disabled={mod.isFixed || !canConfigureModule(mod.id)}
            ariaLabel={`Activer ou désactiver ${mod.name}`}
            onToggle={() => toggleModule(mod)}
          />
        {/if}
      </div>

      {#if (mod.requires?.length ?? 0) > 0}
        <div class="space-y-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/60">Nécessite</h3>
          <ul class="space-y-1.5">
            {#each mod.requires! as key}
              {@const dep = moduleById.get(key)}
              <li class="flex items-center gap-2 text-[13px]">
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {dep?.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                <button type="button" class="text-on-surface hover:text-primary transition-colors" onclick={() => (selectedId = key)}>
                  {nameOf(key)}
                </button>
                {#if dep?.status !== 'active'}
                  <span class="text-[11px] text-amber-600">inactif</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if (mod.dependents?.length ?? 0) > 0}
        <div class="space-y-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/60">
            S'arrête avec ce module
          </h3>
          <ul class="space-y-1.5">
            {#each mod.dependents! as key}
              <li class="flex items-center gap-2 text-[13px]">
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {moduleById.get(key)?.status === 'active' ? 'bg-emerald-500' : 'bg-on-surface-variant/30'}"></span>
                <button type="button" class="text-on-surface hover:text-primary transition-colors" onclick={() => (selectedId = key)}>
                  {nameOf(key)}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if mod.settingsPath}
        <a
          href={mod.settingsPath}
          class="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-on-surface hover:border-primary/40 hover:text-primary transition-colors"
        >
          <span>Ouvrir la configuration détaillée</span>
          <Papicon icon="ArrowRight" size={14} />
        </a>
      {/if}

      {#if !mod.isFixed && canConfigureModule(mod.id)}
        <div class="pt-2 border-t border-outline-variant/20">
          <RolePermissionSettings
            featureKey={mod.id}
            title="Accès par rôle"
            description="Qui peut consulter, modérer et configurer ce module depuis le dashboard."
          />
        </div>
      {/if}
    </div>
  </aside>
{/if}
