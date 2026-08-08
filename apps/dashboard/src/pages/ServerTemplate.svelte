<script lang="ts">
  import { onMount } from 'svelte';
  import ModulePage from '../lib/components/ModulePage.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import Skeleton from '../lib/components/Skeleton.svelte';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import { toast } from '../lib/stores/toast.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import {
    fetchServerTemplate,
    applyServerTemplate,
    type ServerTemplatePlanItem,
    type ServerTemplateSection,
    type ServerTemplateState,
  } from '../lib/api';
  import { m } from '../lib/i18n';

  let loading = $state(true);
  let loadError = $state('');
  let template = $state<ServerTemplateState | null>(null);
  let selection = $state(new Set<string>());

  const applyAction = createAsyncActionState();

  // La section captcha n'a pas sa place ici : elle se coche d'un bloc depuis le
  // choix de verification, plus bas.
  const SECTION_ORDER: ServerTemplateSection[] = ['access', 'staff', 'captcha', 'tickets', 'welcome', 'text', 'bots', 'voice'];
  const TREE_SECTIONS = SECTION_ORDER.filter((id) => id !== 'captcha');

  const SECTION_LABELS: Record<ServerTemplateSection, () => string> = {
    access: m.st_section_access,
    staff: m.st_section_staff,
    captcha: m.st_section_captcha,
    tickets: m.st_section_tickets,
    welcome: m.st_section_welcome,
    text: m.st_section_text,
    bots: m.st_section_bots,
    voice: m.st_section_voice,
    modules: m.st_section_modules,
  };

  const WIRING_LABELS: Record<string, () => string> = {
    staff: m.st_wiring_staff,
    logs: m.st_wiring_logs,
    tickets: m.st_wiring_tickets,
    leveling: m.st_wiring_leveling,
    rpg: m.st_wiring_rpg,
    tempvoice: m.st_wiring_tempvoice,
    welcome: m.st_wiring_welcome,
    rules: m.st_wiring_rules,
    member: m.st_wiring_member,
    captcha: m.st_wiring_captcha,
  };

  /** A qui le salon s'ouvre, tout le plan etant ferme a @everyone. */
  const AUDIENCE_LABELS: Record<string, () => string> = {
    staff: m.st_audience_staff,
    member: m.st_audience_member,
    pending: m.st_audience_pending,
    everyone: m.st_audience_everyone,
  };

  /** Nom et role de chaque module, le service n'envoyant que son identifiant. */
  const MODULE_LABELS: Record<string, { name: () => string; desc: () => string }> = {
    tickets: { name: m.st_module_tickets, desc: m.st_module_tickets_desc },
    leveling: { name: m.st_module_leveling, desc: m.st_module_leveling_desc },
    economy: { name: m.st_module_economy, desc: m.st_module_economy_desc },
    nickname_moderation: { name: m.st_module_nickname_moderation, desc: m.st_module_nickname_moderation_desc },
    automod: { name: m.st_module_automod, desc: m.st_module_automod_desc },
    channel_health: { name: m.st_module_channel_health, desc: m.st_module_channel_health_desc },
    raid_protection: { name: m.st_verification_captcha, desc: m.st_verification_captcha_desc },
  };

  const plan = $derived(template?.plan ?? []);
  const alreadyApplied = $derived(template?.applied ?? null);
  const missingPermissions = $derived(template?.missingPermissions ?? []);

  /**
   * Les sections dans l'ordre du plan, chaque categorie portant ses salons :
   * la colonne des options et l'apercu lisent la meme structure, ils ne
   * peuvent donc pas se contredire.
   */
  const sections = $derived(
    SECTION_ORDER
      .map((id) => {
        const items = plan.filter((entry) => entry.section === id);
        return {
          id,
          label: SECTION_LABELS[id](),
          roles: items.filter((entry) => entry.kind === 'role'),
          categories: items
            .filter((entry) => entry.kind === 'category')
            .map((category) => ({
              category,
              channels: items.filter((entry) => entry.parent === category.key),
            })),
        };
      })
      .filter((section) => section.roles.length > 0 || section.categories.length > 0),
  );

  /** L'arborescence des options, captcha exclu : il a son propre bloc. */
  const treeSections = $derived(sections.filter((section) => TREE_SECTIONS.includes(section.id)));

  /** Les modules vivent hors de l'arborescence : ils ont leur propre bloc. */
  const moduleItems = $derived(plan.filter((entry) => entry.kind === 'module'));
  const selectedModules = $derived(moduleItems.filter((entry) => selection.has(entry.key)));

  const captchaItems = $derived(plan.filter((entry) => entry.section === 'captcha'));
  const captchaOn = $derived(captchaItems.some((entry) => selection.has(entry.key)));
  const memberRole = $derived(plan.find((entry) => entry.key === 'role.member') ?? null);
  // Sans role Membre, ni l'auto-role ni le captcha n'ont rien a accorder : le
  // choix de verification perd son objet.
  const hasMemberRole = $derived(selection.has('role.member'));

  const selectedCount = $derived(selection.size);
  const selectedRoles = $derived(plan.filter((entry) => entry.kind === 'role' && selection.has(entry.key)));
  // Sans le droit de creer des salons rien n'est possible. Les autres manques
  // ne concernent qu'une partie du plan : le bouton reste ouvert, et le serveur
  // tranche sur la selection reellement envoyee.
  const canApply = $derived(
    !alreadyApplied && (template?.canCreateChannels ?? false) && selectedCount > 0 && !applyAction.state.loading,
  );

  function isChecked(key: string): boolean {
    return selection.has(key);
  }

  /**
   * Une categorie n'existe que par ses salons : cocher un salon la ramene,
   * decocher le dernier l'emporte. C'est la meme regle que celle appliquee
   * cote serveur, la page ne fait que la rendre visible tout de suite.
   */
  function syncCategories(next: Set<string>): Set<string> {
    for (const section of sections) {
      for (const { category, channels } of section.categories) {
        const hasChannel = channels.some((channel) => next.has(channel.key));
        if (hasChannel) next.add(category.key);
        else next.delete(category.key);
      }
    }
    return next;
  }

  /** Les elements indispensables suivent leur section, ils ne se decochent pas seuls. */
  function syncRequired(next: Set<string>): Set<string> {
    for (const section of sections) {
      const sectionKeys = plan.filter((entry) => entry.section === section.id);
      const active = sectionKeys.some((entry) => next.has(entry.key));
      for (const entry of sectionKeys) {
        if (!entry.required) continue;
        if (active) next.add(entry.key);
        else next.delete(entry.key);
      }
    }
    return next;
  }

  /**
   * Cocher un salon coche le module qui s'en sert : poser un salon de niveaux
   * sans allumer le leveling ne produirait rien.
   *
   * Le lien ne joue qu'a l'allumage, et seulement au moment ou le salon arrive
   * dans la selection. Decocher le salon ne coupe pas le module - il se tient
   * tres bien sans salon dedie - et une fois le module decoche a la main, il le
   * reste : sans cette comparaison avec l'etat precedent, la case se serait
   * recochee toute seule au clic suivant.
   */
  function syncLinkedModules(previous: Set<string>, next: Set<string>): Set<string> {
    for (const entry of moduleItems) {
      if (!entry.linkedTo) continue;
      if (next.has(entry.linkedTo) && !previous.has(entry.linkedTo)) next.add(entry.key);
    }
    return next;
  }

  /**
   * Un element retenu ramene ce sans quoi il ne fonctionne pas. Le lien
   * traverse les sections, la ou `required` ne vaut qu'a l'interieur de l'une
   * d'elles : le captcha n'a rien a accorder sans le role Membre.
   */
  function syncDependencies(next: Set<string>): Set<string> {
    for (const entry of plan) {
      if (entry.dependsOn && next.has(entry.key)) next.add(entry.dependsOn);
    }
    return next;
  }

  /**
   * `linkModules` a false quand la selection vient d'ailleurs que d'un clic -
   * celle enregistree lors d'une mise en place passee, par exemple. Elle fait
   * alors foi telle quelle : la liaison recocherait un module que l'admin avait
   * justement decoche.
   */
  function commit(next: Set<string>, linkModules = true): void {
    const synced = syncCategories(syncDependencies(syncRequired(next)));
    selection = linkModules ? syncLinkedModules(selection, synced) : synced;
  }

  /** Le captcha se prend ou se laisse d'un bloc : a moitie, il ne verifie rien. */
  function setCaptcha(on: boolean): void {
    const next = new Set(selection);
    for (const entry of captchaItems) {
      if (on) next.add(entry.key);
      else next.delete(entry.key);
    }
    commit(next);
  }

  function toggleItem(item: ServerTemplatePlanItem): void {
    if (item.required && selection.has(item.key)) {
      // Decocher la seule piece indispensable revient a retirer la section :
      // c'est ce que fait le clic, plutot que de ne rien faire sans explication.
      const next = new Set(selection);
      for (const entry of plan) {
        if (entry.section === item.section) next.delete(entry.key);
      }
      commit(next);
      return;
    }

    const next = new Set(selection);
    if (next.has(item.key)) next.delete(item.key);
    else next.add(item.key);
    commit(next);
  }

  function toggleCategory(categoryKey: string, channels: ServerTemplatePlanItem[]): void {
    const next = new Set(selection);
    const allOn = channels.every((channel) => next.has(channel.key));
    for (const channel of channels) {
      if (allOn) next.delete(channel.key);
      else next.add(channel.key);
    }
    if (allOn) next.delete(categoryKey);
    commit(next);
  }

  function toggleSection(sectionId: ServerTemplateSection): void {
    const entries = plan.filter((entry) => entry.section === sectionId);
    const allOn = entries.every((entry) => selection.has(entry.key));
    const next = new Set(selection);
    for (const entry of entries) {
      if (allOn) next.delete(entry.key);
      else next.add(entry.key);
    }
    commit(next);
  }

  function selectAll(): void {
    commit(new Set(plan.map((entry) => entry.key)));
  }

  function selectNone(): void {
    selection = new Set();
  }

  function resetSelection(): void {
    commit(new Set(template?.defaultSelection ?? []));
  }

  function sectionState(sectionId: ServerTemplateSection): 'all' | 'some' | 'none' {
    const entries = plan.filter((entry) => entry.section === sectionId);
    const checked = entries.filter((entry) => selection.has(entry.key)).length;
    if (checked === 0) return 'none';
    return checked === entries.length ? 'all' : 'some';
  }

  function wiringLabel(item: ServerTemplatePlanItem): string | null {
    return item.wiring ? WIRING_LABELS[item.wiring]?.() ?? null : null;
  }

  /** Qui voit le salon, et s'il peut y ecrire : le tout en une infobulle. */
  function accessLabel(item: ServerTemplatePlanItem): string {
    const parts = [AUDIENCE_LABELS[item.audience]?.()].filter(Boolean) as string[];
    if (item.readOnly) parts.push(m.st_readonly());
    return parts.join(' · ');
  }

  /** Rien a signaler sur un salon ouvert a tous ou chacun peut parler. */
  function accessIcon(item: ServerTemplatePlanItem): string | null {
    if (item.audience !== 'everyone') return 'Lock';
    return item.readOnly ? 'Eye' : null;
  }

  /** Repli sur le nom envoye par le service pour un module ajoute au plan sans traduction. */
  function moduleName(item: ServerTemplatePlanItem): string {
    return (item.moduleId && MODULE_LABELS[item.moduleId]?.name()) || item.name;
  }

  function moduleDesc(item: ServerTemplatePlanItem): string | null {
    return (item.moduleId && MODULE_LABELS[item.moduleId]?.desc()) || null;
  }

  /** Nom du salon qui a fait cocher ce module, quand il est bien retenu. */
  function moduleLinkName(item: ServerTemplatePlanItem): string | null {
    if (!item.linkedTo || !selection.has(item.linkedTo)) return null;
    return plan.find((entry) => entry.key === item.linkedTo)?.name ?? null;
  }

  /**
   * Module retenu mais prive du salon ou il devait s'exprimer. Ne vaut que
   * pour la sante des salons : elle est la seule a n'avoir aucun repli une fois
   * son salon de logs ecarte, les autres se passent tres bien de salon dedie.
   *
   * Le repli sur un salon de logs deja configure est verifie cote serveur : sans
   * cela la page crierait au loup sur un serveur parfaitement equipe.
   */
  function isModuleMuted(item: ServerTemplatePlanItem): boolean {
    if (item.moduleId !== 'channel_health') return false;
    if (!selection.has(item.key)) return false;
    return !selection.has('staff.log') && !(template?.hasLogChannel ?? false);
  }

  function toggleAllModules(): void {
    const allOn = moduleItems.every((entry) => selection.has(entry.key));
    const next = new Set(selection);
    for (const entry of moduleItems) {
      if (allOn) next.delete(entry.key);
      else next.add(entry.key);
    }
    // `commit` ne recochera rien : la liaison ne joue qu'au moment ou un salon
    // entre dans la selection, et ce bouton n'y touche pas.
    commit(next);
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const data = await fetchServerTemplate();
      template = data;
      // Une mise en place deja faite est rendue telle qu'elle a ete lancee :
      // l'admin doit retrouver ce qu'il avait coche, pas la maquette complete.
      commit(new Set(data?.applied?.selection?.length ? data.applied.selection : data?.defaultSelection ?? []), false);
    } catch (err) {
      loadError = err instanceof Error ? err.message : m.st_err_load();
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function handleApply() {
    if (!canApply) return;
    // Les modules changent le comportement du bot pour tout le serveur : ils
    // sont annonces a part, et non noyes dans le compte des salons.
    const moduleNames = selectedModules.map((entry) => moduleName(entry)).join(', ');
    if (!(await confirmDialog.ask({
      title: m.st_confirm_title(),
      description: moduleNames
        ? `${m.st_confirm_desc({ count: selectedCount - selectedModules.length })} ${m.st_confirm_modules({ modules: moduleNames })}`
        : m.st_confirm_desc({ count: selectedCount - selectedModules.length }),
      confirmLabel: m.st_confirm_label(),
      variant: 'warning',
    }))) return;

    await applyAction.run(async () => {
      const result = await applyServerTemplate([...selection]);
      if (!result?.success) throw new Error(m.st_err_apply());

      const created = result.items.filter((entry) => entry.created).map((entry) => entry.name);
      const reused = result.items.filter((entry) => !entry.created).map((entry) => entry.name);
      toast.success(m.st_success_detail({
        created: created.join(', ') || '-',
        reused: reused.join(', ') || '-',
      }));
      if (result.modules?.length) {
        // Traduits pour l'affichage : le service ne rend que des identifiants.
        const names = result.modules.map((id) => MODULE_LABELS[id]?.name() ?? id);
        toast.success(m.st_success_modules({ modules: names.join(', ') }));
      }
      if (result.panelSent) toast.success(m.st_panel_sent());

      // Une etape facultative refusee - la synchronisation AutoMod native sans
      // « Gerer le serveur », par exemple - n'arrete pas la mise en place mais
      // ne doit pas passer inapercue : le reste a bien ete fait.
      for (const warning of result.warnings ?? []) {
        toast.error(`${m.st_warnings_title()} · ${warning}`);
      }

      // Les nouveaux salons doivent apparaitre dans les selecteurs des autres
      // pages sans passer par un rechargement complet.
      await dashboardStore.refresh();
      await load();
      return true;
    }, { successMessage: m.st_success(), failureMessage: m.st_err_apply() });
  }
</script>

<ModulePage
  title={m.st_title()}
  description={m.st_description()}
  icon="Sparkles"
>
  <InlineFeedback state={applyAction} />

  {#if loading}
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
      <Skeleton height="420px" radius="0.75rem" />
      <Skeleton height="420px" radius="0.75rem" />
    </div>

  {:else if loadError}
    <div class="flex items-center gap-3 bg-error/5 border border-error/20 rounded-xl px-5 py-4">
      <Papicon icon="AlertTriangle" size={18} class="text-error shrink-0" />
      <p class="text-sm text-on-surface">{loadError}</p>
    </div>

  {:else}
    <!-- Ce qui conditionne la mise en place, dit avant que l'admin ne coche
         quoi que ce soit : deja faite, permissions manquantes, ou langue des
         salons a venir. -->
    {#if alreadyApplied}
      <div class="flex flex-col sm:flex-row sm:items-center gap-4 bg-primary/5 border border-primary/20 rounded-xl px-6 py-5">
        <div class="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Papicon icon="Check" size={20} />
        </div>
        <div class="space-y-0.5">
          <p class="text-sm font-semibold text-on-surface">{m.st_applied_title()}</p>
          <p class="text-[13px] text-on-surface-variant/70">
            {m.st_applied_by({
              user: alreadyApplied.by ?? '-',
              date: new Date(alreadyApplied.at).toLocaleDateString(),
            })}
            {m.st_applied_hint()}
          </p>
        </div>
      </div>
    {:else if missingPermissions.length > 0}
      <div class="flex flex-col sm:flex-row sm:items-center gap-4 bg-error/5 border border-error/20 rounded-xl px-6 py-5">
        <div class="w-10 h-10 rounded-lg bg-error/10 text-error flex items-center justify-center shrink-0">
          <Papicon icon="Lock" size={20} />
        </div>
        <div class="space-y-0.5">
          <p class="text-sm font-semibold text-on-surface">{m.st_perm_missing_title()}</p>
          <p class="text-[13px] text-on-surface-variant/70">
            {m.st_perm_missing_desc({ permissions: missingPermissions.join(', ') })}
            {m.st_perm_admin_hint()}
          </p>
        </div>
      </div>
    {:else}
      <div class="flex items-center gap-3 bg-surface-container-low/30 border border-outline-variant/10 rounded-xl px-5 py-3.5">
        <Papicon icon="ShieldCheck" size={16} class="text-primary shrink-0" />
        <p class="text-[13px] text-on-surface-variant/70">
          {#if template?.isAdministrator}{m.st_perm_ok()}{/if}
          <!-- La langue des salons ne suit pas celle du dashboard mais celle du
               serveur : le dire evite la surprise d'un salon en anglais. -->
          {template?.locale === 'en' ? m.st_locale_notice_en() : m.st_locale_notice()}
        </p>
      </div>
    {/if}

    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">

      <!-- Colonne des options -->
      <section class="bg-surface-container-low/30 border border-outline-variant/10 rounded-xl overflow-hidden">
        <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-5 border-b border-outline-variant/10">
          <div class="space-y-0.5">
            <h3 class="text-base font-semibold text-on-surface">{m.st_options_title()}</h3>
            <p class="text-[13px] text-on-surface-variant/60">{m.st_options_hint()}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick={selectAll} class="px-3 py-1.5 text-[12px] font-medium rounded-lg text-on-surface-variant/70 hover:bg-surface-container-high/40 hover:text-on-surface transition-colors">
              {m.st_select_all()}
            </button>
            <button type="button" onclick={selectNone} class="px-3 py-1.5 text-[12px] font-medium rounded-lg text-on-surface-variant/70 hover:bg-surface-container-high/40 hover:text-on-surface transition-colors">
              {m.st_select_none()}
            </button>
            <button type="button" onclick={resetSelection} class="px-3 py-1.5 text-[12px] font-medium rounded-lg text-primary hover:bg-primary/10 transition-colors">
              {m.st_reset_selection()}
            </button>
          </div>
        </header>

        <div class="divide-y divide-outline-variant/10">
          {#each treeSections as section (section.id)}
            {@const status = sectionState(section.id)}
            <div class="px-6 py-5 space-y-3">
              <button
                type="button"
                onclick={() => toggleSection(section.id)}
                class="flex items-center gap-3 w-full text-left group"
              >
                <span class="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors {status === 'all' ? 'bg-primary border-primary text-on-primary' : status === 'some' ? 'border-primary text-primary' : 'border-outline-variant/40 text-transparent group-hover:border-outline-variant'}">
                  {#if status === 'all'}
                    <Papicon icon="Check" size={12} />
                  {:else if status === 'some'}
                    <span class="w-2 h-0.5 rounded-full bg-primary"></span>
                  {/if}
                </span>
                <span class="text-sm font-semibold text-on-surface">{section.label}</span>
              </button>

              <div class="pl-8 space-y-2.5">
                {#each section.roles as role (role.key)}
                  {@render optionRow(role, m.st_roles_title())}
                {/each}

                {#each section.categories as group (group.category.key)}
                  <div class="space-y-2">
                    <button
                      type="button"
                      onclick={() => toggleCategory(group.category.key, group.channels)}
                      class="flex items-center gap-2.5 w-full text-left group"
                    >
                      <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors {isChecked(group.category.key) ? 'bg-primary/80 border-primary/80 text-on-primary' : 'border-outline-variant/40 text-transparent group-hover:border-outline-variant'}">
                        <Papicon icon="Check" size={10} />
                      </span>
                      <span class="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                        {group.category.name}
                      </span>
                    </button>

                    <div class="pl-6 space-y-1.5">
                      {#each group.channels as channel (channel.key)}
                        {@render optionRow(channel, null)}
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}

          <!-- Qui reçoit le rôle Membre, et quand. Un choix, pas deux cases :
               l'auto-rôle donne le rôle à l'arrivée, ce que le captcha existe
               précisément pour empêcher. -->
          {#if captchaItems.length > 0}
            <div class="px-6 py-5 space-y-3">
              <div class="space-y-0.5">
                <h4 class="text-sm font-semibold text-on-surface">{m.st_verification_title()}</h4>
                <p class="text-[12px] text-on-surface-variant/60">
                  {m.st_verification_hint({ role: `@${memberRole?.name ?? '-'}` })}
                </p>
              </div>

              <div class="grid sm:grid-cols-2 gap-2">
                {@render verificationChoice(false, m.st_verification_autorole(), m.st_verification_autorole_desc())}
                {@render verificationChoice(true, m.st_verification_captcha(), m.st_verification_captcha_desc())}
              </div>

              {#if captchaOn}
                <ul class="pl-1 space-y-1">
                  {#each captchaItems as entry (entry.key)}
                    <li class="flex items-center gap-1.5 text-[12px] text-on-surface-variant/60">
                      <Papicon
                        icon={entry.kind === 'voice' ? 'Mic' : entry.kind === 'role' ? 'Shield' : entry.kind === 'category' ? 'ChevronDown' : 'Hash'}
                        size={11}
                        class="shrink-0 opacity-40"
                      />
                      {entry.kind === 'role' ? `@${entry.name}` : entry.name}
                    </li>
                  {/each}
                </ul>
                <p class="flex items-start gap-2 text-[12px] text-on-surface-variant/60">
                  <Papicon icon="Info" size={13} class="shrink-0 mt-0.5 opacity-60" />
                  {m.st_verification_captcha_notice()}
                </p>
              {/if}

              {#if !hasMemberRole}
                <p class="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                  <Papicon icon="AlertTriangle" size={12} class="shrink-0 mt-0.5" />
                  {m.st_verification_no_role()}
                </p>
              {/if}
            </div>
          {/if}

          <!-- Les modules ne sont pas des salons : ils ont leur propre bloc,
               avec ce que chacun allume et pourquoi il est deja coche. -->
          {#if moduleItems.length > 0}
            {@const allModulesOn = moduleItems.every((entry) => selection.has(entry.key))}
            <div class="px-6 py-5 space-y-3 bg-surface-container-low/20">
              <button
                type="button"
                onclick={toggleAllModules}
                class="flex items-center gap-3 w-full text-left group"
              >
                <span class="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors {allModulesOn ? 'bg-primary border-primary text-on-primary' : selectedModules.length > 0 ? 'border-primary text-primary' : 'border-outline-variant/40 text-transparent group-hover:border-outline-variant'}">
                  {#if allModulesOn}
                    <Papicon icon="Check" size={12} />
                  {:else if selectedModules.length > 0}
                    <span class="w-2 h-0.5 rounded-full bg-primary"></span>
                  {/if}
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-on-surface">{m.st_modules_title()}</span>
                  <span class="block text-[12px] text-on-surface-variant/60">{m.st_modules_hint()}</span>
                </span>
              </button>

              <div class="pl-8 space-y-2">
                {#each moduleItems as mod (mod.key)}
                  {@const linkName = moduleLinkName(mod)}
                  {@const desc = moduleDesc(mod)}
                  <button
                    type="button"
                    onclick={() => toggleItem(mod)}
                    class="flex items-start gap-2.5 w-full text-left group"
                  >
                    <span class="mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors {isChecked(mod.key) ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant/40 text-transparent group-hover:border-outline-variant'}">
                      <Papicon icon="Check" size={10} />
                    </span>
                    <span class="min-w-0 space-y-0.5">
                      <span class="flex items-center gap-1.5 text-[13px] font-medium text-on-surface">
                        <Papicon icon="Package" size={12} class="shrink-0 opacity-40" />
                        {moduleName(mod)}
                      </span>
                      {#if desc}
                        <span class="block text-[12px] text-on-surface-variant/55">{desc}</span>
                      {/if}
                      {#if linkName}
                        <span class="block text-[12px] text-primary/80">{m.st_module_linked({ channel: `#${linkName}` })}</span>
                      {/if}
                      {#if isModuleMuted(mod)}
                        <span class="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                          <Papicon icon="AlertTriangle" size={12} class="shrink-0 mt-0.5" />
                          {m.st_module_muted()}
                        </span>
                      {/if}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </section>

      <!-- Previsualisation : la colonne de salons telle que Discord l'affiche -->
      <aside class="lg:sticky lg:top-6 space-y-4">
        <div class="space-y-0.5 px-1">
          <h3 class="text-base font-semibold text-on-surface">{m.st_preview_title()}</h3>
          <p class="text-[13px] text-on-surface-variant/60">{m.st_preview_hint()}</p>
        </div>

        <div class="rounded-xl border border-outline-variant/15 bg-surface-container-high/30 p-3 space-y-3 min-h-[200px]">
          {#if selectedCount === 0}
            <p class="text-[13px] text-on-surface-variant/50 text-center py-10">{m.st_empty_selection()}</p>
          {:else}
            {#each sections as section (section.id)}
              {#each section.categories as group (group.category.key)}
                {@const visible = group.channels.filter((channel) => isChecked(channel.key))}
                {#if visible.length > 0}
                  <div class="space-y-0.5">
                    <p class="flex items-center gap-1 px-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/45">
                      <Papicon icon="ChevronDown" size={10} />
                      {group.category.name}
                    </p>
                    {#each visible as channel (channel.key)}
                      {@const icon = accessIcon(channel)}
                      <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-on-surface-variant/70 hover:bg-surface-container-highest/40 transition-colors">
                        <Papicon icon={channel.kind === 'voice' ? 'Mic' : 'Hash'} size={13} class="shrink-0 opacity-60" />
                        <span class="text-[13px] font-medium truncate">{channel.name}</span>
                        {#if icon}
                          <span class="shrink-0 ml-auto opacity-40" title={accessLabel(channel)}>
                            <Papicon {icon} size={11} />
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            {/each}

            {#if selectedRoles.length > 0}
              <div class="space-y-0.5 pt-2 border-t border-outline-variant/10">
                <p class="px-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/45">
                  {m.st_roles_title()}
                </p>
                {#each selectedRoles as role (role.key)}
                  <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-on-surface-variant/70">
                    <Papicon icon="Shield" size={13} class="shrink-0 opacity-60" />
                    <span class="text-[13px] font-medium truncate">@{role.name}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if selectedModules.length > 0}
              <div class="space-y-0.5 pt-2 border-t border-outline-variant/10">
                <p class="px-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/45">
                  {m.st_section_modules()}
                </p>
                {#each selectedModules as mod (mod.key)}
                  <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-on-surface-variant/70">
                    <Papicon icon="Package" size={13} class="shrink-0 opacity-60" />
                    <span class="text-[13px] font-medium truncate">{moduleName(mod)}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        <!-- Le seul element du plan qui demande une suite : le dire ici evite
             qu'on cherche son reglement dans un salon reste vide. -->
        {#if isChecked('welcome.rules')}
          <p class="flex items-start gap-2 px-1 text-[12px] text-on-surface-variant/60">
            <Papicon icon="Info" size={13} class="shrink-0 mt-0.5 opacity-60" />
            {m.st_rules_notice()}
          </p>
        {/if}

        <button
          type="button"
          onclick={handleApply}
          disabled={!canApply}
          class="w-full px-6 py-3.5 bg-primary hover:bg-primary/90 text-on-primary text-sm font-medium rounded-lg shadow-md shadow-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
        >
          <Papicon icon="Sparkles" size={16} />
          {applyAction.state.loading ? m.st_applying() : m.st_apply()}
        </button>
        <p class="text-center text-[12px] text-on-surface-variant/50">
          {m.st_count({ count: selectedCount - selectedModules.length })}
          {#if selectedModules.length > 0}
            · {m.st_modules_count({ count: selectedModules.length })}
          {/if}
        </p>
      </aside>
    </div>
  {/if}
</ModulePage>

{#snippet verificationChoice(on: boolean, name: string, desc: string)}
  {@const active = captchaOn === on}
  <button
    type="button"
    onclick={() => setCaptcha(on)}
    class="flex items-start gap-2.5 text-left px-3.5 py-3 rounded-lg border transition-colors {active ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:border-outline-variant/40'}"
  >
    <span class="mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 {active ? 'border-primary' : 'border-outline-variant/40'}">
      {#if active}<span class="w-2 h-2 rounded-full bg-primary"></span>{/if}
    </span>
    <span class="min-w-0 space-y-0.5">
      <span class="block text-[13px] font-medium text-on-surface">{name}</span>
      <span class="block text-[12px] text-on-surface-variant/55">{desc}</span>
    </span>
  </button>
{/snippet}

{#snippet optionRow(item: ServerTemplatePlanItem, heading: string | null)}
  {@const wiring = wiringLabel(item)}
  {@const icon = accessIcon(item)}
  <div class="space-y-1.5">
    {#if heading}
      <p class="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">{heading}</p>
    {/if}
    <button
      type="button"
      onclick={() => toggleItem(item)}
      class="flex items-start gap-2.5 w-full text-left group"
      title={item.required ? m.st_locked_item() : ''}
    >
      <span class="mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors {isChecked(item.key) ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant/40 text-transparent group-hover:border-outline-variant'}">
        <Papicon icon="Check" size={10} />
      </span>
      <span class="min-w-0 space-y-0.5">
        <span class="flex items-center gap-1.5 text-[13px] font-medium text-on-surface">
          <Papicon
            icon={item.kind === 'voice' ? 'Mic' : item.kind === 'role' ? 'Shield' : 'Hash'}
            size={12}
            class="shrink-0 opacity-40"
          />
          {item.kind === 'role' ? `@${item.name}` : item.name}
          {#if item.kind !== 'role' && icon}
            <span class="shrink-0 opacity-40" title={accessLabel(item)}>
              <Papicon {icon} size={10} />
            </span>
          {/if}
        </span>
        {#if wiring}
          <span class="block text-[12px] text-on-surface-variant/55">{wiring}</span>
        {/if}
      </span>
    </button>
  </div>
{/snippet}
