<script lang="ts">
  /**
   * Éditeur des étages de la Tour.
   *
   * La tour est une pile d'étages, du rez-de-chaussée au sommet, qui se jouent dans l'ordre
   * puis recommencent au premier. Chaque étage est une grille où l'on peint des salles : deux
   * salles qui se touchent par un côté communiquent, une case vide est un mur, le gardien
   * occupe une grande salle de 2×2. La géométrie reprend celle du bot (`rpgTowerMap.ts`) :
   * ce qui s'affiche ici est ce que le joueur parcourra sur Discord, et le serveur revalide
   * tout à l'enregistrement.
   */
  import { m } from '../../i18n';
  import { createAsyncActionState } from '../../asyncAction.svelte';
  import { previewRpgTowerFloor, saveRpgTowerLayout } from '../../api';
  import { confirmDialog } from '../../stores/confirmDialog.svelte';
  import Papicon from '../Papicon.svelte';
  import InlineFeedback from '../InlineFeedback.svelte';
  import SearchableSelect from '../SearchableSelect.svelte';
  import ToggleSwitch from '../ToggleSwitch.svelte';

  type RoomType = 'START' | 'MONSTER' | 'ELITE' | 'BOSS' | 'STAIRS' | 'TRIAL' | 'GATE' | 'SEAL'
    | 'CHEST' | 'CAMPFIRE' | 'MERCHANT' | 'SHRINE' | 'EVENT' | 'EMPTY';
  type Category = 'ENTRY' | 'MONSTERS' | 'EXITS' | 'OTHER';
  type Trait = 'ARMORED' | 'VAMPIRIC' | 'SWIFT' | 'THORNY' | 'BERSERK' | 'REGENERATING';
  type Mechanic = 'RANDOM' | 'NONE' | 'SHIELD' | 'SUMMONER' | 'PHASES';
  type EventChoice = 'RANDOM' | 'BLOOD_ALTAR' | 'GAMBLER' | 'SPRING' | 'BLACKSMITH' | 'CURSED_PACT';
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
    traits: Trait[];
    mechanic: Mechanic;
    event: EventChoice;
    key: boolean;
  };
  type Layout = { name: string; width: number; height: number; fog: boolean; rooms: Room[] };
  type Foe = { name: string; emoji: string; isBoss: boolean; enabled: boolean };
  type Tool = RoomType | 'ERASE' | 'SELECT';

  const {
    canManage = false,
    disabled = false,
    initialFloors = [],
    foes = [],
    sizeLimits = { min: 3, max: 12 },
    roomsMax = 100,
    floorsMax = 12,
    growthPercent = 8,
    floorsAfter = 'LOOP',
    onSaved,
  }: {
    canManage?: boolean;
    disabled?: boolean;
    initialFloors?: Layout[];
    foes?: Foe[];
    sizeLimits?: { min: number; max: number };
    roomsMax?: number;
    floorsMax?: number;
    growthPercent?: number;
    floorsAfter?: 'GENERATE' | 'LOOP';
    onSaved?: () => void | Promise<void>;
  } = $props();

  const CELL = 56;
  // Cadre de pierre autour de la grille et hauteur des créneaux, en unités du dessin.
  const FRAME = 18;
  const CRENEL = 22;
  const ROOM_TYPES: RoomType[] = ['START', 'MONSTER', 'ELITE', 'BOSS', 'STAIRS', 'TRIAL', 'GATE', 'SEAL', 'CHEST', 'CAMPFIRE', 'MERCHANT', 'SHRINE', 'EVENT', 'EMPTY'];
  // Sorties d'un étage (miroir de `TOWER_EXIT_TYPES`) : exactement une par étage.
  const EXITS: RoomType[] = ['BOSS', 'STAIRS', 'TRIAL', 'GATE'];
  const isExit = (type: RoomType) => EXITS.includes(type);
  // La palette est rangée par familles : on cherche une sortie parmi les sorties, pas dans une liste de quatorze.
  const CATEGORIES: { id: Category; icon: string; types: RoomType[] }[] = [
    { id: 'ENTRY', icon: 'LogIn', types: ['START'] },
    { id: 'MONSTERS', icon: 'Swords', types: ['MONSTER', 'ELITE'] },
    { id: 'EXITS', icon: 'Flag', types: ['BOSS', 'STAIRS', 'TRIAL', 'GATE', 'SEAL'] },
    { id: 'OTHER', icon: 'LayoutGrid', types: ['CHEST', 'CAMPFIRE', 'MERCHANT', 'SHRINE', 'EVENT', 'EMPTY'] },
  ];
  // Mêmes valeurs que `rpgTowerContent.ts` côté bot.
  const TRAITS: Trait[] = ['ARMORED', 'VAMPIRIC', 'SWIFT', 'THORNY', 'BERSERK', 'REGENERATING'];
  const TRAITS_MAX = 2;
  const MECHANICS: Mechanic[] = ['RANDOM', 'NONE', 'SHIELD', 'SUMMONER', 'PHASES'];
  const EVENTS: EventChoice[] = ['RANDOM', 'BLOOD_ALTAR', 'GAMBLER', 'SPRING', 'BLACKSMITH', 'CURSED_PACT'];
  // Force des monstres (miroir de `towerMonsterStats`) : 70 PV au niveau 1, croissance divisée par deux après 25.
  const MONSTER_BASE_HEALTH = 70;
  const GROWTH_KNEE = 25;
  // Mêmes pictogrammes que les emojis d'application du bot sur Discord.
  const ICON: Record<RoomType, string> = {
    START: 'DoorOpen', MONSTER: 'Swords', ELITE: 'Skull', BOSS: 'Crown', CHEST: 'PackageOpen',
    CAMPFIRE: 'Flame', MERCHANT: 'ShoppingCart', SHRINE: 'Sparkles', EVENT: 'HelpCircle', EMPTY: 'Square',
    STAIRS: 'ArrowUpCircle', TRIAL: 'Hourglass', GATE: 'Flag', SEAL: 'Target',
  };
  const COLOR: Record<RoomType, string> = {
    START: '#64748b', MONSTER: '#ef4444', ELITE: '#a855f7', BOSS: '#f59e0b', CHEST: '#eab308',
    CAMPFIRE: '#f97316', MERCHANT: '#10b981', SHRINE: '#38bdf8', EVENT: '#e879f9', EMPTY: '#94a3b8',
    STAIRS: '#22d3ee', TRIAL: '#f43f5e', GATE: '#c084fc', SEAL: '#a78bfa',
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
      case 'EVENT': return m.eco_tower_room_event();
      case 'STAIRS': return m.eco_tower_room_stairs();
      case 'TRIAL': return m.eco_tower_room_trial();
      case 'GATE': return m.eco_tower_room_gate();
      case 'SEAL': return m.eco_tower_room_seal();
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
      case 'EVENT': return m.eco_tower_room_event_tip();
      case 'STAIRS': return m.eco_tower_room_stairs_tip();
      case 'TRIAL': return m.eco_tower_room_trial_tip();
      case 'GATE': return m.eco_tower_room_gate_tip();
      case 'SEAL': return m.eco_tower_room_seal_tip();
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

  function categoryLabel(category: Category): string {
    switch (category) {
      case 'ENTRY': return m.eco_tower_category_entry();
      case 'MONSTERS': return m.eco_tower_category_monsters();
      case 'EXITS': return m.eco_tower_category_exits();
      default: return m.eco_tower_category_other();
    }
  }

  function categoryTip(category: Category): string {
    switch (category) {
      case 'ENTRY': return m.eco_tower_category_entry_tip();
      case 'MONSTERS': return m.eco_tower_category_monsters_tip();
      case 'EXITS': return m.eco_tower_category_exits_tip();
      default: return m.eco_tower_category_other_tip();
    }
  }

  function traitLabel(trait: Trait): string {
    switch (trait) {
      case 'ARMORED': return m.eco_tower_trait_armored();
      case 'VAMPIRIC': return m.eco_tower_trait_vampiric();
      case 'SWIFT': return m.eco_tower_trait_swift();
      case 'THORNY': return m.eco_tower_trait_thorny();
      case 'BERSERK': return m.eco_tower_trait_berserk();
      default: return m.eco_tower_trait_regenerating();
    }
  }

  function traitTip(trait: Trait): string {
    switch (trait) {
      case 'ARMORED': return m.eco_tower_trait_armored_tip();
      case 'VAMPIRIC': return m.eco_tower_trait_vampiric_tip();
      case 'SWIFT': return m.eco_tower_trait_swift_tip();
      case 'THORNY': return m.eco_tower_trait_thorny_tip();
      case 'BERSERK': return m.eco_tower_trait_berserk_tip();
      default: return m.eco_tower_trait_regenerating_tip();
    }
  }

  function mechanicLabel(mechanic: Mechanic): string {
    switch (mechanic) {
      case 'RANDOM': return m.eco_tower_choice_random();
      case 'NONE': return m.eco_tower_choice_none();
      case 'SHIELD': return m.eco_tower_mechanic_shield();
      case 'SUMMONER': return m.eco_tower_mechanic_summoner();
      default: return m.eco_tower_mechanic_phases();
    }
  }

  function mechanicTip(mechanic: Mechanic): string {
    switch (mechanic) {
      case 'RANDOM': return m.eco_tower_mechanic_random_tip();
      case 'NONE': return m.eco_tower_mechanic_none_tip();
      case 'SHIELD': return m.eco_tower_mechanic_shield_tip();
      case 'SUMMONER': return m.eco_tower_mechanic_summoner_tip();
      default: return m.eco_tower_mechanic_phases_tip();
    }
  }

  function eventLabel(event: EventChoice): string {
    switch (event) {
      case 'RANDOM': return m.eco_tower_choice_random();
      case 'BLOOD_ALTAR': return m.eco_tower_event_blood_altar();
      case 'GAMBLER': return m.eco_tower_event_gambler();
      case 'SPRING': return m.eco_tower_event_spring();
      case 'BLACKSMITH': return m.eco_tower_event_blacksmith();
      default: return m.eco_tower_event_cursed_pact();
    }
  }

  function eventTip(event: EventChoice): string {
    switch (event) {
      case 'RANDOM': return m.eco_tower_event_random_tip();
      case 'BLOOD_ALTAR': return m.eco_tower_event_blood_altar_tip();
      case 'GAMBLER': return m.eco_tower_event_gambler_tip();
      case 'SPRING': return m.eco_tower_event_spring_tip();
      case 'BLACKSMITH': return m.eco_tower_event_blacksmith_tip();
      default: return m.eco_tower_event_cursed_pact_tip();
    }
  }

  function newRoom(x: number, y: number, type: RoomType): Room {
    return {
      id: `${x}-${y}`, x, y, type, foe: null, chest: 'BOTH', healPercent: 35, offers: [...OFFERS], pricePercent: 100,
      traits: [], mechanic: 'RANDOM', event: 'RANDOM', key: false,
    };
  }

  function exampleLayout(): Layout {
    const r = newRoom;
    return {
      name: '',
      fog: true,
      width: 9,
      height: 9,
      rooms: [
        r(3, 8, 'START'), r(3, 7, 'MONSTER'), r(3, 6, 'MONSTER'), r(3, 5, 'CAMPFIRE'),
        r(2, 5, 'MONSTER'), r(1, 5, 'CHEST'), r(4, 5, 'ELITE'), r(5, 5, 'MERCHANT'),
        r(3, 4, 'EVENT'), r(2, 2, 'BOSS'), r(4, 4, 'MONSTER'), r(5, 4, 'SHRINE'),
        r(6, 4, 'MONSTER'), { ...r(7, 4, 'CHEST'), chest: 'GEAR' },
      ],
    };
  }

  function cloneLayout(source: Partial<Layout> | null): Layout {
    return {
      name: source?.name ?? '',
      // Un étage neuf a son brouillard ; un étage enregistré sans ce champ n'en avait pas.
      fog: source ? source.fog === true : true,
      width: source?.width ?? 7,
      height: source?.height ?? 7,
      rooms: (source?.rooms ?? []).map((room) => ({
        ...room,
        offers: [...room.offers],
        traits: [...(room.traits ?? [])],
        mechanic: room.mechanic ?? 'RANDOM',
        event: room.event ?? 'RANDOM',
        key: room.key === true,
      })),
    };
  }

  const actionState = createAsyncActionState();
  // L'éditeur est recréé à chaque chargement : il part des étages enregistrés à ce moment-là.
  const seeded = initialFloors.length > 0 ? initialFloors.map((floor) => cloneLayout(floor)) : [cloneLayout(null)];
  // `floors` garde une copie de chaque étage ; `layout` est l'étage ouvert, recopié à chaque changement d'étage.
  let floors = $state<Layout[]>(seeded);
  let current = $state(0);
  let layout = $state<Layout>(cloneLayout(seeded[0]));
  let tool = $state<Tool>('MONSTER');
  let category = $state<Category>('MONSTERS');
  let selectedId = $state<string | null>(null);
  let painting = $state(false);
  let dirty = $state(false);
  let preview = $state<string | null>(null);
  let previewing = $state(false);

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
    const depths = layout.rooms.filter((room) => isExit(room.type) && distances.has(room.id)).map((room) => distances.get(room.id)!);
    return depths.length > 0 ? Math.min(...depths) : null;
  });

  /** Règles de la sortie, mêmes que le serveur : une seule, et ce qui l'ouvre avec elle. */
  function exitProblems(floor: Layout): string[] {
    const list: string[] = [];
    const exits = floor.rooms.filter((room) => isExit(room.type));
    const keys = floor.rooms.filter((room) => room.key).length;
    const seals = floor.rooms.filter((room) => room.type === 'SEAL').length;
    if (exits.length === 0) list.push(m.eco_tower_map_need_exit());
    if (exits.length > 1) list.push(m.eco_tower_map_one_exit());
    const exit = exits.length === 1 ? exits[0].type : null;
    if (exit === 'STAIRS' && keys === 0) list.push(m.eco_tower_map_stairs_need_key());
    if (exit !== 'STAIRS' && keys > 0) list.push(m.eco_tower_map_keys_without_stairs());
    if (exit === 'GATE' && seals === 0) list.push(m.eco_tower_map_gate_need_seal());
    if (exit !== 'GATE' && seals > 0) list.push(m.eco_tower_map_seals_without_gate());
    return list;
  }

  const problems = $derived.by(() => {
    const list: string[] = [];
    if (counts.START !== 1) list.push(m.eco_tower_map_need_start());
    list.push(...exitProblems(layout));
    if (counts.START === 1 && unreachable > 0) list.push(m.eco_tower_map_unreachable({ count: unreachable }));
    if (layout.rooms.some((room) => room.type === 'MERCHANT' && room.offers.length === 0)) list.push(m.eco_tower_map_empty_merchant());
    if (layout.rooms.length > roomsMax) list.push(m.eco_tower_map_too_many({ max: roomsMax }));
    return list;
  });

  // ── Étages ──────────────────────────────────────────────────────
  /** Mêmes règles que le serveur : un départ, un gardien, tout relié, aucun marchand vide. */
  function floorValid(floor: Layout): boolean {
    if (floor.rooms.length === 0 || floor.rooms.length > roomsMax) return false;
    const starts = floor.rooms.filter((room) => room.type === 'START');
    if (starts.length !== 1 || exitProblems(floor).length > 0) return false;
    if (floor.rooms.some((room) => room.type === 'MERCHANT' && room.offers.length === 0)) return false;
    const cells = new Map<string, Room>();
    for (const room of floor.rooms) for (const [x, y] of cellsOf(room)) cells.set(`${x},${y}`, room);
    const reached = new Set([starts[0].id]);
    const queue = [starts[0]];
    while (queue.length > 0) {
      const room = queue.shift()!;
      for (const [x, y] of cellsOf(room)) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const other = cells.get(`${x + dx},${y + dy}`);
          if (other && !reached.has(other.id)) {
            reached.add(other.id);
            queue.push(other);
          }
        }
      }
    }
    return reached.size === floor.rooms.length;
  }

  // L'étage ouvert se lit dans `layout`, les autres dans leur copie.
  const allFloors = $derived(floors.map((floor, index) => (index === current ? layout : floor)));
  const towerEmpty = $derived(allFloors.length === 1 && allFloors[0].rooms.length === 0);
  const invalidFloors = $derived(towerEmpty ? 0 : allFloors.filter((floor) => !floorValid(floor)).length);
  // Du sommet au rez-de-chaussée, comme on lit une tour.
  const stack = $derived(allFloors.map((floor, index) => ({ floor, index })).reverse());

  /** Distance au gardien et salles à résoudre d'un étage, pour estimer la profondeur. */
  function floorSpan(floor: Layout): { shortest: number; rooms: number } {
    const cells = new Map<string, Room>();
    for (const room of floor.rooms) for (const [x, y] of cellsOf(room)) cells.set(`${x},${y}`, room);
    const start = floor.rooms.find((room) => room.type === 'START');
    const rooms = floor.rooms.filter((room) => room.type !== 'START' && room.type !== 'EMPTY').length;
    if (!start) return { shortest: 0, rooms };
    const distance = new Map([[start.id, 0]]);
    const queue = [start];
    while (queue.length > 0) {
      const room = queue.shift()!;
      for (const [x, y] of cellsOf(room)) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const other = cells.get(`${x + dx},${y + dy}`);
          if (other && !distance.has(other.id)) {
            distance.set(other.id, distance.get(room.id)! + 1);
            queue.push(other);
          }
        }
      }
    }
    const boss = floor.rooms.filter((room) => isExit(room.type)).map((room) => distance.get(room.id)).filter((value): value is number => value !== undefined);
    return { shortest: boss.length > 0 ? Math.min(...boss) : 0, rooms };
  }

  function monsterHealth(level: number): number {
    const rate = growthPercent / 100;
    const steps = Math.max(0, level - 1);
    const steep = Math.min(steps, GROWTH_KNEE - 1);
    return Math.round(MONSTER_BASE_HEALTH * Math.pow(1 + rate, steep) * Math.pow(1 + rate / 2, steps - steep));
  }

  /**
   * Difficulté estimée de l'étage ouvert : la force des monstres suit les salles résolues
   * depuis l'entrée. Au plus bas, le joueur a filé droit au gardien de chaque étage ; au plus
   * haut, il a tout exploré.
   */
  const difficulty = $derived.by(() => {
    let low = 1;
    let high = 1;
    for (let index = 0; index < current; index++) {
      const span = floorSpan(allFloors[index]);
      low += span.shortest;
      high += span.rooms;
    }
    const own = floorSpan(layout);
    return { from: low, to: high + own.rooms, healthFrom: monsterHealth(low), healthTo: monsterHealth(high + own.rooms) };
  });

  async function openPreview() {
    previewing = true;
    try {
      const res = await previewRpgTowerFloor({ layout, floor: current + 1 });
      preview = res?.image ?? null;
    } catch (err) {
      console.error(err);
    } finally {
      previewing = false;
    }
  }

  function toggleTrait(trait: Trait) {
    if (!selected) return;
    const has = selected.traits.includes(trait);
    if (!has && selected.traits.length >= TRAITS_MAX) return;
    updateSelected({ traits: has ? selected.traits.filter((entry) => entry !== trait) : [...selected.traits, trait] });
  }

  function commit() {
    floors[current] = cloneLayout(layout);
  }

  function selectFloor(index: number) {
    if (index === current) return;
    commit();
    current = index;
    layout = cloneLayout(floors[index]);
    selectedId = null;
  }

  function addFloor() {
    if (floors.length >= floorsMax) return;
    commit();
    floors = [...floors, cloneLayout({ width: layout.width, height: layout.height })];
    current = floors.length - 1;
    layout = cloneLayout(floors[current]);
    selectedId = null;
    dirty = true;
  }

  function duplicateFloor() {
    if (floors.length >= floorsMax) return;
    commit();
    const copy = cloneLayout(floors[current]);
    floors = [...floors.slice(0, current + 1), copy, ...floors.slice(current + 1)];
    current += 1;
    layout = cloneLayout(copy);
    selectedId = null;
    dirty = true;
  }

  function moveFloor(delta: number) {
    const target = current + delta;
    if (target < 0 || target >= floors.length) return;
    commit();
    const next = [...floors];
    [next[current], next[target]] = [next[target], next[current]];
    floors = next;
    current = target;
    dirty = true;
  }

  async function removeFloor() {
    if (floors.length <= 1) {
      clearMap();
      return;
    }
    const confirmed = await confirmDialog.danger(
      m.eco_tower_floor_delete_confirm({ floor: current + 1 }),
      m.eco_tower_floor_delete_confirm_desc(),
    );
    if (!confirmed) return;
    floors = floors.filter((_, index) => index !== current);
    current = Math.min(current, floors.length - 1);
    layout = cloneLayout(floors[current]);
    selectedId = null;
    dirty = true;
  }

  const selected = $derived(layout.rooms.find((room) => room.id === selectedId) ?? null);

  const frameW = $derived(layout.width * CELL + FRAME * 2);
  const frameH = $derived(layout.height * CELL + FRAME * 2);
  // En nombre impair, pour qu'un créneau tombe sur chaque angle.
  const merlons = $derived(Math.max(5, Math.round(frameW / 44) | 1));
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
    // Un seul départ et une seule sortie par étage : en poser une nouvelle remplace l'ancienne.
    if (tool === 'START') layout.rooms = layout.rooms.filter((candidate) => candidate.type !== 'START');
    if (isExit(tool)) layout.rooms = layout.rooms.filter((candidate) => !isExit(candidate.type));
    layout.rooms = [...layout.rooms, room];
    selectedId = room.id;
    dirty = true;
  }

  function pointerDown(event: PointerEvent, x: number, y: number) {
    // Au toucher, le navigateur capture le pointeur sur la première case : sans ce relâchement,
    // glisser le doigt ne peindrait jamais les cases suivantes.
    const target = event.target as Element | null;
    if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    // Départ et sortie se posent une fois : glisser ne les répète pas.
    painting = tool !== 'SELECT' && tool !== 'START' && !(tool !== 'ERASE' && isExit(tool));
    apply(x, y);
  }

  function pointerEnter(x: number, y: number) {
    if (painting) apply(x, y);
  }

  function resize(width: number, height: number) {
    const w = Math.min(sizeLimits.max, Math.max(sizeLimits.min, Math.trunc(width) || sizeLimits.min));
    const h = Math.min(sizeLimits.max, Math.max(sizeLimits.min, Math.trunc(height) || sizeLimits.min));
    layout = {
      name: layout.name,
      fog: layout.fog,
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
    layout = { ...exampleLayout(), name: layout.name, fog: layout.fog };
    selectedId = null;
    dirty = true;
  }

  function clearMap() {
    layout = { name: layout.name, fog: layout.fog, width: layout.width, height: layout.height, rooms: [] };
    selectedId = null;
    dirty = true;
  }

  async function save() {
    commit();
    await actionState.run(async () => {
      // Aucun étage dessiné : la Tour génère les siens.
      await saveRpgTowerLayout({ floors: towerEmpty ? [] : floors });
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
  </div>

  <!-- Ce que les joueurs vont réellement parcourir, dit en clair. -->
  <p class="text-xs flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
    <Papicon icon="Info" size={13} />
    {towerEmpty
      ? m.eco_tower_map_status_generated()
      : floorsAfter === 'GENERATE'
        ? m.eco_tower_map_status_then_generated({ floors: floors.length })
        : m.eco_tower_map_status_then_loop({ floors: floors.length })}
  </p>

  {#if canManage}
    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <label for="floorName" class="text-xs font-semibold text-on-surface-variant/60 ml-2">{m.eco_tower_floor_name()} · {m.eco_tower_floor_label({ floor: current + 1 })}</label>
        <input id="floorName" type="text" maxlength="40" bind:value={layout.name} disabled={disabled} oninput={() => { dirty = true; }}
          placeholder={m.eco_tower_floor_name_placeholder()}
          class="w-56 bg-surface-container-high/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none" />
      </div>
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
      <div class="flex items-center gap-2 px-2" title={m.eco_tower_fog_tip()}>
        <ToggleSwitch checked={layout.fog} disabled={disabled} ariaLabel={m.eco_tower_fog()} onToggle={(value: boolean) => { layout.fog = value; dirty = true; }} />
        <span class="text-xs font-semibold flex items-center gap-1"><Papicon icon="Eye" size={12} /> {m.eco_tower_fog()}</span>
      </div>
      <button type="button" onclick={openPreview} disabled={previewing || problems.length > 0 || layout.rooms.length === 0} title={m.eco_tower_preview_tip()}
        class="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50">
        <Papicon icon="Image" size={12} /> {m.eco_tower_preview_btn()}
      </button>
    </div>

    <!-- Palette : les outils toujours à portée, puis les salles rangées par famille. -->
    <div class="rounded-xl border border-outline-variant/15 bg-surface-container-high/20 overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-2 border-b border-outline-variant/10">
        <button type="button" onclick={() => tool = 'SELECT'} title={m.eco_tower_map_tool_select_tip()} class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 {tool === 'SELECT' ? 'border-primary bg-primary/15' : 'border-transparent hover:bg-outline-variant/10'}">
          <Papicon icon="MousePointer" size={12} /> {m.eco_tower_map_tool_select()}
        </button>
        <button type="button" onclick={() => tool = 'ERASE'} title={m.eco_tower_map_tool_erase_tip()} class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 {tool === 'ERASE' ? 'border-error bg-error/15 text-error' : 'border-transparent hover:bg-outline-variant/10'}">
          <Papicon icon="Eraser" size={12} /> {m.eco_tower_map_tool_erase()}
        </button>
        <span class="w-px h-6 bg-outline-variant/20 mx-1" aria-hidden="true"></span>
        <div class="flex flex-wrap gap-1" role="tablist" aria-label={m.eco_tower_categories_aria()}>
          {#each CATEGORIES as entry (entry.id)}
            {@const placed = entry.types.reduce((sum, type) => sum + counts[type], 0)}
            <button type="button" role="tab" aria-selected={category === entry.id} title={categoryTip(entry.id)} onclick={() => { category = entry.id; }}
              class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 {category === entry.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant/80 hover:bg-outline-variant/10'}">
              <Papicon icon={entry.icon} size={12} /> {categoryLabel(entry.id)}
              {#if placed > 0}<span class="text-2xs px-1.5 rounded-full {category === entry.id ? 'bg-on-primary/20' : 'bg-outline-variant/20'}">{placed}</span>{/if}
            </button>
          {/each}
        </div>
      </div>
      {#each CATEGORIES.filter((entry) => entry.id === category) as entry (entry.id)}
        <div class="p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {#each entry.types as type}
            <button type="button" onclick={() => tool = type} title={tip(type)}
              class="group text-left p-2 rounded-lg border transition-all flex items-start gap-2 {tool === type ? 'bg-surface-container-high/60' : 'border-outline-variant/10 hover:border-outline-variant/30'}"
              style={tool === type ? `border-color: ${COLOR[type]}; box-shadow: inset 3px 0 0 ${COLOR[type]}` : ''}>
              <span class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: {COLOR[type]}26; color: {COLOR[type]}">
                <Papicon icon={ICON[type]} size={14} />
              </span>
              <span class="min-w-0">
                <span class="flex items-center gap-1 text-xs font-bold">{label(type)}{#if counts[type] > 0}<span class="text-2xs text-on-surface-variant/50 font-mono">×{counts[type]}</span>{/if}</span>
                <span class="block text-2xs text-on-surface-variant/55 leading-snug line-clamp-2">{tip(type)}</span>
              </span>
            </button>
          {/each}
        </div>
        {#if entry.id === 'EXITS'}
          <p class="px-3 pb-2 text-2xs text-on-surface-variant/60 flex items-start gap-1.5"><Papicon icon="Info" size={11} /> {m.eco_tower_category_exits_rule()}</p>
        {/if}
      {/each}
    </div>
    <p class="text-2xs text-on-surface-variant/50">{m.eco_tower_map_hint()}</p>
  {/if}

  <div class="grid grid-cols-1 xl:grid-cols-[220px_1fr_300px] gap-6">
    <!-- La tour : un étage par carte, du rez-de-chaussée au sommet -->
    <div class="space-y-3">
      <div>
        <p class="text-sm font-bold flex items-center gap-2"><Papicon icon="Building" size={14} /> {m.eco_tower_floors_title()}</p>
        <p class="text-2xs text-on-surface-variant/60 leading-relaxed mt-1">{m.eco_tower_floors_desc()}</p>
      </div>
      <div>
        <div class="flex justify-between px-0.5" aria-hidden="true">
          {#each Array(5) as _}<span class="w-6 h-3 rounded-t-sm bg-outline-variant/35"></span>{/each}
        </div>
        <div class="border-x-4 border-b-4 border-t-4 border-outline-variant/35 rounded-b-lg p-1.5 space-y-1.5 bg-outline-variant/5">
          {#if canManage}
            <button type="button" onclick={addFloor} disabled={disabled || floors.length >= floorsMax} title={m.eco_tower_floors_max({ max: floorsMax })}
              class="w-full px-2 py-1.5 rounded-md border border-dashed border-outline-variant/30 text-2xs font-bold flex items-center justify-center gap-1 hover:bg-outline-variant/10 disabled:opacity-40">
              <Papicon icon="Plus" size={11} /> {m.eco_tower_floor_add()}
            </button>
          {/if}
          {#each stack as entry (entry.index)}
            {@const valid = towerEmpty || floorValid(entry.floor)}
            <button type="button" onclick={() => selectFloor(entry.index)}
              title={valid ? '' : m.eco_tower_floor_invalid()}
              class="w-full text-left rounded-md px-2.5 py-2 border transition-all {entry.index === current ? 'border-primary bg-primary/15' : 'border-outline-variant/15 bg-surface-container-high/40 hover:border-outline-variant/40'}">
              <span class="flex items-center justify-between gap-2">
                <span class="text-2xs font-mono text-on-surface-variant/60">{m.eco_tower_floor_label({ floor: entry.index + 1 })}</span>
                {#if !valid}<span class="text-warning flex"><Papicon icon="AlertTriangle" size={11} /></span>{/if}
              </span>
              <span class="flex items-center gap-2">
                <!-- Vignette de l'étage, pour le reconnaître d'un coup d'œil. -->
                <svg viewBox="0 0 {entry.floor.width} {entry.floor.height}" class="w-10 h-10 shrink-0 rounded bg-surface-container-low" aria-hidden="true">
                  {#each entry.floor.rooms as room}
                    <rect x={room.x + 0.1} y={room.y + 0.1} width={(room.type === 'BOSS' ? 2 : 1) - 0.2} height={(room.type === 'BOSS' ? 2 : 1) - 0.2} rx="0.2" fill={COLOR[room.type]} fill-opacity="0.85" />
                  {/each}
                </svg>
                <span class="min-w-0">
                  <span class="block text-xs font-semibold truncate">{entry.floor.name || '—'}</span>
                  <span class="block text-2xs text-on-surface-variant/50">{m.eco_tower_map_summary({ rooms: entry.floor.rooms.length, max: roomsMax })}</span>
                </span>
              </span>
            </button>
          {/each}
        </div>
        <div class="h-2 mx-[-6px] rounded-sm bg-outline-variant/35" aria-hidden="true"></div>
      </div>
      <p class="text-2xs text-on-surface-variant/50 leading-relaxed">
        {floorsAfter === 'GENERATE' ? m.eco_tower_floors_after_generate_note() : m.eco_tower_floors_after_loop_note()}
      </p>
      {#if canManage}
        <div class="grid grid-cols-2 gap-1.5">
          <button type="button" onclick={() => moveFloor(1)} disabled={disabled || current >= floors.length - 1} class="px-2 py-1.5 rounded-md bg-outline-variant/10 hover:bg-outline-variant/25 text-2xs font-bold flex items-center justify-center gap-1 disabled:opacity-40">
            <Papicon icon="ArrowUp" size={11} /> {m.eco_tower_floor_up()}
          </button>
          <button type="button" onclick={() => moveFloor(-1)} disabled={disabled || current <= 0} class="px-2 py-1.5 rounded-md bg-outline-variant/10 hover:bg-outline-variant/25 text-2xs font-bold flex items-center justify-center gap-1 disabled:opacity-40">
            <Papicon icon="ArrowDown" size={11} /> {m.eco_tower_floor_down()}
          </button>
          <button type="button" onclick={duplicateFloor} disabled={disabled || floors.length >= floorsMax} class="px-2 py-1.5 rounded-md bg-outline-variant/10 hover:bg-outline-variant/25 text-2xs font-bold flex items-center justify-center gap-1 disabled:opacity-40">
            <Papicon icon="Copy" size={11} /> {m.eco_tower_floor_duplicate()}
          </button>
          <button type="button" onclick={removeFloor} disabled={disabled} class="px-2 py-1.5 rounded-md bg-error/10 hover:bg-error/20 text-error text-2xs font-bold flex items-center justify-center gap-1 disabled:opacity-40">
            <Papicon icon="trash" size={11} /> {m.eco_tower_floor_delete()}
          </button>
        </div>
      {/if}
    </div>

    <!-- Carte de l'étage ouvert -->
    <div class="bg-surface-container-high/20 border border-outline-variant/10 rounded-xl p-3 overflow-auto">
      <svg
        viewBox="0 0 {frameW} {frameH + CRENEL}"
        class="w-full max-w-[720px] mx-auto select-none touch-none"
        role="grid"
        aria-label={m.eco_tower_map_title()}
      >
        <!-- La tour en pierre : créneaux, maçonnerie, puis l'étage dans son cadre. -->
        <defs>
          <pattern id="towerBricks" width="32" height="16" patternUnits="userSpaceOnUse">
            <rect width="32" height="16" class="fill-outline-variant/25" />
            <path d="M0 0.5H32M0 8.5H32M0.5 0V8M16.5 8V16" class="stroke-outline-variant/40" stroke-width="1" fill="none" />
          </pattern>
        </defs>
        {#each Array(merlons) as _, index}
          {#if index % 2 === 0}
            <rect x={(frameW / merlons) * index} y="0" width={frameW / merlons} height={CRENEL + 2} fill="url(#towerBricks)" pointer-events="none" />
          {/if}
        {/each}
        <rect x="0" y={CRENEL} width={frameW} height={frameH} rx="6" fill="url(#towerBricks)" pointer-events="none" />
        <rect x={FRAME - 4} y={CRENEL + FRAME - 4} width={layout.width * CELL + 8} height={layout.height * CELL + 8} rx="6" class="fill-surface-container-low" pointer-events="none" />
        <g transform="translate({FRAME} {FRAME + CRENEL})">
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
            {#if room.key}
              <g transform="translate({room.x * CELL + CELL - 22} {room.y * CELL + CELL - 22})" style="color: #fbbf24" pointer-events="none">
                <Papicon icon="Lock" size={14} />
              </g>
            {/if}
          </g>
        {/each}
        </g>
      </svg>
    </div>

    <!-- Informations et salle sélectionnée -->
    <div class="space-y-4">
      <div class="bg-surface-container-high/30 border border-outline-variant/10 rounded-xl p-4 space-y-2 text-xs">
        <p class="font-semibold">{m.eco_tower_map_summary({ rooms: layout.rooms.length, max: roomsMax })}</p>
        <p class="text-on-surface-variant/70">
          {bossDepth !== null ? m.eco_tower_map_exit_depth({ rooms: bossDepth }) : m.eco_tower_map_no_path()}
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
        <p class="text-2xs text-on-surface-variant/70 flex items-start gap-1.5 pt-1" title={m.eco_tower_difficulty_estimate_tip()}>
          <Papicon icon="Skull" size={11} />
          {m.eco_tower_difficulty_estimate({ from: difficulty.from, to: difficulty.to, hpFrom: difficulty.healthFrom, hpTo: difficulty.healthTo })}
        </p>
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
            <div class="space-y-1">
              <span class="text-xs font-semibold text-on-surface-variant/60" title={m.eco_tower_map_traits_tip()}>{m.eco_tower_map_traits({ max: TRAITS_MAX })}</span>
              <div class="flex flex-wrap gap-1.5">
                {#each TRAITS as trait}
                  <button type="button" disabled={!canManage || disabled || (!selected.traits.includes(trait) && selected.traits.length >= TRAITS_MAX)} title={traitTip(trait)} onclick={() => toggleTrait(trait)}
                    class="px-2 py-1 rounded-lg text-2xs font-bold border disabled:opacity-40 {selected.traits.includes(trait) ? 'border-error bg-error/15 text-error' : 'border-outline-variant/15'}">{traitLabel(trait)}</button>
                {/each}
              </div>
              <p class="text-2xs text-on-surface-variant/50">{m.eco_tower_map_traits_hint()}</p>
            </div>
            {#if selected.type === 'BOSS'}
              <div class="space-y-1">
                <span class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_mechanic()}</span>
                <div class="flex flex-wrap gap-1.5">
                  {#each MECHANICS as mechanic}
                    <button type="button" disabled={!canManage || disabled} title={mechanicTip(mechanic)} onclick={() => updateSelected({ mechanic })}
                      class="px-2 py-1 rounded-lg text-2xs font-bold border {selected.mechanic === mechanic ? 'border-primary bg-primary/15' : 'border-outline-variant/15'}">{mechanicLabel(mechanic)}</button>
                  {/each}
                </div>
              </div>
            {/if}
          {:else if selected.type === 'EVENT'}
            <div class="space-y-1">
              <span class="text-xs font-semibold text-on-surface-variant/60">{m.eco_tower_map_event()}</span>
              <div class="flex flex-wrap gap-1.5">
                {#each EVENTS as event}
                  <button type="button" disabled={!canManage || disabled} title={eventTip(event)} onclick={() => updateSelected({ event })}
                    class="px-2 py-1 rounded-lg text-2xs font-bold border {selected.event === event ? 'border-primary bg-primary/15' : 'border-outline-variant/15'}">{eventLabel(event)}</button>
                {/each}
              </div>
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
          {#if selected.type === 'ELITE' || selected.type === 'CHEST'}
            <label class="flex items-start gap-2 text-xs pt-1" title={m.eco_tower_map_key_tip()}>
              <input type="checkbox" checked={selected.key} disabled={!canManage || disabled} onchange={() => updateSelected({ key: !selected!.key })} />
              <span><span class="font-semibold flex items-center gap-1"><Papicon icon="Lock" size={11} /> {m.eco_tower_map_key()}</span>
                <span class="block text-2xs text-on-surface-variant/50">{m.eco_tower_map_key_tip()}</span></span>
            </label>
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
      {#if invalidFloors > 0}<span class="text-2xs text-warning">{m.eco_tower_floors_invalid()}</span>
      {:else if dirty}<span class="text-2xs text-warning">{m.eco_tower_map_unsaved()}</span>{/if}
      <button
        type="button"
        onclick={save}
        disabled={disabled || actionState.state.loading || invalidFloors > 0}
        class="px-4 py-2 bg-primary hover:bg-primary-hover text-on-primary text-body-sm font-medium rounded-lg transition-all disabled:opacity-50"
      >
        {m.eco_btn_save()}
      </button>
    </div>
  {/if}
</div>

{#if preview}
  <!-- Aperçu : l'image exacte que verront les joueurs en arrivant sur cet étage. -->
  <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="presentation" onclick={() => { preview = null; }}>
    <div class="bg-surface-container rounded-xl border border-outline-variant/30 p-4 max-w-4xl w-full space-y-3" role="dialog" aria-label={m.eco_tower_preview_btn()} tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { if (event.key === 'Escape') preview = null; }}>
      <div class="flex items-center justify-between">
        <p class="text-sm font-bold flex items-center gap-2"><Papicon icon="Image" size={14} /> {m.eco_tower_preview_title()}</p>
        <button type="button" onclick={() => { preview = null; }} class="px-3 py-1.5 bg-outline-variant/10 hover:bg-outline-variant/25 text-xs font-bold rounded-lg">{m.eco_btn_cancel()}</button>
      </div>
      <img src={preview} alt={m.eco_tower_preview_title()} class="w-full rounded-lg" />
      <p class="text-2xs text-on-surface-variant/60">{m.eco_tower_preview_hint()}</p>
    </div>
  </div>
{/if}
