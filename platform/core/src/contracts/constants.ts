// The platform's own numbers and fixed questions (DESIGN.md rows 26, 39, 40,
// §5.3; ruling R21.e). Arena numbers live in each arena. TICK_MS,
// ESCALATE_THRESHOLD and TICK_MIN_WALL_MS stay in platform/core/src/constants.ts.
// ASSUMED marks a value DESIGN.md gives as a placeholder to tune.

import type { NoulQuestion, Questions, TextQuestion } from "./question";

// Row 26 (was DOER_INTERVAL_TICKS): an actor decision every 10 ticks, unless the arena sets actorIntervalTicks.
export const ACTOR_INTERVAL_TICKS = 10;
// Row 40: a sync actor call past its timeout is a fault that keeps the last answer. The catalog's timeoutMs overrides it per model.
export const ACTOR_TIMEOUT_MS = 2000;
// Row 40 ASSUMED: the planner is asked on escalate at most every 100 ticks (5 s at 50 ms per tick).
export const PLANNER_MIN_GAP_TICKS = 100;
// Row 40 ASSUMED: and at least every 400 ticks (20 s).
export const PLANNER_MAX_GAP_TICKS = 400;
// Row 40: the planner's own timeout; it never holds a tick.
export const PLANNER_TIMEOUT_MS = 20_000;
// Row 23 (v3 row 6): 2 to 16 agents in a match; headless tests run two.
export const MIN_AGENTS = 2;
export const MAX_AGENTS = 16;

/** Asked of every actor except bots, under "escalate", beside the arena's questions (§5.3): may it ask the planner for a new plan? */
export const ESCALATE_QUESTION: NoulQuestion = Object.freeze({
  type: "noul",
  instructions:
    "Does the situation call for a new plan? Yes when something happened that the plan did not foresee, " +
    "such as a first contact or a setback, or when the plan is done.",
  criteria: Object.freeze({ true: "Ask for a new plan.", false: "Keep following the plan." }),
});

/** What the planner is asked: the plan and its own notes, within the Memory limits (§5.3, the v1 Plan limits). */
export const PLAN_QUESTIONS: Readonly<{ plan: TextQuestion; scratchpad: TextQuestion }> = Object.freeze({
  plan: Object.freeze({
    type: "text",
    instructions:
      "The new plan, given to the actor word for word at every decision. Concrete and in the game's own terms: " +
      "where to go, what to do, when to change course. Short.",
    maxChars: 2000,
  }),
  scratchpad: Object.freeze({
    type: "text",
    instructions: "Your own notes for your next call, rewritten each time. Short.",
    maxChars: 4000,
  }),
}) satisfies Questions;
