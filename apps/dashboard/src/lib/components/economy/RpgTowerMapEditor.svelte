<script lang="ts">
  /**
   * Éditeur de la carte de la Tour.
   *
   * Une grille où l'on peint des salles : deux salles qui se touchent par un côté
   * communiquent, une case vide est un mur. Le boss occupe une grande salle de 2×2. La
   * géométrie reprend celle du bot (`rpgTowerMap.ts`) : ce qui s'affiche ici est ce que le
   * joueur parcourra sur Discord, et le serveur revalide tout à l'enregistrement.
   */
  import { m } from '../../i18n';
  import { createAsyncActionState } from '../../asyncAction.svelte';
  import { saveRpgTowerLayout } from '../../api';
  import Papicon from '../Papicon.svelte';
  import InlineFeedback from '../InlineFeedback.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';

  type RoomType = 'START' | 'MONSTER' | 'ELITE' | 'BOSS' | 'CHEST' | 'CAMPFIRE' | 'MERCHANT' | 'SHRINE' | 'EMPTY';
  type ChestKind = 'BOTH' | 'GOLD' | 'GEAR';
  type OfferKind = 'POTION' | 'HEAL' | 'GEAR';
  type Room = {
    id: string;
    x: number;
    y: number;
    type: RoomType;
    foe: string | null;
    chest: ChestKind;
    healPercent: number;
    offers: OfferKind[];
    pricePercent: number;
  };
  type Layout = { width: number; height: number; rooms: Room[] };
  type Foe = { name: string; emoji: string; isBoss: boolean; enabled: boolean };
  type Tool = RoomType | 'ERASE' | 'SELECT';

  const {
    canManage = false,
    disabled = false,
    initialLayout = null,
    initialEnabled = false,
    foes = [],
    sizeLimits = { min: 3, max: 12 },
    roomsMax = 100,
    onSaved,
  }: {
    canManage?: boolean;
    disabled?: boolean;
    initialLayout?: Layout | null;
    initialEnabled?: boolean;
    foes?: Foe[];
    sizeLimits?: { min: number; max: number };
    roomsMax?: number;
    onSaved?: () => void | Promise<void>;
  } = $props();

  const CELL = 56;
  const ROOM_TYPES: RoomType[] = ['START', 'MONSTER', 'ELITE', 'BOSS', 'CHEST', 'CAMPFIRE', 'MERCHANT', 'SHRINE', 'EMPTY'];
  // Mêmes pictogrammes que les emojis d'application du bot sur Discord.
  const ICON: Record<RoomType, string> = {
    START: 'DoorOpen', MONSTER: 'Swords', ELITE: 'Skull', BOSS: 'Crown', CHEST: 'PackageOpen',
    CAMPFIRE: 'Flame', MERCHANT: 'ShoppingCart', SHRINE: 'Sparkles', EMPTY: 'Square',
  };
  const COLOR: Record<RoomType, string> = {
    START: '#64748b', MONSTER: '#ef4444', ELITE: '#a855f7', BOSS: '#f59e0b', CHEST: '#eab308',
    CAMPFIRE: '#f97316', MERCHANT: '#10b981', SHRINE: '#38bdf8', EMPTY: '#94a3b8',
  };
  const OFFERS: OfferKind[] = ['POTION', 'HEAL', 'GEAR'];

  function label(type: RoomType): string {
    switch (type) {
      case 'START': return m.eco_tower_room_start();
      case 'MONSTER': return m.eco_tower_room_monster();
      case 'ELITE': return m.eco_tower_room_elite();
      case 'BOSS': return m.eco_tower_room_boss();
      case 'CHEST': return m.eco_tower_room_chest();
      case 'CAMPFIRE': return m.eco_tower_room_campfire();
      case 'MERCHANT': return m.eco_tower_room_merchant();
      case 'SHRINE': return m.eco_tower_room_shrine();
      default: return m.eco_tower_room_empty();
    }
  }

  function tip(type: RoomType): string {
    switch (type) {
      case 'START': return m.eco_tower_room_start_tip();
      case 'MONSTER': return m.eco_tower_room_monster_tip();
      case 'ELITE': return m.eco_tower_room_elite_tip();
      case 'BOSS': return m.eco_tower_room_boss_tip();
      case 'CHEST': return m.eco_tower_room_chest_tip();
      case 'CAMPFIRE': return m.eco_tower_room_campfire_tip();
      case 'MERCHANT': return m.eco_tower_room_merchant_tip();
      case 'SHRINE': return m.eco_tower_room_shrine_tip();
      default: return m.eco_tower_room_empty_tip();
    }
  }

  function roomTitle(room: Room): string {
    const parts = [`${label(room.type)}${room.foe ? ` : ${room.foe}` : ''}`, tip(room.type)];
    const distance = distances.get(room.id);
    if (distance === undefined) parts.push(m.eco_tower_map_unreachable_tip());
    else if (room.type !== 'START') parts.push(m.eco_tower_map_distance_tip({ rooms: distance }));
    return parts.join('\n');
  }

  function offerLabel(offer: OfferKind): string {
    if (offer === 'POTION') return m.eco_tower_offer_potion();
    if (offer === 'HEAL') return m.eco_tower_offer_heal();
    return m.eco_tower_offer_gear();
  }

  function newRoom(x: number, y: number, type: RoomType): Room {
    return { id: `${x}-${y}`, x, y, type, foe: null, chest: 'BOTH', healPercent: 35, offers: [...OFFERS], pricePercent: 100 };
  }

  function exampleLayout(): Layout {
    const r = newRoom;
    return {
      width: 9,
      height: 9,
      rooms: [
        r(3, 8, 'START'), r(3, 7, 'MONSTER'), r(3, 6, 'MONSTER'), r(3, 5, 'CAMPFIRE'),
        r(2, 5, 'MONSTER'), r(1, 5, 'CHEST'), r(4, 5, 'ELITE'), r(5, 5, 'MERCHANT'),
        r(3, 4, 'EMPTY'), r(2, 2, 'BOSS'), r(4, 4, 'MONSTER'), r(5, 4, 'SHRINE'),
        r(6, 4, 'MONSTER'), { ...r(7, 4, 'CHEST'), chest: 'GEAR' },
      ],
    };
  }

  function cloneLayout(source: Layout | null): Layout {
    const base = source ?? { width: 7, height: 7, rooms: [] };
    return { width: base.width, height: base.height, rooms: base.rooms.map((room) => ({ ...room, offers: [...room.offers] })) };
  }

  const actionState = createAsyncActionState();
  let layout = $state<Layout>(cloneLayout(initialLayout));
  let layoutEnabled = $state(initialEnabled);
  let tool = $state<Tool>('MONSTER');
  let selectedId = $state<string | null>(null);
  let painting = $state(false);
  let dirty = $state(false);

  // ── Géométrie (même règles que le bot) ──────────────────────────
  function cellsOf(room: Pick<Room, 'x' | 'y' | 'type'>): [number, number][] {
    if (room.type !== 'BOSS') return [[room.x, room.y]];
    return [[room.x, room.y], [room.x + 1, room.y], [room.x, room.y + 1], [room.x + 1, room.y + 1]];
  }

  const occupied = $derived.by(() => {
    const map = new Map<string, Room>();
    for (const room of layout.rooms) for (const [x, y] of cellsOf(room)) map.set(`${x},${y}`, room);
    return map;
  });

  function neighbors(room: Room): Room[] {
    const found = new Map<string, Room>();
    for (const [x, y] of cellsOf(room)) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const other = occupied.get(`${x + dx},${y + dy}`);
        if (other && other.id !== room.id) found.set(other.id, other);
      }
    }
    return [...found.values()];
  }

  const distances = $derived.by(() => {
    const result = new Map<string, number>();
    const start = layout.rooms.find((room) => room.type === 'START');
    if (!start) return result;
    result.set(start.id, 0);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of neighbors(current)) {
        if (result.has(next.id)) continue;
        result.set(next.id, result.get(current.id)! + 1);
        queue.push(next);
      }
    }
    return result;
  });

  const links = $derived.by(() => {
    const seen = new Set<string>();
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const room of layout.rooms) {
      for (const other of neighbors(room)) {
        const key = [room.id, other.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const a = center(room);
        const b = center(other);
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return lines;
  });

  function center(room: Room): { x: number; y: number } {
    const span = room.type === 'BOSS' ? 2 : 1;
    return { x: (room.x + span / 2) * CELL, y: (room.y + span / 2) * CELL };
  }

  const counts = $derived(Object.fromEntries(ROOM_TYPES.map((type) => [type, layout.rooms.filter((room) => room.type === type).length])) as Record<RoomType, number>);
  const unreachable = $derived(layout.rooms.filter((room) => !distances.has(room.id)).length);
  const bossDepth = $derived.by(() => {
    const depths = layout.rooms.filter((room) => room.type === 'BOSS' && distances.has(room.id)).map((room) => distances.get(room.id)!);
    return depths.length > 0 ? Math.min(...depths) : null;
  });

  const problems = $derived.by(() => {
    const list: string[] = [];
    if (counts.START !== 1) list.push(m.eco_tower_map_need_start());
    if (counts.BOSS === 0) list.push(m.eco_tower_map_need_boss());
    if (counts.START === 1 && unreachable > 0) list.push(m.eco_tower_map_unreachable({ count: unreachable }));
    if (layout.rooms.some((room) => room.type === 'MERCHANT' && room.offers.length === 0)) list.push(m.eco_tower_map_empty_merchant());
    if (layout.rooms.length > roomsMax) list.push(m.eco_tower_map_too_many({ max: roomsMax }));
    return list;
  });

  const selected = $derived(layout.rooms.find((room) => room.id === selectedId) ?? null);
  const foeOptions = $derived.by(() => {
    if (!selected) return [];
    const wantBoss = selected.type === 'BOSS';
    return foes
      .filter((foe) => foe.isBoss === wantBoss)
      .map((foe) => ({ id: foe.name, name: `${foe.emoji} ${foe.name}${foe.enabled ? '' : ` · ${m.eco_tower_map_foe_disabled()}`}` }));
  });

  // ── Édition ─────────────────────────────────────────────────────
  function removeAt(cells: [number, number][]) {
    const doomed = new Set<string>();
    for (const [x, y] of cells) {
      const room = occupied.get(`${x},${y}`);
      if (room) doomed.add(room.id);
    }
    if (doomed.size === 0) return;
    layout.rooms = layout.rooms.filter((room) => !doomed.has(room.id));
    if (selectedId && doomed.has(selectedId)) selectedId = null;
  }

  function apply(x: number, y: number) {
    if (!canManage || disabled) return;
    const existing = occupied.get(`${x},${y}`);

    if (tool === 'SELECT') {
      selectedId = existing?.id ?? null;
      return;
    }
    if (tool === 'ERASE') {
      if (existing) {
        removeAt([[x, y]]);
        dirty = true;
      }
      return;
    }
    if (existing && existing.type === tool && existing.x === x && existing.y === y) {
      selectedId = existing.id;
      return;
    }
    if (tool === 'BOSS' && (x + 1 >= layout.width || y + 1 >= layout.height)) return;
    if (layout.rooms.length >= roomsMax && !existing) return;

    const room = newRoom(x, y, tool);
    removeAt(cellsOf(room));
    // Un seul départ : en poser un nouveau déplace l'ancien.
    if (tool === 'START') layout.rooms = layout.rooms.filter((candidate) => candidate.type !== 'START');
    layout.rooms = [...layout.rooms, room];
    selectedId = room.id;
    dirty = true;
  }

  function pointerDown(event: PointerEvent, x: number, y: number) {
    // Au toucher, le navigateur capture le pointeur sur la première case : sans ce relâchement,
    // glisser le doigt ne peindrait jamais les cases suivantes.
    const target = event.target as Element | null;
    if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    painting = tool !== 'SELECT' && tool !== 'BOSS' && tool !== 'START';
    apply(x, y);
  }

  function pointerEnter(x: number, y: number) {
    if (painting) apply(x, y);
  }

  function resize(width: number, height: number) {
    const w = Math.min(sizeLimits.max, Math.max(sizeLimits.min, Math.trunc(width) || sizeLimits.min));
    const h = Math.min(sizeLimits.max, Math.max(sizeLimits.min, Math.trunc(height) || sizeLimits.min));
    layout = {
      width: w,
      height: h,
      rooms: layout.rooms.filter((room) => cellsOf(room).every(([x, y]) => x < w && y < h)),
    };
    if (selectedId && !layout.rooms.some((room) => room.id === selectedId)) selectedId = null;
    dirty = true;
  }

  function updateSelected(patch: Partial<Room>) {
    if (!selected) return;
    const id = selected.id;
    layout.rooms = layout.rooms.map((room) => (room.id === id ? { ...room, ...patch } : room));
    dirty = true;
  }

  function toggleOffer(offer: OfferKind) {
    if (!selected) return;
    const offers = selected.offers.includes(offer)
      ? selected.offers.filter((entry) => entry !== offer)
      : OFFERS.filter((entry) => entry === offer || selected!.offers.includes(entry));
    updateSelected({ offers });
  }

  function loadExample() {
    layout = exampleLayout();
    selectedId = null;
    dirty = true;
  }

  function clearMap() {
    layout = { width: layout.width, height: layout.height, rooms: [] };
    selectedId = null;
    dirty = true;
  }

  async function save() {
    await actionState.run(async () => {
      await saveRpgTowerLayout({ layoutEnabled, layout: layout.rooms.length > 0 ? layout : null });
      dirty = false;
      await onSaved?.();
      return true;
    });
  }
</script>

<svelte:window onpointerup={() => { painting = false; }} />

<div class="bg-surface-container-low/30 border border-outline-variant/10 p-8 rounded-xl space-y-6">
  <InlineFeedback state={actionState} />

  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/15 pb-4">
    <div>
      <h3 class="text-lg font-semibold">{m.eco_tower_map_title()}</h3>
      <p class="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-2xl">{m.eco_tower_map_desc()}</p>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs font-semibold">{layoutEnabled ? m.eco_tower_map_played() : m.eco_tower_map_random()}</span>
      <ToggleSwitch
        checked={layoutEnabled}
        disabled={!canManage || disabled}
        ariaLabel={m.eco_tower_map_toggle_aria()}
        onToggle={(value: boolean) => { layoutEnabled = value; dirty = true; }}
      />
    </div>
  </div>

  {#if canManage}
    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <label for="mapWidth" class="text-xs font-semibold text-on-surface-variant/60 ml-2">{m.eco_tower_map_width()}</label>
        <input id="mapWidth" type="number" min={sizeLimits.min} max={sizeLimits.max} value={layout.width} disabled={disabled}
          onchange={(e) => resize(Number((e.currentTarget as HTMLInputElement).value), layout.height)}
          class="w-20 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none" />
      </div>
      <div class="space-y-1">
        <label for="mapHeight" class="text-xs font-semibold text-on-surface-variant/60 ml-2">{m.eco_tower_map_height()}</label>
        <input id="mapHeight" type="number" min={sizeLimits.min} max={sizeLimits.max} value={layout.height} disabled={disabled}
          onchange={(e) => resize(layout.width, Number((e.currentTarget as HTMLInputElement).value))}
          class="w-20 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none" />
      </div>
      <button type="button" onclick={loadExample} disabled={disabled} class="px-3 py-2 bg-outline-variant/10 hover:bg-outline-variant/25 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50">
        <Papicon icon="Sparkles" size={12} /> {m.eco_tower_map_example()}
      </button>
      <button type="button" onclick={clearMap} disabled={disabled} class="px-3 py-2 bg-error/10 hover:bg-error/20 text-error text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50">
        <Papicon icon="trash" size={12} /> {m.eco_tower_map_clear()}
      </button>
    </div>

    <!-- Palette -->
    <div class="flex flex-wrap gap-2">
      <button type="button" onclick={() => tool = 'SELECT'} title={m.eco_tower_map_tool_select_tip()} class="px-3 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 {tool === 'SELECT' ? 'border-primary bg-primary/15' : 'border-outline-variant/15 bg-surface-container-high/30 hover:border-outline-variant/40'}">
        <Papicon icon="MousePointer" size={12} /> {m.eco_tower_map_tool_select()}
      </button>
      {#each ROOM_TYPES as type}
        <button type="button" onclick={() => tool = type} title={tip(type)} class="px-3 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 {tool === type ? 'border-primary bg-primary/15' : 'border-outline-variant/15 bg-surface-container-high/30 hover:border-outline-variant/40'}">
          <span style="color: {COLOR[type]}" class="flex"><Papicon icon={ICON[type]} size={13} /></span> {label(type)}
        </button>
      {/each}
      <button type="button" onclick={() => tool = 'ERASE'} title={m.eco_tower_map_tool_erase_tip()} class="px-3 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 {tool === 'ERASE' ? 'border-error bg-error/15 text-error' : 'border-outline-variant/15 bg-surface-container-high/30 hover:border-outline-variant/40'}">
        <Papicon icon="Eraser" size={12} /> {m.eco_tower_map_tool_erase()}
      </button>
    </div>
    <p class="text-2xs text-on-surface-variant/50 -mt-3">{m.eco_tower_map_hint()}</p>
  {/if}

  <div class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
    <!-- Carte -->
    <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-xl p-3 overflow-auto">
      <svg
        viewBox="0 0 {layout.width * CELL} {layout.height * CELL}"
        class="w-full max-w-[720px] mx-auto select-none touch-none"
        role="grid"
        aria-label={m.eco_tower_map_title()}
      >
        {#each Array(layout.height) as _, y}
          {#each Array(layout.width) as __, x}
            <rect
              x={x * CELL + 2} y={y * CELL + 2} width={CELL - 4} height={CELL - 4} rx="8"
              class="fill-outline-variant/5 stroke-outline-variant/15 {canManage ? 'cursor-pointer hover:fill-outline-variant/20' : ''}"
              stroke-width="1"
              role="gridcell"
              tabindex="-1"
              onpointerdown={(event) => pointerDown(event, x, y)}
              onpointerenter={() => pointerEnter(x, y)}
            />
          {/each}
        {/each}

        {#each links as link}
          <line x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} stroke="currentColor" class="text-on-surface-variant/30" stroke-width="6" stroke-linecap="round" pointer-events="none" />
        {/each}

        {#each layout.rooms as room (room.id)}
          {@const span = room.type === 'BOSS' ? 2 : 1}
          {@const reachable = distances.has(room.id)}
          {@const iconSize = room.type === 'BOSS' ? 40 : 22}
          <g
            class={canManage ? 'cursor-pointer' : ''}
            role="gridcell"
            tabindex="-1"
            onpointerdown={(event) => pointerDown(event, room.x, room.y)}
            onpointerenter={() => { if (room.type !== 'BOSS') pointerEnter(room.x, room.y); }}
          >
            <title>{roomTitle(room)}</title>
            <rect
              x={room.x * CELL + 5} y={room.y * CELL + 5}
              width={span * CELL - 10} height={span * CELL - 10}
              rx={room.type === 'BOSS' ? 18 : 10}
              fill={COLOR[room.type]} fill-opacity={room.type === 'EMPTY' ? 0.12 : 0.22}
              stroke={reachable ? COLOR[room.type] : '#ef4444'}
              stroke-width={room.id === selectedId ? 4 : reachable ? 2 : 3}
              stroke-dasharray={reachable ? undefined : '6 4'}
            />
            <g
              transform="translate({(room.x + span / 2) * CELL - iconSize / 2} {(room.y + span / 2) * CELL - iconSize / 2 - (room.type === 'BOSS' ? 6 : 0)})"
              style="color: {COLOR[room.type]}"
              pointer-events="none"
            >
              <Papicon icon={ICON[room.type]} size={iconSize} />
            </g>
            {#if room.type === 'BOSS'}
              <text x={(room.x + 1) * CELL} y={(room.y + 2) * CELL - 16} text-anchor="middle" font-size="11" font-weight="700" fill={COLOR.BOSS} pointer-events="none">
                {room.foe ?? 'BOSS'}
              </text>
            {/if}
            {#if reachable && room.type !== 'START'}
              <text x={room.x * CELL + 11} y={room.y * CELL + 17} font-size="10" font-weight="700" fill="currentColor" class="text-on-surface-variant/70" pointer-events="none">
                {distances.get(room.id)}
              </text>
            {/if}
          </g>
        {/each}
      </svg>
    </div>

    <!-- Informations et salle sélectionnée -->
    <div class="space-y-4">
      <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4 space-y-2 text-xs">
        <p class="font-semibold">{m.eco_tower_map_summary({ rooms: layout.rooms.length, max: roomsMax })}</p>
        <p class="text-on-surface-variant/70">
          {bossDepth !== null ? m.eco_tower_map_boss_depth({ rooms: bossDepth }) : m.eco_tower_map_no_path()}
        </p>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-on-surface-variant/70">
          {#each ROOM_TYPES as type}
            {#if counts[type] > 0}<span class="flex items-center gap-1" title={label(type)}><span style="color: {COLOR[type]}" class="flex"><Papicon icon={ICON[type]} size={11} /></span> {counts[type]}</span>{/if}
          {/each}
        </div>
        {#if problems.length > 0}
          <ul class="space-y-1 pt-1">
            {#each problems as problem}
              <li class="text-2xs text-warning flex items-start gap-1.5"><Papicon icon="AlertTriangle" size={11} /> {problem}</li>
            {/each}
          </ul>
        {/if}
        <p class="text-2xs text-on-surface-variant/50 leading-relaxed pt-1">{m.eco_tower_map_rules()}</p>
      </div>

      {#if selected}
        {#key selected.id}
        <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-bold flex items-center gap-2" title={tip(selected.type)}><span style="color: {COLOR[selected.type]}" class="flex"><Papicon icon={ICON[selected.type]} size={16} /></span> {label(selected.type)}</p>
            <span class="text-2xs text-on-surface-variant/50 font-mono">{selected.x},{selected.y}</span>
          </div>

          {#if selected.type === 'MONSTER' || selected.type === 'ELITE' || selected.type === 'BOSS'}
            <div class="space-y-1">
              <span class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_foe()}</span>
              <SearchableSelect
                value={selected.foe}
                options={foeOptions}
                placeholder={m.eco_tower_map_foe_random()}
                clearable={true}
                showId={false}
                className="w-full"
                on:change={(e: any) => updateSelected({ foe: e.detail?.value ?? null })}
              />
            </div>
          {:else if selected.type === 'CHEST'}
            <div class="space-y-1">
              <span class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_chest()}</span>
              <div class="flex gap-1.5">
                {#each [['BOTH', m.eco_tower_map_chest_both()], ['GOLD', m.eco_tower_map_chest_gold()], ['GEAR', m.eco_tower_map_chest_gear()]] as [kind, text]}
                  <button type="button" disabled={!canManage || disabled} onclick={() => updateSelected({ chest: kind as ChestKind })}
                    class="flex-1 px-2 py-1.5 rounded-lg text-2xs font-bold border {selected.chest === kind ? 'border-primary bg-primary/15' : 'border-outline-variant/15'}">{text}</button>
                {/each}
              </div>
            </div>
          {:else if selected.type === 'CAMPFIRE'}
            <div class="space-y-1">
              <label for="roomHeal" class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_heal()}</label>
              <input id="roomHeal" type="number" min="5" max="100" value={selected.healPercent} disabled={!canManage || disabled}
                onchange={(e) => updateSelected({ healPercent: Math.min(100, Math.max(5, Number((e.currentTarget as HTMLInputElement).value) || 35)) })}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none" />
            </div>
          {:else if selected.type === 'MERCHANT'}
            <div class="space-y-2">
              <span class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_offers()}</span>
              <div class="flex flex-col gap-1.5">
                {#each OFFERS as offer}
                  <label class="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={selected.offers.includes(offer)} disabled={!canManage || disabled} onchange={() => toggleOffer(offer)} />
                    {offerLabel(offer)}
                  </label>
                {/each}
              </div>
              <label for="roomPrice" class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_price()}</label>
              <input id="roomPrice" type="number" min="10" max="500" value={selected.pricePercent} disabled={!canManage || disabled}
                onchange={(e) => updateSelected({ pricePercent: Math.min(500, Math.max(10, Number((e.currentTarget as HTMLInputElement).value) || 100)) })}
                class="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none" />
            </div>
          {:else}
            <p class="text-2xs text-on-surface-variant/60">{m.eco_tower_map_no_option()}</p>
          {/if}
          <p class="text-2xs text-on-surface-variant/50 leading-relaxed">{tip(selected.type)}</p>
        </div>
        {/key}
      {:else}
        <p class="text-2xs text-on-surface-variant/50 italic px-1">{m.eco_tower_map_select_hint()}</p>
      {/if}
    </div>
  </div>

  {#if canManage}
    <div class="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant/10">
      {#if dirty}<span class="text-2xs text-warning">{m.eco_tower_map_unsaved()}</span>{/if}
      <button
        type="button"
        onclick={save}
        disabled={disabled || actionState.state.loading || (layout.rooms.length > 0 && problems.length > 0) || (layoutEnabled && layout.rooms.length === 0)}
        class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50"
      >
        {m.eco_btn_save()}
      </button>
    </div>
  {/if}
</div>
