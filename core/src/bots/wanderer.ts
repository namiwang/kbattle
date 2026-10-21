// The wanderer bot (DESIGN.md §6.2 Bots; sim ruling R13): roams, faces and
// shoots anything visible. It walks forward along a heading, turning toward it
// when more than half a decision's turn away; it re-picks the heading after
// STUCK_DECISIONS decisions without headway (somewhere behind it) or every
// WANDER_REPICK_TICKS (toward a random point of the arena, so it roams the
// whole arena instead of following its walls). On a visible enemy it faces the
// nearest one, fires when it is within FIRE_CONE_DEG and keeps walking; once
// the enemy is gone it walks on the way it was last looking.
//
// A left or right turn held for a whole decision is 90° (TURN_PER_DECISION_DEG),
// so without face_target its facing stays on its spawn facing + k × 90°, and
// it walks within 45° of its heading.

import { headingTo, normalizeDeg } from "../angles";
import { ARENA_HEIGHT_M, ARENA_WIDTH_M } from "../constants";
import type { DecisionContext, DecisionProvider } from "../sim/providers";
import { secondsToTicks } from "../units";
import { botAnswer, botRng, engage, floats, headwayWatch, steer, STUCK_DECISIONS, type BotIntent } from "./shared";

/** About 4 s between heading changes while it walks freely (R13). */
export const WANDER_REPICK_TICKS = secondsToTicks(4);

export function makeWanderer(seed: number, slot: number): DecisionProvider {
  const draw = floats(botRng(seed, slot));
  const headway = headwayWatch();
  let heading: number | null = null; // absolute, degrees
  let pickedAt = 0;
  let engaged = false;

  const repick = (tick: number, to: number) => {
    heading = normalizeDeg(to);
    pickedAt = tick;
  };

  function intent({ tick, observation }: DecisionContext): BotIntent {
    const { self, visible } = observation;
    const stuck = headway.check(tick, self.pos);
    const target = visible[0]; // nearest first
    if (target) {
      engaged = true;
      return engage("forward", target);
    }
    if (heading === null || engaged) repick(tick, self.facing); // start, or after a fight: on the way it looks
    engaged = false;
    if (stuck >= STUCK_DECISIONS) {
      repick(tick, self.facing + 90 + 180 * draw()); // somewhere in the half behind it
      headway.reset();
    } else if (tick - pickedAt >= WANDER_REPICK_TICKS) {
      repick(tick, headingTo(self.pos, { x: ARENA_WIDTH_M * draw(), y: ARENA_HEIGHT_M * draw() }));
    }
    return { move: "forward", turn: steer(self.facing, heading!), fire: false, target: null };
  }

  return {
    decide(ctx) {
      const next = intent(ctx);
      headway.note(ctx.tick, ctx.observation.self.pos, next.move !== "stop");
      return Promise.resolve(botAnswer("wanderer", next));
    },
  };
}
