<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from '../../lib/stores/toast.svelte';
  import { confirmDialog } from '../../lib/stores/confirmDialog.svelte';
  import {
    sendBroadcast,
    fetchBroadcastHistory,
    deleteBroadcastLog,
    fetchBroadcastEmojis,
    fetchBroadcastChannels,
    setBroadcastChannel,
    type BroadcastPayload,
    type BroadcastLogEntry,
    type BroadcastEmoji,
    type BroadcastGuildConfig,
  } from '../../lib/api';
  import Papicon from '../../lib/components/Papicon.svelte';
  import AdminLayout from '../../lib/components/AdminLayout.svelte';

  // ── State ──
  let title = $state('📢 Annonce Globale Kotbo');
  let message = $state('');
  let color = $state('#5865F2');
  let thumbnailUrl = $state('');
  let imageUrl = $state('');
  let footerText = $state("Système d'annonce globale Kotbo");
  let target = $state<'ALL' | 'ACTIVATED' | 'CUSTOM'>('ALL');
  let selectedGuilds = $state<string[]>([]);
  let guildSearch = $state('');

  let sending = $state(false);
  let loading = $state(true);
  let showEmojiPicker = $state(false);
  let pickerTarget = $state<'title' | 'message'>('message');
  let showConfirmModal = $state(false);
  let activeTab = $state<'compose' | 'channels' | 'history'>('compose');

  let history = $state<BroadcastLogEntry[]>([]);
  let emojis = $state<BroadcastEmoji[]>([]);
  let guilds = $state<BroadcastGuildConfig[]>([]);

  // Channels tab
  let channelFilter = $state<'TODO' | 'ALL'>('TODO');
  let channelSearch = $state('');
  let savingChannel = $state<string | null>(null);

  // ── Derived ──
  const filteredEmojis = $derived(emojis);

  const filteredGuilds = $derived(
    guilds.filter(g =>
      g.name.toLowerCase().includes(guildSearch.toLowerCase()) ||
      g.id.includes(guildSearch)
    )
  );

  const needsConfigCount = $derived(guilds.filter(g => g.channelStatus !== 'OK').length);

  const channelConfigList = $derived(
    guilds
      .filter(g => channelFilter === 'ALL' || g.channelStatus !== 'OK')
      .filter(g =>
        g.name.toLowerCase().includes(channelSearch.toLowerCase()) ||
        g.id.includes(channelSearch)
      )
  );

  const targetedGuilds = $derived(
    target === 'ALL' ? guilds :
    target === 'ACTIVATED' ? guilds.filter(g => g.activated) :
    guilds.filter(g => selectedGuilds.includes(g.id))
  );

  const targetedUnconfigured = $derived(targetedGuilds.filter(g => g.channelStatus !== 'OK'));

  const targetLabel = $derived(
    target === 'ALL' ? 'Tous les serveurs' :
    target === 'ACTIVATED' ? 'Serveurs activés' :
    `${selectedGuilds.length} serveur(s) sélectionné(s)`
  );

  // ── Init ──
  onMount(async () => {
    try {
      const [histData, emojiData, channelData] = await Promise.all([
        fetchBroadcastHistory(),
        fetchBroadcastEmojis(),
        fetchBroadcastChannels(),
      ]);
      history = histData.logs;
      emojis = emojiData.emojis;
      guilds = channelData.guilds || [];
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      loading = false;
    }
  });

  // ── Actions ──
  function openEmojiPicker(targetField: 'title' | 'message') {
    if (showEmojiPicker && pickerTarget === targetField) {
      showEmojiPicker = false;
      return;
    }
    pickerTarget = targetField;
    showEmojiPicker = true;
  }

  function insertEmoji(emoji: BroadcastEmoji) {
    const match = emoji.formatted.match(/<a?:(\w+):\d+>/);
    const name = match?.[1] || emoji.discordName || emoji.key;
    if (pickerTarget === 'title') {
      title += ` :${name}: `;
    } else {
      message += ` :${name}: `;
    }
    showEmojiPicker = false;
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEmojiPreview(text: string): string {
    if (!text) return '';
    let result = escapeHtml(text);
    for (const e of emojis) {
      const match = e.formatted.match(/<a?:(\w+):(\d+)>/);
      if (!match) continue;
      const discordName = match[1];
      const emojiId = match[2];
      const imgTag = `<img src="https://cdn.discordapp.com/emojis/${emojiId}.webp?size=20" alt="${e.key}" class="inline-block w-5 h-5 align-text-bottom" />`;
      // Full <:name:id> formats first, otherwise the :name: pass would corrupt them
      result = result.replace(new RegExp(`&lt;a?:${discordName}:\\d+&gt;`, 'g'), imgTag);
      result = result.replaceAll(`:${discordName}:`, imgTag);
      if (e.key !== discordName) {
        result = result.replaceAll(`:${e.key}:`, imgTag);
      }
    }
    return result;
  }

  function renderTitlePreview(text: string): string {
    if (!text) return '';
    let result = escapeHtml(text);
    for (const e of emojis) {
      const match = e.formatted.match(/<a?:(\w+):(\d+)>/);
      if (!match) continue;
      const discordName = match[1];
      const unicodeChar = e.unicode || '❓';
      // Full <:name:id> formats first, otherwise the :name: pass would corrupt them
      result = result.replace(new RegExp(`&lt;a?:${discordName}:\\d+&gt;`, 'g'), unicodeChar);
      result = result.replaceAll(`:${discordName}:`, unicodeChar);
      if (e.key !== discordName) {
        result = result.replaceAll(`:${e.key}:`, unicodeChar);
      }
    }
    return result;
  }

  async function handleDryRun() {
    if (!message.trim()) { toast.error('Message requis'); return; }
    try {
      const payload = buildPayload(true);
      const res = await sendBroadcast(payload);
      toast.success(`Dry run : ${res.totalTargeted} serveur(s) ciblé(s)`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function handleSend() {
    if (!message.trim()) { toast.error('Message requis'); return; }
    if (target === 'CUSTOM' && selectedGuilds.length === 0) { toast.error('Sélectionnez au moins un serveur'); return; }
    showConfirmModal = true;
  }

  async function confirmSend() {
    sending = true;
    try {
      const payload = buildPayload(false);
      const res = await sendBroadcast(payload);
      toast.success(`Broadcast envoyé ! ${res.successCount} succès, ${res.failCount} échecs sur ${res.totalTargeted} ciblés`);
      message = '';
      showConfirmModal = false;
      const histData = await fetchBroadcastHistory();
      history = histData.logs;
      activeTab = 'history';
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      sending = false;
    }
  }

  function buildPayload(dryRun: boolean): BroadcastPayload {
    return {
      title: title.trim() || undefined,
      message: message.trim(),
      color: color || undefined,
      thumbnailUrl: thumbnailUrl.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      footerText: footerText.trim() || undefined,
      target,
      targetGuilds: target === 'CUSTOM' ? selectedGuilds : undefined,
      channelPref: 'AUTO',
      dryRun,
    };
  }

  async function saveChannelFor(guild: BroadcastGuildConfig, channelId: string | null) {
    savingChannel = guild.id;
    try {
      await setBroadcastChannel(guild.id, channelId);
      const ch = channelId ? guild.channels.find(c => c.id === channelId) ?? null : null;
      guilds = guilds.map(g => g.id === guild.id ? {
        ...g,
        broadcastChannelId: channelId,
        broadcastChannelName: ch?.name ?? null,
        channelStatus: channelId ? 'OK' as const : 'UNSET' as const,
      } : g);
      toast.success(channelId ? `Salon #${ch?.name} configuré pour ${guild.name}` : `Salon retiré pour ${guild.name}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      savingChannel = null;
    }
  }

  async function handleDeleteLog(id: string) {
    if (!(await confirmDialog.danger('Supprimer cette entrée ?'))) return;
    try {
      await deleteBroadcastLog(id);
      history = history.filter(h => h.id !== id);
      toast.success('Entrée supprimée');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function toggleGuild(id: string) {
    if (selectedGuilds.includes(id)) {
      selectedGuilds = selectedGuilds.filter(g => g !== id);
    } else {
      selectedGuilds = [...selectedGuilds, id];
    }
  }

  function formatDate(d: string): string {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function channelPrefLabel(pref: string): string {
    switch (pref) {
      case 'AUTO': return 'Salon par serveur';
      case 'NEWS': return 'Salon news';
      case 'PUBLIC': return 'Salon public';
      case 'STAFF': return 'Salon staff';
      default: return 'Fallback auto';
    }
  }

  const COLOR_PRESETS = [
    { label: 'Blurple', value: '#5865F2' },
    { label: 'Vert', value: '#57F287' },
    { label: 'Rouge', value: '#ED4245' },
    { label: 'Jaune', value: '#FEE75C' },
    { label: 'Rose', value: '#EB459E' },
    { label: 'Sombre', value: '#2B2D31' },
  ];
</script>

<AdminLayout>
  <div class="space-y-6 pb-12 animate-in fade-in slide-in-from-bottom-3 duration-600">

    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low/40 p-5 rounded-xl border border-outline-variant/30">
      <div>
        <h2 class="text-lg font-bold text-on-surface tracking-tight">Broadcast</h2>
        <p class="text-sm text-on-surface-variant/50 font-medium">Annonces globales configurables vers les serveurs</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={() => activeTab = 'compose'}
          class="tab-button {activeTab === 'compose' ? 'active' : ''}"
        >
          <Papicon icon="PenLine" size={13} class="inline mr-1.5" />Composer
        </button>
        <button
          onclick={() => activeTab = 'channels'}
          class="tab-button {activeTab === 'channels' ? 'active' : ''}"
        >
          <Papicon icon="Hash" size={13} class="inline mr-1.5" />Salons
          {#if needsConfigCount > 0}
            <span class="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px]">{needsConfigCount}</span>
          {/if}
        </button>
        <button
          onclick={() => activeTab = 'history'}
          class="tab-button {activeTab === 'history' ? 'active' : ''}"
        >
          <Papicon icon="History" size={13} class="inline mr-1.5" />Historique
          {#if history.length > 0}
            <span class="ml-1.5 px-1.5 py-0.5 rounded-full bg-on-surface/10 text-[10px]">{history.length}</span>
          {/if}
        </button>
      </div>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-20">
        <div class="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>

    {:else if activeTab === 'compose'}
      <div class="grid grid-cols-1 xl:grid-cols-5 gap-6">

        <!-- ═══ Left: Embed Builder (3 cols) ═══ -->
        <div class="xl:col-span-3 space-y-5">

          <!-- Title -->
          <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 space-y-4">
            <div class="flex items-center gap-3 mb-1">
              <div class="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center text-blue-400">
                <Papicon icon="Type" size={16} />
              </div>
              <p class="font-bold text-on-surface text-sm">Contenu de l'embed</p>
            </div>

            <div class="space-y-3">
              <div class="relative">
                <div class="flex items-center justify-between mb-1">
                  <label for="broadcast-title" class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Titre</label>
                  <button
                    onclick={() => openEmojiPicker('title')}
                    class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all duration-200
 {showEmojiPicker && pickerTarget === 'title' ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-on-surface/5 text-on-surface-variant/50 hover:bg-on-surface/10 border border-transparent'}"
                  >
                    <Papicon icon="Smile" size={12} />
                    Emojis Kotbo
                  </button>
                </div>
                <input
                  id="broadcast-title"
                  bind:value={title}
                  placeholder="Titre de l'annonce"
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>

              <div class="relative">
                <div class="flex items-center justify-between mb-1">
                  <label for="broadcast-message" class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Message</label>
                  <button
                    onclick={() => openEmojiPicker('message')}
                    class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all duration-200
 {showEmojiPicker && pickerTarget === 'message' ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-on-surface/5 text-on-surface-variant/50 hover:bg-on-surface/10 border border-transparent'}"
                  >
                    <Papicon icon="Smile" size={12} />
                    Emojis Kotbo
                  </button>
                </div>

                <textarea
                  id="broadcast-message"
                  bind:value={message}
                  placeholder="Rédigez votre annonce... Utilisez :emoji_key: pour les emojis custom"
                  rows={6}
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all resize-none font-medium"
                  required
                ></textarea>
              </div>

              <!-- Emoji Picker (shared between title & message) -->
              {#if showEmojiPicker}
                <div class="absolute right-5 top-16 z-50 w-80 max-h-64 overflow-y-auto bg-surface-container border border-outline-variant/20 rounded-xl shadow-2xl shadow-black/30 p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                    Insérer dans {pickerTarget === 'title' ? 'le titre' : 'le message'}
                  </p>
                  <div class="grid grid-cols-6 gap-1.5">
                    {#each filteredEmojis as emoji}
                      {@const match = emoji.formatted.match(/<a?:\w+:(\d+)>/)}
                      {#if match}
                        <button
                          onclick={() => insertEmoji(emoji)}
                          title={`:${emoji.formatted.match(/<a?:(\w+):\d+>/)?.[1] || emoji.key}:`}
                          class="group w-10 h-10 rounded-lg bg-on-surface/5 hover:bg-primary/15 border border-transparent hover:border-primary/20 flex items-center justify-center transition-all duration-150"
                        >
                          <img
                            src="https://cdn.discordapp.com/emojis/{match[1]}.webp?size=32"
                            alt={emoji.key}
                            class="w-6 h-6 group-hover:scale-110 transition-transform"
                          />
                        </button>
                      {/if}
                    {/each}
                  </div>
                  {#if emojis.length === 0}
                    <p class="text-xs text-on-surface-variant/40 text-center py-4">Aucun emoji disponible</p>
                  {/if}
                </div>
              {/if}

              <div>
                <label for="broadcast-footer" class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1 block">Footer</label>
                <input
                  id="broadcast-footer"
                  bind:value={footerText}
                  placeholder="Texte du footer"
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
            </div>
          </div>

          <!-- Apparence -->
          <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 space-y-4">
            <div class="flex items-center gap-3 mb-1">
              <div class="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/15 flex items-center justify-center text-purple-400">
                <Papicon icon="Palette" size={16} />
              </div>
              <p class="font-bold text-on-surface text-sm">Apparence</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Color picker -->
              <div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-2 block">Couleur</span>
                <div class="flex items-center gap-2 flex-wrap">
                  {#each COLOR_PRESETS as preset}
                    <button
                      onclick={() => color = preset.value}
                      title={preset.label}
                      class="w-8 h-8 rounded-lg border-2 transition-all duration-200 hover:scale-110
 {color === preset.value ? 'border-white shadow-lg scale-110' : 'border-transparent hover:border-white/30'}"
                      style="background-color: {preset.value}"
                    ></button>
                  {/each}
                  <input
                    type="color"
                    bind:value={color}
                    class="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
                  />
                </div>
              </div>

              <!-- Thumbnail URL -->
              <div>
                <label for="thumbnail-url" class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1 block">Thumbnail URL</label>
                <input
                  id="thumbnail-url"
                  bind:value={thumbnailUrl}
                  placeholder="https://..."
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>

              <!-- Image URL -->
              <div class="sm:col-span-2">
                <label for="image-url" class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1 block">Image URL (grande)</label>
                <input
                  id="image-url"
                  bind:value={imageUrl}
                  placeholder="https://..."
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
            </div>
          </div>

          <!-- Ciblage -->
          <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 space-y-4">
            <div class="flex items-center gap-3 mb-1">
              <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center text-emerald-400">
                <Papicon icon="Target" size={16} />
              </div>
              <p class="font-bold text-on-surface text-sm">Ciblage</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Target -->
              <div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-2 block">Cible</span>
                <div class="flex flex-col gap-1.5">
                  {#each [
                    { val: 'ALL', label: 'Tous les serveurs', icon: 'Globe' },
                    { val: 'ACTIVATED', label: 'Serveurs activés', icon: 'CheckCircle' },
                    { val: 'CUSTOM', label: 'Sélection manuelle', icon: 'ListChecks' },
                  ] as opt}
                    <button
                      onclick={() => target = opt.val as any}
                      class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 text-left
 {target === opt.val
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'bg-on-surface/4 text-on-surface-variant/60 hover:bg-on-surface/8 border border-transparent'}"
                    >
                      <Papicon icon={opt.icon} size={14} />
                      {opt.label}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Broadcast channel info -->
              <div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-2 block">Salon de diffusion</span>
                <div class="bg-on-surface/4 border border-outline-variant/10 rounded-xl p-3.5 space-y-2.5">
                  <p class="text-xs text-on-surface-variant/60 font-medium leading-relaxed">
                    Chaque serveur reçoit le broadcast dans le salon configuré dans l'onglet <span class="font-bold text-on-surface">Salons</span>.
                  </p>
                  {#if targetedUnconfigured.length > 0}
                    <div class="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/15 text-amber-400">
                      <Papicon icon="AlertTriangle" size={13} class="shrink-0 mt-0.5" />
                      <p class="text-[11px] font-bold leading-snug">
                        {targetedUnconfigured.length} serveur(s) ciblé(s) sans salon configuré → fallback automatique
                      </p>
                    </div>
                  {:else}
                    <div class="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/15 text-emerald-400">
                      <Papicon icon="CheckCircle" size={13} />
                      <p class="text-[11px] font-bold">Tous les serveurs ciblés sont configurés</p>
                    </div>
                  {/if}
                  <button
                    onclick={() => activeTab = 'channels'}
                    class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold bg-on-surface/5 text-on-surface-variant/60 hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20 transition-all duration-200"
                  >
                    <Papicon icon="Hash" size={12} />
                    Configurer les salons
                  </button>
                </div>
              </div>
            </div>

            <!-- Custom guild selector -->
            {#if target === 'CUSTOM'}
              <div class="mt-3 space-y-3 border-t border-outline-variant/10 pt-4">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Sélection des serveurs</span>
                  <span class="text-xs font-bold text-primary">{selectedGuilds.length} sélectionné(s)</span>
                </div>
                <input
                  bind:value={guildSearch}
                  placeholder="Rechercher un serveur..."
                  class="w-full bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
                />
                <div class="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {#each filteredGuilds as guild}
                    <button
                      onclick={() => toggleGuild(guild.id)}
                      class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 text-left
 {selectedGuilds.includes(guild.id)
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'bg-on-surface/3 text-on-surface-variant/60 hover:bg-on-surface/6 border border-transparent'}"
                    >
                      {#if guild.icon}
                        <img src={guild.icon} alt="" class="w-6 h-6 rounded-lg" />
                      {:else}
                        <div class="w-6 h-6 rounded-lg bg-on-surface/10 flex items-center justify-center text-[10px] font-bold">{guild.name.charAt(0)}</div>
                      {/if}
                      <span class="flex-1 truncate">{guild.name}</span>
                      {#if guild.channelStatus !== 'OK'}
                        <span title="Salon de diffusion non configuré"><Papicon icon="AlertTriangle" size={12} class="text-amber-400" /></span>
                      {/if}
                      <span class="text-[10px] text-on-surface-variant/30">{guild.memberCount}</span>
                      {#if selectedGuilds.includes(guild.id)}
                        <Papicon icon="Check" size={14} class="text-primary" />
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- ═══ Right: Preview + Actions (2 cols) ═══ -->
        <div class="xl:col-span-2 space-y-5">

          <!-- Live Preview -->
          <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 space-y-4 sticky top-6">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center text-indigo-400">
                <Papicon icon="Eye" size={16} />
              </div>
              <p class="font-bold text-on-surface text-sm">Aperçu Discord</p>
            </div>

            <!-- Discord-style embed preview -->
            <div class="bg-[#2B2D31] rounded-lg overflow-hidden">
              <div class="flex">
                <!-- Color bar -->
                <div class="w-1 shrink-0 rounded-l" style="background-color: {color}"></div>

                <div class="flex-1 p-4 space-y-2">
                  <!-- Title -->
                  {#if title.trim()}
                    <p class="font-bold text-white text-sm">{@html renderTitlePreview(title)}</p>
                  {/if}

                  <!-- Description -->
                  {#if message.trim()}
                    <div class="text-sm text-[#DBDEE1] leading-relaxed whitespace-pre-wrap break-words">
                      {@html renderEmojiPreview(message)}
                    </div>
                  {:else}
                    <p class="text-sm text-[#DBDEE1]/40 italic">Votre message apparaîtra ici...</p>
                  {/if}

                  <!-- Image -->
                  {#if imageUrl.trim()}
                    <div class="mt-2">
                      <img src={imageUrl} alt="preview" class="max-w-full rounded-lg max-h-48 object-cover" onerror={(e: any) => e.target.style.display = 'none'} />
                    </div>
                  {/if}

                  <!-- Footer -->
                  {#if footerText.trim()}
                    <div class="flex items-center gap-2 pt-2 border-t border-white/5">
                      <p class="text-[11px] text-[#DBDEE1]/50">{@html renderTitlePreview(footerText)}</p>
                    </div>
                  {/if}
                </div>

                <!-- Thumbnail -->
                {#if thumbnailUrl.trim()}
                  <div class="p-4 shrink-0">
                    <img src={thumbnailUrl} alt="thumb" class="w-16 h-16 rounded-lg object-cover" onerror={(e: any) => e.target.style.display = 'none'} />
                  </div>
                {/if}
              </div>
            </div>

            <!-- Target summary -->
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-on-surface/4 rounded-xl p-3 space-y-1">
                <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Cible</p>
                <p class="text-xs font-bold text-on-surface">{targetLabel}</p>
              </div>
              <div class="bg-on-surface/4 rounded-xl p-3 space-y-1">
                <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">Canal</p>
                <p class="text-xs font-bold text-on-surface">Salon configuré par serveur</p>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex flex-col gap-2.5 pt-2">
              <button
                onclick={handleDryRun}
                disabled={!message.trim() || sending}
                class="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs transition-all duration-200
 {!message.trim() || sending
                    ? 'bg-on-surface/10 text-on-surface-variant/40 cursor-not-allowed'
                    : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20'}"
              >
                <Papicon icon="FlaskConical" size={14} />
                Dry Run (test sans envoi)
              </button>

              <button
                onclick={handleSend}
                disabled={!message.trim() || sending}
                class="flex items-center justify-center gap-2.5 py-3 px-5 rounded-xl font-bold text-sm transition-all duration-200
 {!message.trim() || sending
                    ? 'bg-on-surface/10 text-on-surface-variant/40 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600 hover:scale-[1.02] active:scale-95 shadow-sm'}"
              >
                <Papicon icon="Send" size={15} />
                Envoyer le broadcast
              </button>
            </div>
          </div>
        </div>
      </div>

    {:else if activeTab === 'channels'}
      <!-- ═══ Channels Tab ═══ -->
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <button
              onclick={() => channelFilter = 'TODO'}
              class="px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-200
 {channelFilter === 'TODO' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' : 'bg-on-surface/5 text-on-surface-variant/60 hover:bg-on-surface/10 border border-transparent'}"
            >
              <Papicon icon="AlertTriangle" size={12} class="inline mr-1.5" />
              À configurer ({needsConfigCount})
            </button>
            <button
              onclick={() => channelFilter = 'ALL'}
              class="px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-200
 {channelFilter === 'ALL' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-on-surface/5 text-on-surface-variant/60 hover:bg-on-surface/10 border border-transparent'}"
            >
              Tous les serveurs ({guilds.length})
            </button>
          </div>
          <input
            bind:value={channelSearch}
            placeholder="Rechercher un serveur..."
            class="sm:w-64 bg-on-surface/4 border border-outline-variant/10 rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 transition-all"
          />
        </div>

        {#if channelConfigList.length === 0}
          <div class="flex flex-col items-center justify-center py-20 gap-4 text-center bg-on-surface/3 border border-outline-variant/10 rounded-2xl">
            <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center text-emerald-400">
              <Papicon icon="CheckCircle" size={28} />
            </div>
            <div>
              <p class="font-bold text-on-surface text-lg">
                {channelFilter === 'TODO' && !channelSearch ? 'Tout est configuré !' : 'Aucun serveur trouvé'}
              </p>
              <p class="text-sm text-on-surface-variant/50 mt-1">
                {channelFilter === 'TODO' && !channelSearch
                  ? 'Chaque serveur a un salon de diffusion valide'
                  : 'Modifiez votre recherche ou le filtre'}
              </p>
            </div>
          </div>
        {:else}
          <div class="space-y-2">
            {#each channelConfigList as guild (guild.id)}
              <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-outline-variant/20 transition-all duration-200">
                <!-- Guild identity -->
                <div class="flex items-center gap-3 flex-1 min-w-0">
                  {#if guild.icon}
                    <img src={guild.icon} alt="" class="w-9 h-9 rounded-xl shrink-0" />
                  {:else}
                    <div class="w-9 h-9 rounded-xl bg-on-surface/10 flex items-center justify-center text-xs font-bold shrink-0">{guild.name.charAt(0)}</div>
                  {/if}
                  <div class="min-w-0">
                    <p class="font-bold text-on-surface text-sm truncate">{guild.name}</p>
                    <p class="text-[10px] text-on-surface-variant/40">{guild.memberCount} membres{guild.activated ? ' · activé' : ''}</p>
                  </div>
                </div>

                <!-- Status badge -->
                <div class="shrink-0">
                  {#if guild.channelStatus === 'OK'}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                      <Papicon icon="Check" size={10} />
                      #{guild.broadcastChannelName}
                    </span>
                  {:else if guild.channelStatus === 'MISSING'}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-bold">
                      <Papicon icon="X" size={10} />
                      Salon supprimé
                    </span>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-[10px] font-bold">
                      <Papicon icon="AlertTriangle" size={10} />
                      Non configuré
                    </span>
                  {/if}
                </div>

                <!-- Channel select -->
                <div class="flex items-center gap-2 sm:w-72 shrink-0">
                  <select
                    value={guild.channelStatus === 'OK' ? guild.broadcastChannelId : ''}
                    disabled={savingChannel === guild.id}
                    onchange={(e) => saveChannelFor(guild, (e.currentTarget as HTMLSelectElement).value || null)}
                    class="flex-1 bg-on-surface/4 border border-outline-variant/10 rounded-xl px-3 py-2.5 text-xs font-medium text-on-surface focus:outline-none focus:border-primary/40 transition-all disabled:opacity-50"
                  >
                    <option value="">- Aucun salon -</option>
                    {#each guild.channels as ch (ch.id)}
                      <option value={ch.id}>#{ch.name}{ch.category ? ` · ${ch.category}` : ''}</option>
                    {/each}
                  </select>
                  {#if savingChannel === guild.id}
                    <div class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0"></div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else}
      <!-- ═══ History Tab ═══ -->
      <div class="space-y-4">
        {#if history.length === 0}
          <div class="flex flex-col items-center justify-center py-20 gap-4 text-center bg-on-surface/3 border border-outline-variant/10 rounded-2xl">
            <div class="w-14 h-14 rounded-2xl bg-on-surface/5 border border-outline-variant/10 flex items-center justify-center text-on-surface-variant/30">
              <Papicon icon="Megaphone" size={28} />
            </div>
            <div>
              <p class="font-bold text-on-surface text-lg">Aucun broadcast</p>
              <p class="text-sm text-on-surface-variant/50 mt-1">Les annonces envoyées apparaîtront ici</p>
            </div>
          </div>
        {:else}
          {#each history as log}
            <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl p-5 space-y-3 hover:border-outline-variant/20 transition-all duration-200">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                  {#if log.avatarUrl}
                    <img src={log.avatarUrl} alt="" class="w-8 h-8 rounded-full" />
                  {:else}
                    <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Papicon icon="user" size={16} /></div>
                  {/if}
                  <div>
                    <p class="font-bold text-on-surface text-sm">{log.title}</p>
                    <p class="text-[10px] text-on-surface-variant/40">par {log.username || log.sentBy} - {formatDate(log.createdAt)}</p>
                  </div>
                </div>
                <button
                  onclick={() => handleDeleteLog(log.id)}
                  class="p-1.5 rounded-lg hover:bg-error/10 text-on-surface-variant/30 hover:text-error transition-all"
                >
                  <Papicon icon="Trash2" size={14} />
                </button>
              </div>

              <p class="text-sm text-on-surface-variant/70 line-clamp-3">{log.message}</p>

              <div class="flex items-center gap-3 flex-wrap">
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                  <Papicon icon="Check" size={10} />
                  {log.successCount} succès
                </div>
                {#if log.failCount > 0}
                  <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-bold">
                    <Papicon icon="X" size={10} />
                    {log.failCount} échecs
                  </div>
                {/if}
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-on-surface/5 text-on-surface-variant/50 text-[10px] font-bold">
                  <Papicon icon="Target" size={10} />
                  {log.totalTargeted} ciblés
                </div>
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-on-surface/5 text-on-surface-variant/50 text-[10px] font-bold">
                  {log.target === 'ALL' ? 'Tous' : log.target === 'ACTIVATED' ? 'Activés' : 'Custom'}
                </div>
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-on-surface/5 text-on-surface-variant/50 text-[10px] font-bold">
                  {channelPrefLabel(log.channelPref)}
                </div>
                <div class="w-3 h-3 rounded-sm border border-white/10" style="background-color: {log.color}"></div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- ═══ Confirm Send Modal ═══ -->
  {#if showConfirmModal}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      onclick={() => { if (!sending) showConfirmModal = false; }}
      onkeydown={(e) => { if (e.key === 'Escape' && !sending) showConfirmModal = false; }}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="broadcast-confirm-title"
    >
      <div class="absolute inset-0 bg-black/40 animate-in fade-in duration-200"></div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative z-10 w-full max-w-lg bg-surface-container border border-outline-variant/20 rounded-2xl shadow-2xl shadow-black/50 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <!-- Icon + Title -->
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-blue-400">
            <Papicon icon="Send" size={20} />
          </div>
          <div>
            <h3 id="broadcast-confirm-title" class="font-semibold text-on-surface text-base">Confirmer l'envoi du broadcast</h3>
            <p class="text-sm text-on-surface-variant/60 mt-1 leading-relaxed">
              L'annonce sera envoyée à <span class="font-bold text-on-surface">{targetedGuilds.length} serveur(s)</span> ({targetLabel.toLowerCase()}). Cette action est irréversible.
            </p>
          </div>
        </div>

        <!-- Mini embed preview -->
        <div class="bg-[#2B2D31] rounded-lg overflow-hidden">
          <div class="flex">
            <div class="w-1 shrink-0 rounded-l" style="background-color: {color}"></div>
            <div class="flex-1 p-3.5 space-y-1.5 min-w-0">
              {#if title.trim()}
                <p class="font-bold text-white text-sm truncate">{@html renderTitlePreview(title)}</p>
              {/if}
              <div class="text-xs text-[#DBDEE1] leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
                {@html renderEmojiPreview(message)}
              </div>
            </div>
          </div>
        </div>

        <!-- Warning & configuration of unconfigured guilds -->
        {#if targetedUnconfigured.length > 0}
          <div class="bg-amber-500/10 border border-amber-500/15 text-amber-400 rounded-xl p-4 space-y-3">
            <div class="flex items-start gap-2.5">
              <Papicon icon="AlertTriangle" size={15} class="shrink-0 mt-0.5" />
              <div class="text-xs font-medium leading-relaxed min-w-0 flex-1">
                <p class="font-bold">{targetedUnconfigured.length} serveur(s) sans salon de diffusion configuré</p>
                <p class="text-amber-400/70 mt-0.5">
                  Choisissez un salon de diffusion pour ces serveurs avant d'envoyer, ou laissez vide pour utiliser le fallback automatique :
                </p>
              </div>
            </div>

            <!-- Scrollable list of guilds to configure -->
            <div class="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {#each targetedUnconfigured as guild (guild.id)}
                <div class="flex items-center justify-between gap-3 bg-black/20 p-2.5 rounded-lg border border-amber-500/10">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    {#if guild.icon}
                      <img src={guild.icon} alt="" class="w-6 h-6 rounded-lg shrink-0" />
                    {:else}
                      <div class="w-6 h-6 rounded-lg bg-on-surface/10 flex items-center justify-center text-[10px] font-bold shrink-0">{guild.name.charAt(0)}</div>
                    {/if}
                    <span class="text-xs font-semibold text-on-surface truncate" title={guild.name}>{guild.name}</span>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0">
                    <select
                      value={guild.broadcastChannelId || ''}
                      disabled={savingChannel === guild.id}
                      onchange={(e) => saveChannelFor(guild, (e.currentTarget as HTMLSelectElement).value || null)}
                      class="bg-on-surface/5 border border-outline-variant/15 rounded-lg px-2 py-1 text-[11px] font-semibold text-on-surface focus:outline-none focus:border-amber-500/40 transition-all disabled:opacity-50"
                    >
                      <option value="">- Aucun salon -</option>
                      {#each guild.channels as ch (ch.id)}
                        <option value={ch.id}>#{ch.name}</option>
                      {/each}
                    </select>
                    {#if savingChannel === guild.id}
                      <div class="w-3.5 h-3.5 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Buttons -->
        <div class="flex items-center justify-end gap-2 pt-1">
          <button
            onclick={() => showConfirmModal = false}
            disabled={sending}
            class="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-on-surface/8 border border-outline-variant/10 transition-all disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onclick={confirmSend}
            disabled={sending}
            class="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 shadow-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100"
          >
            {#if sending}
              <div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Envoi en cours...
            {:else}
              <Papicon icon="Send" size={14} />
              Envoyer maintenant
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</AdminLayout>
