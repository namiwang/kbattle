// The camper bot (DESIGN.md §6.2 Bots; sim ruling R13): holds a corner, shoots
// anything visible, relocates when hit. It walks to the spot CAMP_INSET_M from
// both walls of the nearest arena corner, picking whichever relative move points
// closest (it does not turn on the way); within CAMP_RADIUS_M of the spot it
// stops and scans by turning left. On a visible enemy it faces the nearest one
// and fires when it is within FIRE_CONE_DEG. When its HP dropped since its
// previous decision while in its corner region, it heads for a random other
// corner (hit on the way, it keeps going), and so it does when STUCK_DECISIONS
// decisions in a row made no headway toward its corner.
// Bots see no map, so the corners come from ARENA_WIDTH_M × ARENA_HEIGHT_M,
// the size of every bundled map.

import { headingTo } from "../angles";
import { ARENA_HEIGHT_M, ARENA_WIDTH_M } from "../constants";
import type { Observation } from "../types";
import { dist, type Vec2 } from "../vec2";
import { botRng, engage, floats, headwayWatch, moveToward, STUCK_DECISIONS, type BotIntent, type BotMind } from "./shared";

/** The camping spot's distance from both walls of its corner. */
export const CAMP_INSET_M = 5;

/** Within this of its spot, the camper is in its corner region. */
export const CAMP_RADIUS_M = 4;

/** The four camping spots: north-west, north-east, south-east, south-west. */
export const CAMP_SPOTS: readonly Vec2[] = Object.freeze(
  [
    { x: CAMP_INSET_M, y: CAMP_INSET_M },
    { x: ARENA_WIDTH_M - CAMP_INSET_M, y: CAMP_INSET_M },
    { x: ARENA_WIDTH_M - CAMP_INSET_M, y: ARENA_HEIGHT_M - CAMP_INSET_M },
    { x: CAMP_INSET_M, y: ARENA_HEIGHT_M - CAMP_INSET_M },
  ].map((spot) => Object.freeze(spot)),
);

export function camperMind(seed: number, slot: number): BotMind {
  const draw = floats(botRng(seed, slot));
  const headway = headwayWatch();
  let corner: number | null = null; // index into CAMP_SPOTS
  let lastHp: number | null = null;

  /** A random corner other than the current one. */
  const elsewhere = (from: number) => (from + 1 + Math.floor(draw() * (CAMP_SPOTS.length - 1))) % CAMP_SPOTS.length;

  function intent(tick: number, observation: Observation): BotIntent {
    const { self, visible } = observation;
    const stuck = headway.check(tick, self.pos);
    if (corner === null) corner = nearest(self.pos);
    const hit = lastHp !== null && self.hp < lastHp;
    lastHp = self.hp;
    if ((hit && atHome(self.pos, corner)) || stuck >= STUCK_DECISIONS) {
      corner = elsewhere(corner); // hit while home, or stuck; hit on the way, it keeps its destination
      headway.reset();
    }
    const spot = CAMP_SPOTS[corner]!;
    const home = atHome(self.pos, corner);
    const move = home ? "stop" : moveToward(self.facing, headingTo(self.pos, spot));
    const target = visible[0]; // nearest first
    if (target) return engage(move, target);
    return { move, turn: home ? "left" : "none", fire: false, target: null };
  }

  return {
    decide(tick, observation) {
      const next = intent(tick, observation);
      headway.note(tick, observation.self.pos, next.move !== "stop");
      return next;
    },
  };
}

/** Whether `pos` is in the region of corner `corner`. */
function atHome(pos: Vec2, corner: number): boolean {
  return dist(pos, CAMP_SPOTS[corner]!) <= CAMP_RADIUS_M;
}

/** The index of the camping spot nearest to `pos` (the first on a tie). */
function nearest(pos: Vec2): number {
  let best = 0;
  for (let i = 1; i < CAMP_SPOTS.length; i++) if (dist(pos, CAMP_SPOTS[i]!) < dist(pos, CAMP_SPOTS[best]!)) best = i;
  return best;
}
