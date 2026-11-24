// The battle royale as an Arena: the sim, perception and bots, with the words models are told, the snapshot
// a replay draws and the ranking.

import { roundTo } from "../../core/numbers.ts";
import type { Arena, Config } from "../../core/types.ts";
import { camper, wanderer } from "./bots.ts";
import {
  AGENT_HP,
  BULLET_DAMAGE,
  BULLET_SPEED_MPS,
  DECISION_TICKS,
  FIRE_INTERVAL_TICKS,
  HEAR_SHOT_RANGE_M,
  HEAR_STEPS_RANGE_M,
  HEARING_BANDS_M,
  INCOMING_RADIUS_M,
  MATCH_TICKS,
  MOVE_SPEED_MPS,
  MOVE_STEP_M,
  SPREAD_DEG,
  TICK_MS,
  TURN_RATE_DPS,
  TURN_STEP_DEG,
  VISION_CONE_DEG,
  VISION_RANGE_M,
} from "./constants.ts";
import { normalizeDeg, type Vec2 } from "./geometry.ts";
import { getMap, MAPS } from "./maps.ts";
import { perceive } from "./perceive.ts";
import { spawn, step } from "./sim.ts";
import type { Move, Observation, Turn, WorldState } from "./types.ts";

/** A tick as the log keeps it: living agents as [id, x, y, facing, hp], bullets in flight as [id, x, y]. */
export type Snapshot = { agents: [string, number, number, number, number][]; bullets: [string, number, number][] };

const DECISION_S = (DECISION_TICKS * TICK_MS) / 1000;

export const battleRoyale: Arena<WorldState, Observation> = {
  id: "battle-royale",
  maps: Object.keys(MAPS),
  tickMs: TICK_MS,
  actEvery: DECISION_TICKS,

  // A decision model is told nothing but these: each instruction says to follow `plan`, each option what
  // holding it for one decision does.
  questions: {
    move: {
      type: "choice",
      instructions:
        "Follow `plan`. Where it is silent: move toward cover, back off from fire you cannot answer, " +
        "stop when an enemy is in range to shoot.",
      criteria: {
        forward: `walk straight ahead, the way you face (${MOVE_STEP_M * DECISION_TICKS} m per decision)`,
        back: "walk backward, away from where you face, still facing the same way",
        left: "step sideways to your left, still facing the same way",
        right: "step sideways to your right, still facing the same way",
        stop: "stand still",
      } satisfies Record<Move, string>,
    },
    turn: {
      type: "choice",
      instructions:
        "Follow `plan`. Where it is silent: face an enemy you see, else turn toward incoming fire, " +
        "then toward the last shot or footsteps you heard.",
      criteria: {
        left: `turn left, toward negative bearings (${TURN_STEP_DEG * DECISION_TICKS}° per decision)`,
        right: `turn right, toward positive bearings (${TURN_STEP_DEG * DECISION_TICKS}° per decision)`,
        none: "keep facing the same way",
        face_target: "turn toward the nearest enemy you see and keep following it; if you see none, keep facing the same way",
      } satisfies Record<Turn, string>,
    },
    fire: {
      type: "choice",
      instructions: "Follow `plan`. Where it is silent: fire when an enemy is visible, close to straight ahead and within about 40 m.",
      criteria: { yes: "shoot the way you face, as fast as the gun allows", no: "hold fire" },
    },
  },

  defaultPrompt:
    "Survive first, win second. Move between pieces of cover and shoot the enemies you see. When you are hit " +
    "from a direction you cannot see, turn toward it or break line of sight; below 40 HP, stop chasing and stay behind cover.",

  bots: { wanderer, camper },

  rules,
  spawn,
  perceive,
  step,

  // Rounded as people read them, and as perceive rounds an agent's own position and facing.
  snapshot: (state): Snapshot => ({
    agents: state.agents
      .filter((a) => a.alive)
      .map((a) => [a.id, roundTo(a.pos.x, 2), roundTo(a.pos.y, 2), normalizeDeg(roundTo(a.facing, 1)), Math.round(a.hp)]),
    bullets: state.bullets.map((b) => [b.id, roundTo(b.pos.x, 2), roundTo(b.pos.y, 2)]),
  }),

  active: (state) => state.agents.filter((a) => a.alive).map((a) => a.id),

  // Over when at most one agent is alive, or after MATCH_TICKS. Survival ranks first: the living by kills, then
  // HP; then the dead by latest death, then kills. The sorts are stable, so ties keep list order.
  ended(state) {
    const alive = state.agents.filter((a) => a.alive);
    if (alive.length > 1 && state.tick < MATCH_TICKS) return null;
    const dead = state.agents.filter((a) => !a.alive);
    alive.sort((a, b) => b.kills - a.kills || b.hp - a.hp);
    dead.sort((a, b) => (b.deathTick ?? 0) - (a.deathTick ?? 0) || b.kills - a.kills);
    return [...alive, ...dead].map((a) => a.id);
  },
};

/** What a planner is told: the map, the rules, how to read an observation and how to write a plan. */
function rules(config: Config): string {
  const map = getMap(config.map);
  const point = ({ x, y }: Vec2) => `(${x},${y})`;
  return [
    `Map: ${map.width} × ${map.height} m, x to the right, y down. Facings are in degrees, 0° is +x, clockwise.`,
    `Obstacles block movement, bullets and sight; their corners: ${map.obstacles.map((o) => o.vertices.map(point).join(" ")).join("; ")}.`,
    `Spawns, taken in a shuffled order: ${map.spawns.map(point).join(" ")}.`,
    `Rules: the last one alive wins; after ${(MATCH_TICKS * TICK_MS) / 1000} s the ranking is survival, then kills, then hp. ` +
      `Everyone starts with ${AGENT_HP} hp and a hit costs ${BULLET_DAMAGE}. You walk ${MOVE_SPEED_MPS} m/s, turn ${TURN_RATE_DPS}°/s ` +
      `and fire up to ${1000 / (FIRE_INTERVAL_TICKS * TICK_MS)} shots a second; bullets fly ${BULLET_SPEED_MPS} m/s with up to ${SPREAD_DEG}° of spread.`,
    `Observation: self is your position, facing, hp, kills and the seconds left. visible: enemies within ${VISION_CONE_DEG / 2}° of your facing ` +
      `and ${VISION_RANGE_M} m in line of sight, nearest first; a bearing is in degrees from your facing, + to your right. ` +
      `heard, through walls: shots of the last ${DECISION_S} s within ${HEAR_SHOT_RANGE_M} m, then footsteps within ${HEAR_STEPS_RANGE_M} m; ` +
      `dist is near (under ${HEARING_BANDS_M.near} m), mid (under ${HEARING_BANDS_M.mid} m) or far. ` +
      `incoming: the shooters whose bullets hit you or passed within ${INCOMING_RADIUS_M} m in the last ${DECISION_S} s.`,
    `Plan: every ${DECISION_S} s your actor reads it and picks move (forward, back, left, right, stop), turn (left, right, none, ` +
      `face_target: toward the nearest enemy it sees) and fire (yes, no). It follows the plan word for word: write a few short orders.`,
  ].join("\n");
}
