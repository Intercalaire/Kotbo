<script lang="ts">
  import { m } from '../lib/i18n';
  import { channelDisplayName } from '../lib/channelUtils';
  import { onMount } from 'svelte';
  import { useUnsavedChanges } from '../lib/useUnsavedChanges.svelte';
  import { authStore } from '../lib/stores/auth.svelte';
  import { dashboardStore } from '../lib/stores/dashboard.svelte';
  import { confirmDialog } from '../lib/stores/confirmDialog.svelte';
  import {
    createAbsence,
    updateAbsenceStatus,
    deleteAbsence,
    fetchStaffMembers,
    fetchStaffRoles,
    fetchStaffCalendarData,
    fetchAbsenceConfig,
    updateAbsenceConfig,
    createMeeting,
  } from '../lib/api';
  import { createAsyncActionState } from '../lib/asyncAction.svelte';
  import RefreshButton from '../lib/components/RefreshButton.svelte';
  import ActionButton from '../lib/components/ActionButton.svelte';
  import Papicon from '../lib/components/Papicon.svelte';
  import LoadingHint from '../lib/components/LoadingHint.svelte';
  import Calendar from '../lib/components/Calendar.svelte';
  import AbsenceModal from '../lib/components/AbsenceModal.svelte';
  import CalendarEventModal from '../lib/components/CalendarEventModal.svelte';
  import ToggleSwitch from '../lib/components/ToggleSwitch.svelte';
  import InlineFeedback from '../lib/components/InlineFeedback.svelte';
  import SearchableSelect from '../lib/components/SearchableSelect.svelte';
  import { localInitialAvatar } from '../lib/discordMedia';

  const absences = $state<any[]>([]);
  let allStaff = $state<any[]>([]);
  let allRoles = $state<any[]>([]);
  let calendarData = $state<{ absences: any[], voiceSessions: any[], meetings?: any[] }>({ absences: [], voiceSessions: [] });
  let absenceConfig = $state<any>(null);
  let loading = $state(true);
  const saveAction = createAsyncActionState();
  let loadingConfig = $state(false);
  
  // Webhook / Channel settings states
  let webhookUrl = $state('');
  let channelId = $state('');
  let notificationRoleId = $state('');
  let notifyViaDiscordChannel = $state(true);
  let managerRoleLevels = $state<number[]>([]);

  // Selection states
  let selectedStaffIds = $state<string[]>([]);
  let visibleTypes = $state<string[]>(['absence', 'meeting']);

  // Modal states
  let modalOpen = $state(false);
  let selectedDate = $state(new Date());
  let selectedEndDate = $state<Date | null>(null);

  // Decision Modal State
  let decisionModalOpen = $state(false);
  let selectedAbsenceForDecision = $state<any>(null);
  let decisionStatus = $state<'APPROVED' | 'REJECTED'>('APPROVED');
  let decisionNote = $state('');
  let decisionSaving = $state(false);

  // Detail Modal State
  let detailModalOpen = $state(false);
  let selectedEvent = $state<any>(null);

  const isAdmin = $derived(authStore.guilds.find(g => g.id === authStore.selectedGuildId)?.accessLevel === 'admin');
  const isManager = $derived(isAdmin || (absenceConfig?.roleAccess?.some((ra: any) => ra.canModerate) ?? false));

  const myStaffRecord = $derived(allStaff.find(s => s.userId === (authStore.user as any)?.id));

  // Exclure les membres actuellement blacklistés du planning
  const activeStaff = $derived(allStaff.filter(s => !s.blacklistEntries || s.blacklistEntries.length === 0));
  
  const eligibleSuperiors = $derived.by(() => {
    if (!myStaffRecord || allRoles.length === 0) return [];
    
    const myRole = allRoles.find(r => r.name === myStaffRecord.grade);
    if (!myRole) return activeStaff; 
    
    return activeStaff.filter(s => {
      // Ne pas s'inclure soi-même
      if (s.userId === (authStore.user as any)?.id) return false;
      
      // Ne pas inclure les personnes en tutorat (période de test en cours)
      if (s.testingPeriods && s.testingPeriods.length > 0) return false;

      const sRole = allRoles.find(r => r.name === s.grade);
      if (!sRole) return false;
      
      // Responsable de grade supérieur ou égal (plus grand ou égal sortOrder)
      return (sRole.sortOrder ?? 0) >= (myRole.sortOrder ?? 0);
    }).sort((a, b) => {
       const roleA = allRoles.find(r => r.name === a.grade);
       const roleB = allRoles.find(r => r.name === b.grade);
       return (roleB?.sortOrder ?? 0) - (roleA?.sortOrder ?? 0);
    });
  });

  async function loadInitialData() {
    loading = true;
    loadingConfig = true;
    try {
      const [membersData, rolesData, configData] = await Promise.all([
        fetchStaffMembers(),
        fetchStaffRoles(),
        fetchAbsenceConfig().catch(() => null)
      ]);
      
      allStaff = membersData.members || [];
      allRoles = rolesData.roles || [];
      applyAbsenceConfig(configData?.config || null);

      // Default selection: just me
      if (myStaffRecord) {
        selectedStaffIds = [myStaffRecord.id];
      }

      await refreshCalendar();
    } catch (e) {
      console.error('Failed to fetch initial data:', e);
    } finally {
      loading = false;
      loadingConfig = false;
    }
  }

  let savedWebhookUrl = $state('');
  let savedChannelId = $state('');
  let savedNotificationRoleId = $state('');
  let savedNotifyViaDiscordChannel = $state(true);
  let savedManagerRoleLevels = $state<number[]>([]);

  function applyAbsenceConfig(config: any) {
    absenceConfig = config;

    const nextWebhookUrl = config?.metadata?.webhookUrl || '';
    const nextChannelId = config?.channelId || '';
    const nextNotificationRoleId = config?.notificationRoleId || '';
    const nextNotifyViaDiscordChannel = config?.notifyViaDiscordChannel !== false;
    const nextManagerRoleLevels = config?.roleAccess?.map((ra: any) => ra.staffRoleLevel) || [];

    webhookUrl = nextWebhookUrl;
    channelId = nextChannelId;
    notificationRoleId = nextNotificationRoleId;
    notifyViaDiscordChannel = nextNotifyViaDiscordChannel;
    managerRoleLevels = [...nextManagerRoleLevels];

    savedWebhookUrl = nextWebhookUrl;
    savedChannelId = nextChannelId;
    savedNotificationRoleId = nextNotificationRoleId;
    savedNotifyViaDiscordChannel = nextNotifyViaDiscordChannel;
    savedManagerRoleLevels = [...nextManagerRoleLevels];
  }

  const currentConfig = $derived({
    webhookUrl,
    channelId,
    notificationRoleId,
    notifyViaDiscordChannel,
    managerRoleLevels
  });

  const savedConfig = $derived({
    webhookUrl: savedWebhookUrl,
    channelId: savedChannelId,
    notificationRoleId: savedNotificationRoleId,
    notifyViaDiscordChannel: savedNotifyViaDiscordChannel,
    managerRoleLevels: savedManagerRoleLevels
  });

  useUnsavedChanges({
    label: m.bsn_absences_configuration(),
    getConfig: () => currentConfig,
    getSaved: () => savedConfig,
    onSave: () => saveConfig(),
    onReset: () => {
      webhookUrl = savedWebhookUrl;
      channelId = savedChannelId;
      notificationRoleId = savedNotificationRoleId;
      notifyViaDiscordChannel = savedNotifyViaDiscordChannel;
      managerRoleLevels = [...savedManagerRoleLevels];
    },
    canEdit: () => isAdmin && absenceConfig !== null
  });

  const availableChannels = $derived(dashboardStore.state.discordChannels || []);
  const availableRoles = $derived(dashboardStore.state.discordRoles || []);

  async function saveConfig(): Promise<boolean> {
    if (!isAdmin) return false;
    let success = false;
    await saveAction.run(
      async () => {
        const payload = {
          managerRoleLevels,
          webhookUrl: webhookUrl.trim() || null,
          channelId: channelId || null,
          notificationRoleId: notificationRoleId || null,
          notifyViaDiscordChannel,
        };
        const ok = await updateAbsenceConfig(payload);
        if (ok) {
          const configData = await fetchAbsenceConfig().catch(() => null);
          applyAbsenceConfig(configData?.config || null);
          success = true;
        }
        return ok;
      },
      {
        successMessage: m.bsn_updated_absence_notification_c(),
        failureMessage: m.bsn_error_updating_configuration()
      }
    );
    return success;
  }

  let currentRangeStart = new Date();
  let currentRangeEnd = new Date();

  async function refreshCalendar() {
    try {
      const data = await fetchStaffCalendarData(currentRangeStart, currentRangeEnd, selectedStaffIds);
      calendarData = data;
    } catch (e) {
      console.error('Failed to fetch calendar data:', e);
    }
  }

  async function handleRangeChange(start: Date, end: Date) {
    currentRangeStart = start;
    currentRangeEnd = end;
    await refreshCalendar();
  }

  onMount(loadInitialData);

  function toggleType(type: string) {
    if (visibleTypes.includes(type)) {
      visibleTypes = visibleTypes.filter(t => t !== type);
    } else {
      visibleTypes = [...visibleTypes, type];
    }
  }

  const calendarEvents = $derived.by(() => {
    const events: any[] = [];

    // Map absences
    if (visibleTypes.includes('absence')) {
      calendarData.absences.forEach(abs => {
        const start = new Date(abs.startDate);
        const end = abs.endDate ? new Date(abs.endDate) : (abs.isIndefinite ? new Date(2100, 0, 1) : start);
        const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        
        events.push({
          id: abs.id,
          title: `${abs.type}: ${abs.reason}`,
          start,
          end,
          type: 'absence',
          // If it's indefinite or longer than 12h, consider it all-day
          isAllDay: abs.isIndefinite || durationHours >= 12,
          staffName: abs.staffMember?.username || abs.staffMember?.displayName,
          avatarUrl: abs.staffMember?.avatarUrl,
          status: abs.status,
          originalData: abs,
          raw: abs
        });
      });
    }

    // Map voice sessions
    if (visibleTypes.includes('vocal')) {
      calendarData.voiceSessions.forEach(vs => {
        events.push({
          id: vs.id,
          title: vs.channelName || 'Vocal',
          start: new Date(vs.joinedAt),
          end: vs.leftAt ? new Date(vs.leftAt) : new Date(),
          type: 'vocal',
          staffName: vs.staffMember?.displayName || vs.staffMember?.username,
          avatarUrl: vs.staffMember?.avatarUrl,
          details: vs.channelName || 'Salon inconnu',
          raw: vs
        });
      });
    }

    // Map meetings
    if (visibleTypes.includes('meeting') && calendarData.meetings) {
      calendarData.meetings.forEach((m: any) => {
        events.push({
          id: m.id,
          title: `Réunion: ${m.title}`,
          start: new Date(m.scheduledAt),
          end: new Date(new Date(m.scheduledAt).getTime() + 3600000), // Default 1h
          type: 'meeting',
          isAllDay: false,
          details: m.description,
          raw: m
        });
      });
    }

    return events;
  });

  async function handleSaveAbsence(data: any) {
    if (!myStaffRecord) {
      throw new Error(m.bsn_you_are_not_registered_as_a_st());
    }

    try {
      if (data.type === m.bsn_meeting()) {
        if (!isAdmin) throw new Error(m.bsn_only_admins_can_create_meeting());
        const start = data.startDate.toISOString();
        const end = data.endDate ? data.endDate.toISOString() : undefined;
        await createMeeting(data.reason, '', start, end);
      } else {
        await createAbsence({
          ...data,
          staffUserId: myStaffRecord.userId,
          reason: data.reason.trim(),
        });
      }
      modalOpen = false;
      await refreshCalendar();
    } catch (e) {
      console.error('Failed to save:', e);
      throw e;
    }
  }

  function handleEventClick(event: any) {
    selectedEvent = event;
    detailModalOpen = true;
  }

  async function confirmDecision() {
    if (!selectedAbsenceForDecision) return;
    decisionSaving = true;
    try {
      await updateAbsenceStatus(selectedAbsenceForDecision.id, decisionStatus, decisionNote);
      decisionModalOpen = false;
      await refreshCalendar();
    } catch (e) {
      console.error('Failed to update status:', e);
    } finally {
      decisionSaving = false;
    }
  }

  function toggleStaff(staffId: string) {
    if (selectedStaffIds.includes(staffId)) {
      selectedStaffIds = selectedStaffIds.filter(id => id !== staffId);
    } else {
      selectedStaffIds = [...selectedStaffIds, staffId];
    }
    refreshCalendar();
  }

  function toggleEveryone() {
    if (selectedStaffIds.length === activeStaff.length) {
      selectedStaffIds = [];
    } else {
      selectedStaffIds = activeStaff.map(s => s.id);
    }
    refreshCalendar();
  }

  import ModulePage from '../lib/components/ModulePage.svelte';
  import RolePermissionSettings from '../lib/components/RolePermissionSettings.svelte';
</script>

<ModulePage 
  title={m.bsn_absences_planning()} 
  description={m.bsn_manage_your_leave_and_view_tea()} 
  icon="calendar"
  featureKey="absences"
>
  {#snippet actions()}
    <RefreshButton onClick={refreshCalendar} loading={loading} label="Actualiser" />
    <ActionButton 
      onClick={() => modalOpen = true} 
      variant="primary" 
      icon="plus" 
      label={m.bsn_report_an_absence()} 
      disabled={absenceConfig?.status === 'inactive'}
    />
  {/snippet}

  {#if isAdmin || isManager}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
      <div class="bg-surface-container-low/30 p-8 rounded-xl border border-outline-variant/10 animate-in fade-in duration-500">
        {#if absenceConfig}
          <RolePermissionSettings 
            featureKey="absences" 
            roleAccess={absenceConfig.roleAccessByRole} 
          />
        {/if}
      </div>

      <div class="bg-surface-container-low/30 p-8 rounded-xl border border-outline-variant/10 animate-in fade-in duration-500 flex flex-col justify-between">
        <div class="space-y-6">
          <div>
            <h3 class="text-xl font-bold flex items-center gap-3">
              <Papicon icon="notifications_active" size={20} class="text-primary" />
              Notifications & Webhooks Discord
            </h3>
            <p class="text-xs text-on-surface-variant/60 mt-1">{m.bsn_configure_automatic_alerts_sen()}</p>
          </div>

          <div class="space-y-4">
            <div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-high/40 border border-outline-variant/5">
              <div class="flex items-center gap-3">
                <Papicon icon="mail" size={14} class="text-primary" />
                <div>
                  <p class="text-xs font-bold">{m.bsn_enable_discord_relay()}</p>
                  <p class="text-[10px] text-on-surface-variant/40">{m.bsn_sending_a_message_in_the_confi()}</p>
                </div>
              </div>
              <ToggleSwitch checked={notifyViaDiscordChannel} onToggle={(v: any) => notifyViaDiscordChannel = v} />
            </div>

            {#if notifyViaDiscordChannel}
              <div class="space-y-1.5">
                <label for="notify-channel" class="text-[10px] font-bold text-on-surface-variant/60">{m.bsn_alerts_lounge()}</label>
                <SearchableSelect id="notify-channel" bind:value={channelId} options={availableChannels.map(c => ({ id: c.id, name: channelDisplayName(c) }))} placeholder={m.bsn_select_a_salon()} className="w-full" />
              </div>

              <div class="space-y-1.5">
                <label for="notify-role" class="text-[10px] font-bold text-on-surface-variant/60">{m.bsn_role_to_mention()}</label>
                <SearchableSelect id="notify-role" bind:value={notificationRoleId} options={availableRoles.map(r => ({ id: r.id, name: `@${r.name}` }))} placeholder="Aucune mention" className="w-full" />
              </div>
            {/if}

            <div class="space-y-1.5">
              <label for="webhook-url" class="text-[10px] font-bold text-on-surface-variant/60">{m.bsn_discord_webhook_url_optional()}</label>
              <input 
                id="webhook-url" 
                type="url" 
                placeholder="https://discord.com/api/webhooks/..." 
                bind:value={webhookUrl}
                class="w-full bg-surface-container-high text-sm px-4 py-2.5 rounded-xl border border-outline-variant/10 focus:ring-1 ring-primary/30 transition-all outline-none" 
              />
            </div>
          </div>
        </div>

        {#if saveAction.state.message || saveAction.state.error}
          <div class="pt-6 border-t border-outline-variant/10 mt-6">
            <InlineFeedback
              message={saveAction.state.message}
              error={saveAction.state.error}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="space-y-8 animate-in fade-in duration-500">
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <!-- Sidebar Skeleton -->
        <div class="lg:col-span-1 h-175 bg-surface-container-low/40 rounded-xl border border-outline-variant/20 animate-pulse p-6 space-y-6">
          <div class="h-6 w-3/4 bg-outline-variant/20 rounded-md"></div>
          <div class="space-y-3">
            {#each Array(8) as _}
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-outline-variant/10"></div>
                <div class="h-4 flex-1 bg-outline-variant/10 rounded-md"></div>
              </div>
            {/each}
          </div>
        </div>

        <!-- Calendar Skeleton -->
        <div class="lg:col-span-3 h-175 bg-surface-container-low/40 rounded-xl border border-outline-variant/20 animate-pulse flex flex-col p-8 space-y-6">
          <div class="flex justify-between items-center">
            <div class="h-10 w-48 bg-outline-variant/20 rounded-xl"></div>
            <div class="flex gap-2">
              <div class="h-10 w-24 bg-outline-variant/10 rounded-xl"></div>
              <div class="h-10 w-24 bg-outline-variant/10 rounded-xl"></div>
            </div>
          </div>
          <div class="flex-1 grid grid-cols-7 gap-4">
            {#each Array(7) as _}
              <div class="h-full bg-outline-variant/5 rounded-lg"></div>
            {/each}
          </div>
        </div>
      </div>
    </div>
    <div class="flex justify-center mt-4">
      <LoadingHint context="data" />
    </div>
  {:else}
    <div class="flex flex-col lg:flex-row gap-8">
      <!-- Sidebar: Team Filtering -->

        <aside class="w-full lg:w-72 flex flex-col gap-6">
          <div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold uppercase tracking-widest text-on-surface-variant">{m.bsn_team()}</h3>
              <button 
                onclick={toggleEveryone}
                class="text-[10px] font-semibold uppercase px-2 py-1 rounded-md transition-all {selectedStaffIds.length === activeStaff.length ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant'}"
              >
                {selectedStaffIds.length === activeStaff.length ? 'Tout décocher' : 'Tout cocher'}
              </button>
            </div>
            
            <div class="flex flex-col gap-1 max-h-125 overflow-y-auto pr-2 custom-scrollbar">
              {#each activeStaff as staff}
                <button 
                  onclick={() => toggleStaff(staff.id)}
                  class="flex items-center gap-3 p-2 rounded-xl transition-all hover:bg-surface-hover group {selectedStaffIds.includes(staff.id) ? 'bg-primary/5' : ''}"
                >
                  <div class="relative">
                    <img src={staff.avatarUrl || localInitialAvatar(staff.username)} alt="" class="w-8 h-8 rounded-full border border-outline-variant/20" />
                    {#if selectedStaffIds.includes(staff.id)}
                      <div class="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full border-2 border-surface-container-low flex items-center justify-center">
                        <div class="w-1 h-1 bg-white rounded-full"></div>
                      </div>
                    {/if}
                  </div>
                  <div class="flex-1 text-left">
                    <div class="text-xs font-bold text-on-surface line-clamp-1">{staff.displayName || staff.username}</div>
                    <div class="text-[10px] text-on-surface-variant uppercase tracking-wider font-medium">{staff.grade}</div>
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-4">
            <div class="flex items-center gap-3 mb-1">
              <div class="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center">
                <Papicon icon="info" size={18} class="text-amber-600" />
              </div>
              <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-widest">Affichage</span>
            </div>
            <div class="flex flex-col gap-2">
              <button 
                onclick={() => toggleType('absence')}
                class="flex items-center justify-between p-2 rounded-xl transition-all hover:bg-surface-hover {visibleTypes.includes('absence') ? 'bg-amber-500/5 border border-amber-500/20' : 'opacity-50'}"
              >
                <div class="flex items-center gap-3">
                  <div class="w-3 h-3 rounded bg-amber-500 border border-amber-600/30"></div>
                  <span class="text-[10px] font-bold text-on-surface">{m.bsn_absences()}</span>
                </div>
                <Papicon icon={visibleTypes.includes('absence') ? 'eye' : 'eye-off'} size={14} class="text-on-surface-variant/50" />
              </button>

              <button 
                onclick={() => toggleType('vocal')}
                class="flex items-center justify-between p-2 rounded-xl transition-all hover:bg-surface-hover {visibleTypes.includes('vocal') ? 'bg-primary/5 border border-primary/20' : 'opacity-50'}"
              >
                <div class="flex items-center gap-3">
                  <div class="w-3 h-3 rounded bg-primary border border-primary/30"></div>
                  <span class="text-[10px] font-bold text-on-surface">Vocal</span>
                </div>
                <Papicon icon={visibleTypes.includes('vocal') ? 'eye' : 'eye-off'} size={14} class="text-on-surface-variant/50" />
              </button>

              <button 
                onclick={() => toggleType('meeting')}
                class="flex items-center justify-between p-2 rounded-xl transition-all hover:bg-surface-hover {visibleTypes.includes('meeting') ? 'bg-emerald-500/5 border border-emerald-500/20' : 'opacity-50'}"
              >
                <div class="flex items-center gap-3">
                  <div class="w-3 h-3 rounded bg-emerald-500 border border-emerald-600/30"></div>
                  <span class="text-[10px] font-bold text-on-surface">{m.bsn_meetings()}</span>
                </div>
                <Papicon icon={visibleTypes.includes('meeting') ? 'eye' : 'eye-off'} size={14} class="text-on-surface-variant/50" />
              </button>
            </div>
          </div>
        </aside>


      <!-- Main Content: Calendar -->
      <main class="flex-1">
        <Calendar 
          events={calendarEvents} 
          onRangeChange={handleRangeChange}
          onEventClick={handleEventClick}
          onDateClick={(start: any, end: any) => {
            selectedDate = start;
            selectedEndDate = end || new Date(start.getTime() + 3600000);
            modalOpen = true;
          }}
        />

        <!-- Modals -->
        <AbsenceModal 
          show={modalOpen} 
          onClose={() => modalOpen = false} 
          onSave={handleSaveAbsence}
          staffMembers={activeStaff}
          eligibleSuperiors={eligibleSuperiors}
          isAdmin={isAdmin}
          initialDate={selectedDate}
          initialEndDate={selectedEndDate}
        />

        <CalendarEventModal
          show={detailModalOpen}
          event={selectedEvent}
          onClose={() => detailModalOpen = false}
          extraActions={modalActions}
        />

        {#snippet modalActions()}
          {#if selectedEvent?.type === 'absence'}
            {#if isManager && selectedEvent.status === 'PENDING'}
              <ActionButton 
                variant="primary" 
                onClick={() => {
                  selectedAbsenceForDecision = selectedEvent.originalData;
                  decisionStatus = 'APPROVED';
                  decisionNote = '';
                  decisionModalOpen = true;
                  detailModalOpen = false;
                }} 
                label={m.bsn_make_a_decision()} 
                icon="check-circle"
              />
            {/if}
            {#if isManager || selectedEvent.originalData.staffMember?.userId === (authStore.user as any)?.id}
              <ActionButton 
                variant="danger" 
                onClick={async () => {
                  if (await confirmDialog.danger('Supprimer cette absence ?')) {
                    try {
                      await deleteAbsence(selectedEvent.id);
                      detailModalOpen = false;
                      await refreshCalendar();
                    } catch (e) {
                      console.error('Failed to delete absence:', e);
                    }
                  }
                }} 
                label={m.bsn_delete()} 
                icon="trash-2"
              />
            {/if}
          {/if}
        {/snippet}
      </main>
    </div>
  {/if}
</ModulePage>

  <!-- Decision Modal (kept for complexity) -->
  {#if decisionModalOpen}
    <div class="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div 
        class="absolute inset-0 bg-black/40" 
        onclick={() => decisionModalOpen = false}
        onkeydown={(e) => e.key === 'Escape' && (decisionModalOpen = false)}
        role="button"
        tabindex="-1"
      ></div>
      
      <div class="relative w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden border border-outline-variant/30 font-inter text-on-surface">
        <div class="p-6 border-b border-outline-variant/30 flex items-center gap-4 justify-between {decisionStatus === 'APPROVED' ? 'bg-emerald-500/5' : 'bg-red-500/5'}">
          <div class="flex items-center gap-4">
            <img
              src={selectedAbsenceForDecision?.staffMember?.avatarUrl || localInitialAvatar(selectedAbsenceForDecision?.staffMember?.displayName || selectedAbsenceForDecision?.staffMember?.username)}
              alt=""
              class="w-11 h-11 rounded-full border border-outline-variant/20 shrink-0"
            />
            <div>
              <h3 class="text-xl font-semibold text-on-surface">
                {decisionStatus === 'APPROVED' ? 'Approuver' : 'Refuser'} l'absence
              </h3>
              <p class="text-on-surface-variant text-xs mt-1">{m.bsn_manage_demand_for()} <strong>{selectedAbsenceForDecision?.staffMember?.displayName || selectedAbsenceForDecision?.staffMember?.username}</strong>.</p>
            </div>
          </div>
        </div>

        <div class="p-6 space-y-4">
          <div class="p-4 bg-surface-container-low rounded-lg border border-outline-variant/10">
            <p class="text-[10px] font-semibold uppercase text-on-surface-variant mb-1">Motif :</p>
            <p class="text-sm font-medium text-on-surface italic">"{selectedAbsenceForDecision?.reason}"</p>
          </div>

          <div class="flex gap-2 p-1 bg-surface-container rounded-lg border border-outline-variant/20">
            <button 
              onclick={() => decisionStatus = 'APPROVED'}
              class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all {decisionStatus === 'APPROVED' ? 'bg-emerald-500 text-white shadow-lg' : 'text-on-surface-variant hover:bg-surface-hover'}"
            >
              Approuver
            </button>
            <button 
              onclick={() => decisionStatus = 'REJECTED'}
              class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all {decisionStatus === 'REJECTED' ? 'bg-red-500 text-white shadow-lg' : 'text-on-surface-variant hover:bg-surface-hover'}"
            >
              Refuser
            </button>
          </div>

          <textarea 
            placeholder={m.bsn_optional_note()} 
            bind:value={decisionNote}
            class="w-full bg-surface-container px-4 py-3 rounded-lg border border-outline-variant/30 focus:border-primary outline-none transition-all text-sm"
            rows="3"
          ></textarea>

          <div class="flex gap-3">
            <button onclick={() => decisionModalOpen = false} class="flex-1 py-3 text-sm font-bold text-on-surface-variant hover:bg-surface-hover rounded-xl transition-all">
              Annuler
            </button>
            <button 
              onclick={confirmDecision}
              disabled={decisionSaving}
              class="flex-1 py-3 {decisionStatus === 'APPROVED' ? 'bg-emerald-500' : 'bg-red-500'} text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-all"
            >
              Confirmer
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(var(--color-outline-variant), 0.2);
    border-radius: 10px;
  }
</style>
