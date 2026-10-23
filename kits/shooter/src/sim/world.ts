// The world at tick 0 (DESIGN.md §6.1, §6.2; sim rulings R1, R14).

import { createRng, nextFloat, type RngState } from "@decision-arena/core";
import { headingTo } from "../angles";
import { AGENT_HP } from "../constants";
import type { MapSpec } from "../maps";
import { STOP_ACTION, type Agent, type AgentId, type WorldState } from "../types";

/** What spawn reads of a match: the map it names, the seed, the length and one slot per agent. The version-1 MatchConfig is one. */
export interface SpawnConfig {
  mapId: string;
  seed: number;
  durationTicks: number;
  slots: readonly unknown[];
}

/**
 * The world at tick 0 of `config`: spawnWorld with agents `a0`… (one per slot)
 * and the RNG seeded from `config.seed`. Throws if the config names another map
 * or has more slots than the map has spawns.
 */
export function spawn(config: SpawnConfig, map: MapSpec): WorldState {
  if (config.mapId !== map.id) {
    throw new Error(`the config names map "${config.mapId}" but spawn was given "${map.id}"`);
  }
  if (config.slots.length > map.spawns.length) {
    throw new Error(`${config.slots.length} slots but map "${map.id}" has ${map.spawns.length} spawns`);
  }
  const agents = config.slots.map((_, slot) => `a${slot}`);
  return spawnWorld({ map, agents, durationTicks: config.durationTicks, rng: createRng(config.seed) });
}

/**
 * The world at tick 0 for `agents` (their ids, slot order) on `map`: they stand
 * on the map's spawns in a shuffle drawn from `rng` (agent i takes the i-th
 * shuffled spawn), facing the arena center, with full HP, a ready weapon and
 * STOP_ACTION. The RNG is handed on after the shuffle's draws. Throws if there
 * are more agents than the map has spawns.
 */
export function spawnWorld(setup: { map: MapSpec; agents: readonly AgentId[]; durationTicks: number; rng: RngState }): WorldState {
  const { map, durationTicks } = setup;
  if (setup.agents.length > map.spawns.length) {
    throw new Error(`${setup.agents.length} agents but map "${map.id}" has ${map.spawns.length} spawns`);
  }
  const { order, rng } = shuffle(map.spawns, setup.rng);
  const center = { x: map.width / 2, y: map.height / 2 };
  const agents = setup.agents.map((id, slot): Agent => {
    const pos = { ...order[slot]! };
    return {
      id,
      slot,
      pos,
      facing: headingTo(pos, center),
      hp: AGENT_HP,
      alive: true,
      deathTick: null,
      kills: 0,
      cooldownTicks: 0,
      action: { ...STOP_ACTION },
      moved: false,
    };
  });
  return {
    tick: 0,
    durationTicks,
    map,
    agents,
    bullets: [],
    nextBulletId: 0,
    rng,
    recent: [], // no step yet (R15)
  };
}

/** Fisher–Yates with the seeded RNG: a shuffled copy and the advanced RNG state. */
function shuffle<T>(items: readonly T[], rng: RngState): { order: T[]; rng: RngState } {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const draw = nextFloat(rng);
    rng = draw.rng;
    const j = Math.floor(draw.value * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { order, rng };
}
