// What both scripted bots share (DESIGN.md §6.2 Bots; sim ruling R13): their
// private RNG, the Clef-shaped answer they give, when they fire, and how they
// notice they are stuck. Bots know only their Observation (§3 principle 3).

import { createRng, nextFloat, nextUint32, type RngState } from "@decision-arena/core";
import type { DoerAnswer } from "@decision-arena/core/legacy";
import { normalizeDeg } from "../angles";
import { MOVE_SPEED_MPS, PERCEPTION_WINDOW_TICKS, TURN_RATE_DPS } from "../constants";
import type { AgentId, MoveChoice, Observation, TurnChoice } from "../types";
import { dpsToDegreesPerTick, mpsToMetersPerTick } from "../units";
import { dist, type Vec2 } from "../vec2";

/** The scripted bots by name (DESIGN.md §13): the battle royale arena's `bot/wanderer` and `bot/camper`. */
export const BOT_KINDS = Object.freeze(["wanderer", "camper"] as const);
export type BotKind = (typeof BOT_KINDS)[number];

/** What a bot wants until its next decision; each adapter words it as crisp answers. */
export interface BotIntent {
  move: MoveChoice;
  turn: TurnChoice;
  fire: boolean;
  target: AgentId | null; // the visible enemy it faces, or nobody
}

/**
 * A bot's mind (R13): asked once per decision, in order, with the decision's tick
 * and the agent's observation, it answers its intent. It keeps its own memory and
 * RNG between decisions, so it is made fresh for each agent of each match.
 */
export interface BotMind {
  decide(tick: number, observation: Observation): BotIntent;
}

/** Bots fire when the target is at most this far off their facing (R13). */
export const FIRE_CONE_DEG = 10;

/** Decisions in a row without headway before a bot changes course (R13). */
export const STUCK_DECISIONS = 3;

/** A decision interval of turning: 90° at 180°/s and 10 ticks (bots decide once per perception window). */
export const TURN_PER_DECISION_DEG = dpsToDegreesPerTick(TURN_RATE_DPS) * PERCEPTION_WINDOW_TICKS;

const MOVE_STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS);

/** A bot's own RNG, derived from the match seed and its slot, apart from the sim's (seeded with the seed alone). */
export function botRng(seed: number, slot: number): RngState {
  return createRng(nextUint32(createRng((seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0)).value);
}

/** A cursor over a bot RNG: each call draws the next float in [0, 1). */
export function floats(rng: RngState): () => number {
  return () => {
    const draw = nextFloat(rng);
    rng = draw.rng;
    return draw.value;
  };
}

/**
 * The intent as a version-1 answer, in Clef's shape (§5.4): each choice crisp
 * (probability 1, confidence 1), fire 0 or 1, escalate always 0 (bots have no
 * thinker), and a target answer only when there is one, as a target question is
 * only asked when someone is visible (ISSUES I-005).
 */
export function botAnswer(kind: BotKind, intent: BotIntent): DoerAnswer {
  return {
    model: `bot:${kind}`,
    answers: {
      move: crisp(intent.move),
      turn: crisp(intent.turn),
      fire: { type: "noul", noul: intent.fire ? 1 : 0 },
      ...(intent.target === null ? {} : { target: crisp(intent.target) }),
      escalate: { type: "noul", noul: 0 },
    },
  };
}

function crisp<T extends string>(choice: T) {
  return { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 };
}

/** Face and shoot (R13): face_target the nearest visible enemy, fire when it is within FIRE_CONE_DEG. */
export function engage(move: MoveChoice, target: { id: AgentId; bearing: number }): BotIntent {
  return { move, turn: "face_target", fire: Math.abs(target.bearing) <= FIRE_CONE_DEG, target: target.id };
}

/**
 * Whether moves make headway: a bot reports each decision; `stuck` counts the
 * decisions in a row at which a move asked for at the previous decision got
 * under a fifth of a full walk's distance (bots see their position, not `moved`).
 */
export function headwayWatch() {
  let last: { tick: number; pos: Vec2; moving: boolean } | null = null;
  let stuck = 0;
  return {
    /** Call once per decision, before deciding: decisions in a row without headway, this one included. */
    check(tick: number, pos: Vec2): number {
      const expected = last?.moving ? MOVE_STEP_M * (tick - last.tick) : 0;
      stuck = last && expected > 0 && dist(pos, last.pos) < expected / 5 ? stuck + 1 : 0;
      return stuck;
    },
    /** Call once per decision, after deciding: where it stood and whether it asked to move. */
    note(tick: number, pos: Vec2, moving: boolean): void {
      last = { tick, pos: { ...pos }, moving };
    },
    reset(): void {
      stuck = 0;
    },
  };
}

/** The relative move whose direction is closest to the absolute `heading` (within 45°), keeping the facing. */
export function moveToward(facing: number, heading: number): MoveChoice {
  const rel = normalizeDeg(heading - facing);
  if (Math.abs(rel) <= 45) return "forward";
  if (Math.abs(rel) >= 135) return "back";
  return rel > 0 ? "right" : "left";
}

/** The turn that brings the facing toward `heading` within half a decision's turn: none, left or right. */
export function steer(facing: number, heading: number): TurnChoice {
  const delta = normalizeDeg(heading - facing);
  if (Math.abs(delta) <= TURN_PER_DECISION_DEG / 2) return "none";
  return delta > 0 ? "right" : "left";
}
