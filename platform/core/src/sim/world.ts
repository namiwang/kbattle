// The world at tick 0 (DESIGN.md §6.1, §6.2; sim rulings R1, R14).

import { headingTo } from "../angles";
import { AGENT_HP } from "../constants";
import type { MapSpec, MatchConfig } from "../schemas";
import { STOP_ACTION, type Agent, type WorldState } from "../types";
import { createRng, nextFloat, type RngState } from "../rng";

/**
 * The world at tick 0: one agent per slot, `a0`… in slot order, standing on the
 * map's spawns in a seeded shuffle (agent i takes the i-th shuffled spawn),
 * facing the arena center, with full HP, a ready weapon and STOP_ACTION. The RNG
 * is seeded from `config.seed` and handed on after the shuffle's draws.
 * Throws if the config names another map or has more slots than the map has spawns.
 */
export function spawn(config: MatchConfig, map: MapSpec): WorldState {
  if (config.mapId !== map.id) {
    throw new Error(`the config names map "${config.mapId}" but spawn was given "${map.id}"`);
  }
  if (config.slots.length > map.spawns.length) {
    throw new Error(`${config.slots.length} slots but map "${map.id}" has ${map.spawns.length} spawns`);
  }
  const { order, rng } = shuffle(map.spawns, createRng(config.seed));
  const center = { x: map.width / 2, y: map.height / 2 };
  const agents = config.slots.map((_, slot): Agent => {
    const pos = { ...order[slot]! };
    return {
      id: `a${slot}`,
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
    durationTicks: config.durationTicks,
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
