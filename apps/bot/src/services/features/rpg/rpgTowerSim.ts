/**
 * Simulateur d'équilibrage : un joueur automatique enchaîne des ascensions avec le vrai moteur,
 * pour estimer jusqu'où l'on monte, où l'on meurt et ce que l'on gagne.
 *
 * Le joueur est raisonnable sans être fin : il explore quand il a de la marge, file vers la
 * sortie sinon, boit sous un tiers de ses PV, lance ses compétences dès qu'elles sont prêtes et
 * se défend contre un coup puissant annoncé. Les chiffres donnent un ordre de grandeur : un
 * vrai joueur fera mieux ou moins bien selon ses choix.
 */

import {
  TowerActionRefused,
  applyTowerAction,
  createTowerState,
  towerStats,
  type TowerAction,
  type TowerFoePool,
  type TowerRules,
  type TowerState,
} from './rpgTowerEngine.js';
import { TowerRng, settleShards, type TowerCoreStats, type TowerSkill } from './rpgTowerPolicy.js';
import { exitLocks, exitRoom, isExitRoom, roomNeighbors, type TowerFloorsAfter, type TowerLayout, type TowerRoom } from './rpgTowerMap.js';
import { towerFloorLayout } from './rpgTowerGen.js';
import type { TowerHeat } from './rpgTowerContent.js';

export const TOWER_SIM_RUNS_MAX = 200;
/** Garde-fous : une ascension simulée s'arrête là, même si le joueur tient encore. */
const SIM_FLOORS_MAX = 60;
const SIM_STEPS_MAX = 4000;
/** Part des PV sous laquelle le joueur boit, et sous laquelle il cherche un feu de camp. */
const DRINK_BELOW = 0.35;
const REST_BELOW = 0.45;
/** Chance d'explorer une salle de plus plutôt que de filer vers la sortie, à PV confortables. */
const EXPLORE_CHANCE = 0.6;

export type TowerSimInput = {
  base: TowerCoreStats;
  skills: TowerSkill[];
  potions: number;
  rules: TowerRules;
  foes: TowerFoePool;
  floors: readonly TowerLayout[];
  floorsAfter: TowerFloorsAfter;
  generatedFog: boolean;
  heat: TowerHeat[];
  deathShardPercent: number;
  runs: number;
  seed: number;
};

export type TowerSimResult = {
  runs: number;
  averageFloor: number;
  medianFloor: number;
  bestFloor: number;
  averageRooms: number;
  averageShards: number;
  /** Ascensions arrêtées par les garde-fous plutôt que par une mort. */
  capped: number;
  /** Morts par étage atteint (étage 1 = mort avant d'en gravir un). */
  deathsByFloor: { floor: number; deaths: number }[];
  topKillers: { name: string; deaths: number }[];
};

/** Premier pas vers la salle la plus proche qui satisfait `wanted`, en passant par les salles de l'étage. */
function stepToward(state: TowerState, wanted: (room: TowerRoom) => boolean): number {
  const map = state.map!;
  const start = map.pos;
  const previous = new Map<string, string>([[start, start]]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const room = map.layout.rooms.find((candidate) => candidate.id === id);
    if (id !== start && room && wanted(room)) {
      let step = id;
      while (previous.get(step) !== start) step = previous.get(step)!;
      return state.moves.findIndex((move) => move.roomId === step);
    }
    for (const { room: next } of roomNeighbors(map.layout, id)) {
      if (previous.has(next.id)) continue;
      // On ne traverse pas une sortie : scellée, elle refuserait le passage.
      if (isExitRoom(next.type) && !wanted(next)) continue;
      previous.set(next.id, id);
      queue.push(next.id);
    }
  }
  return -1;
}

function chooseMove(state: TowerState, rng: TowerRng): number {
  const map = state.map!;
  const max = towerStats(state).maxHealth;
  const locks = exitLocks(map.layout, map.cleared);
  const exit = exitRoom(map.layout);
  const exitOpen = exit !== null
    && (exit.type !== 'STAIRS' || locks.keysFound >= locks.keysNeeded)
    && (exit.type !== 'GATE' || locks.sealsLit >= locks.sealsNeeded);
  const unexplored = (room: TowerRoom) => !map.cleared.includes(room.id) && !isExitRoom(room.type);

  const tries: ((room: TowerRoom) => boolean)[] = [];
  if (state.hp < max * REST_BELOW) tries.push((room) => room.type === 'CAMPFIRE' && !map.cleared.includes(room.id));
  if (!exitOpen || rng.next() < EXPLORE_CHANCE) tries.push(unexplored);
  if (exitOpen) tries.push((room) => room.id === exit!.id);
  tries.push(unexplored);
  for (const wanted of tries) {
    const index = stepToward(state, wanted);
    if (index >= 0) return index;
  }
  return 0;
}

function chooseAction(state: TowerState, rng: TowerRng): TowerAction {
  const max = towerStats(state).maxHealth;
  switch (state.phase) {
    case 'DOORS':
      return { type: 'door', index: state.map ? chooseMove(state, rng) : 0 };
    case 'COMBAT': {
      const encounter = state.encounter!;
      if (state.hp < max * DRINK_BELOW && state.potions > 0) return { type: 'potion' };
      if (encounter.charging) return { type: 'defend' };
      const ready = state.skills.filter((skill) => (encounter.cooldowns[skill.id] ?? 0) === 0);
      const healing = ready.find((skill) => (skill.effect.healPercent ?? 0) > 0 || (skill.effect.lifesteal ?? 0) > 0);
      if (healing && state.hp < max * 0.5) return { type: 'skill', id: healing.id };
      const striking = ready.find((skill) => skill.effect.damageMultiplier > 1);
      if (striking) return { type: 'skill', id: striking.id };
      return { type: 'attack' };
    }
    case 'LOOT': return { type: 'equip' };
    case 'BLESSING': return { type: 'bless', index: rng.int(Math.max(1, state.blessingChoices.length)) };
    case 'EVENT': return { type: 'event', index: 1 };
    case 'MERCENARY': return { type: 'hire' };
    case 'MENTOR': return { type: 'learn', index: 0 };
    case 'ENTRY': return { type: 'door', index: rng.int(Math.max(1, state.map?.entryChoices?.length ?? 1)) };
    case 'TOLL': return { type: 'pay' };
    case 'FOUNTAIN': return state.hp < max * 0.6 ? { type: 'drink' } : { type: 'leave_shop' };
    default: return { type: 'leave_shop' };
  }
}

/** Repli quand l'action choisie est refusée : il y a toujours de quoi avancer. */
function fallback(state: TowerState): TowerAction {
  switch (state.phase) {
    case 'COMBAT': return { type: 'attack' };
    case 'LOOT': return { type: 'discard' };
    case 'BLESSING': return { type: 'bless', index: 0 };
    // L'option prudente peut être impossible (potions pleines à la source) : l'autre, alors.
    case 'EVENT': return { type: 'event', index: 0 };
    case 'DOORS': return { type: 'door', index: 0 };
    case 'ENTRY': return { type: 'door', index: 0 };
    // Trop pauvre pour le péage : on force le passage.
    case 'TOLL': return { type: 'force' };
    default: return { type: 'leave_shop' };
  }
}

/**
 * Rend la main entre deux ascensions : une simulation de plusieurs centaines d'ascensions ne
 * doit pas figer le bot pendant qu'il sert Discord.
 */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function simulateTowerRuns(input: TowerSimInput): Promise<TowerSimResult> {
  const runs = Math.max(1, Math.min(TOWER_SIM_RUNS_MAX, Math.trunc(input.runs)));
  const floorsReached: number[] = [];
  const rooms: number[] = [];
  const shards: number[] = [];
  const deaths = new Map<number, number>();
  const killers = new Map<string, number>();
  let capped = 0;

  for (let run = 0; run < runs; run++) {
    await yieldToLoop();
    const seed = (input.seed + Math.imul(run + 1, 0x9e3779b1)) | 0;
    const ai = new TowerRng(seed ^ 0x2545f491);
    let state = createTowerState({
      base: input.base,
      skills: input.skills,
      potions: input.potions,
      seed,
      rules: input.rules,
      layout: towerFloorLayout(input.floors, 1, input.floorsAfter, seed, input.generatedFog),
      heat: input.heat,
    });
    let floor = 1;
    let dead = false;
    let steps = 0;
    for (; steps < SIM_STEPS_MAX && !dead && state.floorsCleared < SIM_FLOORS_MAX; steps++) {
      let step;
      try {
        step = applyTowerAction(state, floor, chooseAction(state, ai), input.rules, input.foes, input.floors);
      } catch (err) {
        if (!(err instanceof TowerActionRefused)) throw err;
        try {
          step = applyTowerAction(state, floor, fallback(state), input.rules, input.foes, input.floors);
        } catch (inner) {
          if (!(inner instanceof TowerActionRefused)) throw inner;
          break;
        }
      }
      if (step.dead) {
        dead = true;
        const name = step.state.encounter?.name ?? '?';
        killers.set(name, (killers.get(name) ?? 0) + 1);
        deaths.set(step.state.floorsCleared + 1, (deaths.get(step.state.floorsCleared + 1) ?? 0) + 1);
      }
      state = step.state;
      floor = step.floor;
    }
    if (!dead) capped += 1;
    floorsReached.push(state.floorsCleared);
    rooms.push(Math.max(0, (state.map?.depth ?? 1) - 1));
    shards.push(dead ? settleShards(state.shards, 'DEAD', input.deathShardPercent) : state.shards);
  }

  const average = (values: number[]) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  const sorted = [...floorsReached].sort((a, b) => a - b);
  return {
    runs,
    averageFloor: average(floorsReached),
    medianFloor: sorted[Math.floor(sorted.length / 2)],
    bestFloor: sorted[sorted.length - 1],
    averageRooms: average(rooms),
    averageShards: average(shards),
    capped,
    deathsByFloor: [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([at, count]) => ({ floor: at, deaths: count })),
    topKillers: [...killers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, deaths: count })),
  };
}
