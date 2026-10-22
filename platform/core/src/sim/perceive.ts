// What one agent knows at one tick (DESIGN.md §3 principle 3, §6.2 Perception;
// sim rulings R6, R7, R15). perceive is pure: it reads the state and nothing
// else, writes nothing, and builds a fresh Observation every call. The match
// loop asks it for each deciding agent, and the replay's mind panel recomputes
// it from the log (§5.3), so it reads only what a replay can rebuild.
//
// Shots, hits and near misses come from the perception window, state.recent:
// the last DOER_INTERVAL_TICKS steps. Every slot decides once per
// DOER_INTERVAL_TICKS ticks (R1), so each of them reaches exactly one decision,
// the first after it, however the step it happened in falls on the cadence.
//
// - Vision: living enemies within VISION_RANGE_M, |bearing| ≤ VISION_CONE_DEG / 2,
//   and in line of sight (the center-to-center segment touches no obstacle edge).
//   Range and line of sight are the ones face_target uses (step.ts), edges included.
// - Hearing, through walls: other agents' shots in the window within
//   HEAR_SHOT_RANGE_M, as the bearing and distance from where the shooter stood
//   when it fired to where the agent stands now (a shooter dead since is still
//   heard), and living enemies that moved this tick within HEAR_STEPS_RANGE_M;
//   each as a bearing and a band (near < 20 m, mid < 45 m, far beyond;
//   HEARING_BANDS_M). Ranges are inclusive.
// - Incoming: the window's hits and near misses on the agent, as the bearing of
//   the shooter's position (TickFacts.from): hits, then near misses, each oldest
//   first. A bullet that passed close over two steps, or passed close and then
//   hit, is two entries.
// - Self: position, facing, HP, kills, time remaining.
//
// Rounding: bearings to whole degrees, distances to whole meters, secondsLeft
// to one decimal (R7); self position to 2 decimals and facing to 1, as the
// log's Tick rows (R10). Ranges, the cone and bands are tested on unrounded
// values. Order: visible nearest first; heard shots before steps, each nearest
// first; ties keep slot (or window) order. A dead agent perceives only itself.

import { bearingTo, normalizeDeg } from "../angles";
import {
  HEAR_SHOT_RANGE_M,
  HEAR_STEPS_RANGE_M,
  HEARING_BANDS_M,
  TICK_MS,
  VISION_CONE_DEG,
  VISION_RANGE_M,
} from "../constants";
import type { Agent, AgentId, HearingBand, Observation, TickFacts, WorldState } from "../types";
import { dist, type Vec2 } from "../vec2";
import { hasLineOfSight } from "./collision";
import { roundTo } from "./round";

/**
 * The parts of the world perception reads. A WorldState is one; the mind panel
 * can build one from a log: positions, facing and HP from a Tick row, `alive`
 * from presence in it, kills from Death events, `moved` from consecutive Tick
 * rows, and the window from the Shot and Hit events and Tick rows' `near` of
 * the last DOER_INTERVAL_TICKS ticks (ISSUES I-016).
 */
export type PerceptionState = Pick<WorldState, "tick" | "durationTicks" | "map"> & {
  readonly agents: readonly PerceivedAgent[];
  /** The perception window, oldest step first (WorldState.recent, R15). */
  readonly recent: readonly TickFacts[];
};

/** The agent fields perception reads. */
export type PerceivedAgent = Pick<Agent, "id" | "pos" | "facing" | "hp" | "alive" | "kills" | "moved">;

type Visible = Observation["visible"][number];
type Heard = Observation["heard"][number];

const HALF_CONE_DEG = VISION_CONE_DEG / 2;

/** What `agentId` perceives in `state`. Throws if no agent has that id. */
export function perceive(state: PerceptionState, agentId: AgentId): Observation {
  const me = state.agents.find((a) => a.id === agentId);
  if (!me) throw new Error(`perceive: no agent "${agentId}" in this world`);
  const self = {
    pos: { x: roundTo(me.pos.x, 2), y: roundTo(me.pos.y, 2) },
    facing: normalizeDeg(roundTo(me.facing, 1)),
    hp: me.hp,
    kills: me.kills,
    secondsLeft: secondsLeft(state),
  };
  if (!me.alive) return { self, visible: [], heard: [], incoming: [] };

  const bearing = (to: Vec2) => normalizeDeg(Math.round(bearingTo(me.pos, me.facing, to)));

  const seen: { d: number; entry: Visible }[] = [];
  for (const other of state.agents) {
    if (other.id === me.id || !other.alive) continue;
    const d = dist(me.pos, other.pos);
    if (d > VISION_RANGE_M) continue;
    const b = bearingTo(me.pos, me.facing, other.pos);
    if (Math.abs(b) > HALF_CONE_DEG || !hasLineOfSight(me.pos, other.pos, state.map.obstacles)) continue;
    seen.push({ d, entry: { id: other.id, bearing: normalizeDeg(Math.round(b)), dist: Math.round(d), moving: other.moved } });
  }

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

/** Time left in the match: (durationTicks − tick) ticks, in seconds to one decimal, never negative. */
function secondsLeft(state: PerceptionState): number {
  const tenths = Math.round(((state.durationTicks - state.tick) * TICK_MS) / 100);
  return Math.max(0, tenths) / 10;
}

function band(d: number): HearingBand {
  return d < HEARING_BANDS_M.near ? "near" : d < HEARING_BANDS_M.mid ? "mid" : "far";
}

/** The entries by unrounded distance, ascending; the sort is stable, so ties keep their order. */
function nearestFirst<T>(items: { d: number; entry: T }[]): T[] {
  return items.sort((a, b) => a.d - b.d).map((item) => item.entry);
}
