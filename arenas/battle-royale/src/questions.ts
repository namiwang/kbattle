// The actor's questions and the player's defaults (DESIGN.md §5.3, §5.4, §13;
// rulings R9, R24; ISSUES I-005): move and turn are choices over the kit's fixed
// options with fixed criteria, fire is a yes/no, and target is a choice over the
// enemies the agent sees plus `none`, asked only when it sees someone (one option
// is not a choice). The criteria are the v3.1 texts (the unmerged doer question
// builder, branch p0), what v3.0 §5.4 left as "..."; a decision's worth of each
// move and turn comes from the kit's constants, so the texts follow a retune.
// Players write only the instructions; the platform puts theirs over these
// defaults and adds its own `escalate` (R22.d).

import type { AgentDefaults, Questions } from "@decision-arena/core";
import {
  dpsToDegreesPerTick,
  MOVE_SPEED_MPS,
  mpsToMetersPerTick,
  PERCEPTION_WINDOW_TICKS,
  TURN_RATE_DPS,
  type MoveChoice,
  type Observation,
  type TurnChoice,
} from "@decision-arena/kit-shooter";

// One decision interval (the actor's, which is the perception window) of each action:
// 2.5 m of walking and 90° of turning at the defaults.
const STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS) * PERCEPTION_WINDOW_TICKS;
const TURN_DEG = dpsToDegreesPerTick(TURN_RATE_DPS) * PERCEPTION_WINDOW_TICKS;

/** What each move does (sim ruling R4): relative to the facing, which a move never changes. */
export const MOVE_CRITERIA: Readonly<Record<MoveChoice, string>> = Object.freeze({
  forward: `walk straight ahead, the way you face (${STEP_M} m per decision)`,
  back: "walk backward, away from where you face, still facing the same way",
  left: "step sideways to your left, still facing the same way",
  right: "step sideways to your right, still facing the same way",
  stop: "stand still",
});

/** What each turn does (R4). Bearings are + to the right, so `right` turns toward positive bearings. */
export const TURN_CRITERIA: Readonly<Record<TurnChoice, string>> = Object.freeze({
  left: `turn left, toward negative bearings (${TURN_DEG}° per decision)`,
  right: `turn right, toward positive bearings (${TURN_DEG}° per decision)`,
  none: "keep facing the same way",
  face_target: "turn toward the target you pick; with no target, keep facing the same way",
});

/** The `none` option of the target question. */
export const NO_TARGET = "aim at nobody";

/** The default instruction of each actor question (the page's DEFAULT_PROMPTS.doerInstructions until now). */
const ACTOR = Object.freeze({
  move:
    "Follow the plan. Move toward cover or the place the plan names; back off when you take fire you " +
    "cannot answer; stop when an enemy is in range to shoot.",
  turn: "Face your target when you have one. Otherwise turn toward incoming fire, then toward the last shot or footsteps you heard.",
  fire: "Fire when your target is visible, close to straight ahead, and within about 40 m.",
  target: "The closest visible enemy, unless the plan names another; none when the plan says to avoid fights.",
});

/**
 * What a player starts from (R24): the page's default prompts until now
 * (platform/web/src/ui/defaults.ts, DEFAULT_PROMPTS), the thinker's system prompt
 * becoming the planner's, and a fixed plan for an agent without a planner, which
 * the page never had (ISSUES I-033).
 */
export const DEFAULTS: AgentDefaults = Object.freeze({
  planner:
    "Play to survive first and to win second. Keep moving between pieces of cover and pick your fights: " +
    "shoot enemies you see before they see you, and break line of sight when you are hit from a direction " +
    "you cannot see. Below 40 HP, stop chasing and hide behind cover until the field thins out. " +
    "Write each plan as one or two short orders for the doer: where to go, whom to shoot, when to back off.",
  actor: ACTOR,
  fixedPlan:
    "Survive first, win second. Move between pieces of cover and shoot the enemies you see. When you are hit " +
    "from a direction you cannot see, turn toward it or break line of sight; below 40 HP, stop chasing and stay behind cover.",
});

// The questions that never change, built once: the loop copies a question before it puts a player's instructions in.
const MOVE = Object.freeze({ type: "choice" as const, instructions: ACTOR.move, criteria: MOVE_CRITERIA });
const TURN = Object.freeze({ type: "choice" as const, instructions: ACTOR.turn, criteria: TURN_CRITERIA });
const FIRE = Object.freeze({ type: "noul" as const, instructions: ACTOR.fire });

/** The actor's questions for what it perceives: move, turn, fire, and target when it sees someone (its options nearest first, then none). */
export function actorQuestions(observation: Observation): Questions {
  const questions: Questions = { move: MOVE, turn: TURN, fire: FIRE };
  if (observation.visible.length > 0) {
    const criteria: Record<string, string> = {};
    for (const { id, bearing, dist, moving } of observation.visible) {
      criteria[id] = `the enemy at bearing ${bearing}°, ${dist} m away${moving ? ", moving" : ""}`;
    }
    criteria.none = NO_TARGET;
    questions.target = { type: "choice", instructions: ACTOR.target, criteria };
  }
  return questions;
}
