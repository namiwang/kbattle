// The two bots: scripts that answer move, turn and fire from their observation alone.
// A bot is the same for the same (seed, index): it draws from its own RNG, apart from the sim's.

import { createRng, nextFloat, nextUint32 } from "../../core/numbers.ts";
import type { Model } from "../../core/types.ts";
import { DECISION_TICKS, MAP_SIZE_M, MOVE_STEP_M, TICK_MS, TURN_STEP_DEG } from "./constants.ts";
import { dist, headingTo, normalizeDeg, type Vec2 } from "./geometry.ts";
import type { Move, Observation, Turn } from "./types.ts";

type Picks = { move: Move; turn: Turn; fire: boolean };

const FIRE_CONE_DEG = 10; // a bot fires when its target is at most this far off its facing
const STUCK_DECISIONS = 3; // decisions in a row without headway before a bot changes course
const TURN_PER_DECISION_DEG = TURN_STEP_DEG * DECISION_TICKS; // a left or right held for one decision
const WANDER_REPICK_TICKS = 4_000 / TICK_MS; // the wanderer picks a new heading this often
const CAMP_RADIUS_M = 4; // within this of its spot, the camper is home
// The camper's spots, 5 m from both walls of each corner. Bots see no map, so they count on its size.
const CAMP_SPOTS: readonly Vec2[] = [
  { x: 5, y: 5 },
  { x: MAP_SIZE_M - 5, y: 5 },
  { x: MAP_SIZE_M - 5, y: MAP_SIZE_M - 5 },
  { x: 5, y: MAP_SIZE_M - 5 },
];

/** Roams, and faces and shoots the nearest enemy it sees while it keeps walking. */
export function wanderer(seed: number, index: number): Model {
  const draw = floats(seed, index);
  const headway = headwayWatch();
  let heading: number | null = null; // absolute degrees
  let pickedAt = 0;
  let engaged = false;
  const repick = (tick: number, to: number) => {
    heading = normalizeDeg(to);
    pickedAt = tick;
  };

  return bot(headway, (tick, { self, visible }, stuck) => {
    const target = visible[0]; // the nearest
    if (target) {
      engaged = true;
      return engage("forward", target);
    }
    if (heading === null || engaged) repick(tick, self.facing); // at the start, or after a fight: the way it looks
    engaged = false;
    if (stuck >= STUCK_DECISIONS) {
      repick(tick, self.facing + 90 + 180 * draw()); // somewhere in the half behind it
      headway.reset();
    } else if (tick - pickedAt >= WANDER_REPICK_TICKS) {
      repick(tick, headingTo(self.pos, { x: MAP_SIZE_M * draw(), y: MAP_SIZE_M * draw() })); // toward a random point
    }
    return { move: "forward", turn: steer(self.facing, heading!), fire: false };
  });
}

/** Holds the nearest corner, scanning; shoots what it sees; moves to another corner when hit at home or stuck. */
export function camper(seed: number, index: number): Model {
  const draw = floats(seed, index);
  const headway = headwayWatch();
  let corner: number | null = null; // index into CAMP_SPOTS
  let lastHp: number | null = null;
  const atHome = (pos: Vec2, spot: number) => dist(pos, CAMP_SPOTS[spot]!) <= CAMP_RADIUS_M;

  return bot(headway, (_tick, { self, visible }, stuck) => {
    if (corner === null) corner = nearestSpot(self.pos);
    const hit = lastHp !== null && self.hp < lastHp;
    lastHp = self.hp;
    if ((hit && atHome(self.pos, corner)) || stuck >= STUCK_DECISIONS) {
      corner = (corner + 1 + Math.floor(draw() * (CAMP_SPOTS.length - 1))) % CAMP_SPOTS.length; // a random other corner
      headway.reset();
    }
    const home = atHome(self.pos, corner);
    const move = home ? "stop" : moveToward(self.facing, headingTo(self.pos, CAMP_SPOTS[corner]!));
    const target = visible[0]; // the nearest
    if (target) return engage(move, target);
    return { move, turn: home ? "left" : "none", fire: false };
  });
}

/**
 * A script as a Model. A model is not told the tick, so the bot counts its calls: it is asked at every
 * decision from tick 0 until it dies. `stuck` is how many decisions in a row made no headway.
 */
function bot(headway: ReturnType<typeof headwayWatch>, script: (tick: number, observation: Observation, stuck: number) => Picks): Model {
  let decisions = 0;
  return {
    async ask(req) {
      const { observation } = req.state as { observation: Observation };
      const tick = DECISION_TICKS * decisions++;
      const picks = script(tick, observation, headway.check(tick, observation.self.pos));
      headway.note(tick, observation.self.pos, picks.move !== "stop");
      return { answers: { move: picks.move, turn: picks.turn, fire: picks.fire ? "yes" : "no" } };
    },
  };
}

/** A bot's own draws in [0, 1), from a seed mixed out of the match seed and its index. */
function floats(seed: number, index: number): () => number {
  let rng = createRng(nextUint32(createRng((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0)).value);
  return () => {
    const draw = nextFloat(rng);
    rng = draw.rng;
    return draw.value;
  };
}

/** Face the target and shoot once it is close to straight ahead. */
function engage(move: Move, target: { bearing: number }): Picks {
  return { move, turn: "face_target", fire: Math.abs(target.bearing) <= FIRE_CONE_DEG };
}

/**
 * Counts the decisions in a row at which a move asked for at the previous decision got the bot under a
 * fifth of a full walk's distance: bots see their position, not whether they moved.
 */
function headwayWatch() {
  let last: { tick: number; pos: Vec2; moving: boolean } | null = null;
  let stuck = 0;
  return {
    /** Before deciding: the decisions in a row without headway, this one included. */
    check(tick: number, pos: Vec2): number {
      const expected = last?.moving ? MOVE_STEP_M * (tick - last.tick) : 0;
      stuck = last && expected > 0 && dist(pos, last.pos) < expected / 5 ? stuck + 1 : 0;
      return stuck;
    },
    /** After deciding: where it stood and whether it asked to move. */
    note(tick: number, pos: Vec2, moving: boolean): void {
      last = { tick, pos: { ...pos }, moving };
    },
    reset(): void {
      stuck = 0;
    },
  };
}

/** The move whose direction is closest to the absolute `heading`, without turning. */
function moveToward(facing: number, heading: number): Move {
  const rel = normalizeDeg(heading - facing);
  if (Math.abs(rel) <= 45) return "forward";
  if (Math.abs(rel) >= 135) return "back";
  return rel > 0 ? "right" : "left";
}

/** The turn that brings the facing within half a decision's turn of `heading`. */
function steer(facing: number, heading: number): Turn {
  const delta = normalizeDeg(heading - facing);
  if (Math.abs(delta) <= TURN_PER_DECISION_DEG / 2) return "none";
  return delta > 0 ? "right" : "left";
}

/** The camping spot nearest to `pos`, the first on a tie. */
function nearestSpot(pos: Vec2): number {
  let best = 0;
  for (let i = 1; i < CAMP_SPOTS.length; i++) if (dist(pos, CAMP_SPOTS[i]!) < dist(pos, CAMP_SPOTS[best]!)) best = i;
  return best;
}
