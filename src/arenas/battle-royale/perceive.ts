// What one agent perceives. Pure: it reads the state, writes nothing and builds a fresh Observation.
// Ranges and the cone are inclusive and tested on unrounded values. Bearings are rounded to whole degrees,
// distances to whole meters; the agent's own position and facing are rounded as in the log's snapshots.

import { roundTo } from "../../core/numbers.ts";
import { HEAR_SHOT_RANGE_M, HEAR_STEPS_RANGE_M, HEARING_BANDS_M, MATCH_TICKS, TICK_MS, VISION_CONE_DEG, VISION_RANGE_M } from "./constants.ts";
import { bearingTo, dist, hasLineOfSight, normalizeDeg, type Vec2 } from "./geometry.ts";
import type { Observation, WorldState } from "./types.ts";

type Heard = Observation["heard"][number];

/** What agent `id` sees, hears and feels in `state`. A dead agent perceives only itself. */
export function perceive(state: WorldState, id: string): Observation {
  const me = state.agents.find((a) => a.id === id);
  if (!me) throw new Error(`no agent "${id}" in this world`);
  const self = {
    pos: { x: roundTo(me.pos.x, 2), y: roundTo(me.pos.y, 2) },
    facing: normalizeDeg(roundTo(me.facing, 1)),
    hp: me.hp,
    kills: me.kills,
    secondsLeft: Math.max(0, Math.round(((MATCH_TICKS - state.tick) * TICK_MS) / 100)) / 10,
  };
  if (!me.alive) return { self, visible: [], heard: [], incoming: [] };

  const bearing = (to: Vec2) => normalizeDeg(Math.round(bearingTo(me.pos, me.facing, to)));

  // Sight: living enemies in range, in the cone, with no obstacle edge touching the line between the centers.
  const seen: { d: number; entry: Observation["visible"][number] }[] = [];
  for (const other of state.agents) {
    if (other.id === me.id || !other.alive) continue;
    const d = dist(me.pos, other.pos);
    if (d > VISION_RANGE_M) continue;
    const b = bearingTo(me.pos, me.facing, other.pos);
    if (Math.abs(b) > VISION_CONE_DEG / 2 || !hasLineOfSight(me.pos, other.pos, state.map.obstacles)) continue;
    seen.push({ d, entry: { id: other.id, bearing: normalizeDeg(Math.round(b)), dist: Math.round(d), moving: other.moved } });
  }

  // Hearing, through walls: others' shots of the recent steps, from where the shooter stood then (dead since
  // or not) to where the agent stands now; and the footsteps of living others in the newest step.
  const shots: { d: number; entry: Heard }[] = [];
  for (const facts of state.recent) {
    for (const shot of facts.shots) {
      if (shot.agent === me.id) continue;
      const d = dist(me.pos, shot.pos);
      if (d <= HEAR_SHOT_RANGE_M) shots.push({ d, entry: { kind: "shot", bearing: bearing(shot.pos), dist: band(d) } });
    }
  }
  const steps: { d: number; entry: Heard }[] = [];
  for (const other of state.agents) {
    if (other.id === me.id || !other.alive || !other.moved) continue;
    const d = dist(me.pos, other.pos);
    if (d <= HEAR_STEPS_RANGE_M) steps.push({ d, entry: { kind: "steps", bearing: bearing(other.pos), dist: band(d) } });
  }

  // Incoming: the recent steps' hits on the agent, then their near misses, as the bearing of the shooter.
  const hits: Observation["incoming"] = [];
  const nearMisses: Observation["incoming"] = [];
  for (const facts of state.recent) {
    for (const hit of facts.hits) if (hit.target === me.id) hits.push({ bearing: bearing(hit.from) });
    for (const miss of facts.nearMisses) if (miss.target === me.id) nearMisses.push({ bearing: bearing(miss.from) });
  }

  return {
    self,
    visible: nearestFirst(seen),
    heard: [...nearestFirst(shots), ...nearestFirst(steps)],
    incoming: [...hits, ...nearMisses],
  };
}

function band(d: number): Heard["dist"] {
  return d < HEARING_BANDS_M.near ? "near" : d < HEARING_BANDS_M.mid ? "mid" : "far";
}

/** By unrounded distance; the sort is stable, so ties keep their order. */
function nearestFirst<T>(items: { d: number; entry: T }[]): T[] {
  return items.sort((a, b) => a.d - b.d).map((item) => item.entry);
}
