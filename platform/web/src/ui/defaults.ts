// What the page shows before the user writes anything: the prompts and the
// match form. Placeholder prompts until v3.4 writes the real ones in brain and
// this module re-exports them (DESIGN.md §5.4: "the app ships default prompts").

import { MATCH_DURATION_TICKS } from "@decision-arena/core";
import type { Prompts } from "@decision-arena/core/legacy";
import type { MatchForm } from "./state";

// Frozen: the store hands these objects out as they are, so an edit in place would
// change the defaults for the rest of the session.
export const DEFAULT_PROMPTS: Prompts = Object.freeze({
  thinkerSystem:
    "Play to survive first and to win second. Keep moving between pieces of cover and pick your fights: " +
    "shoot enemies you see before they see you, and break line of sight when you are hit from a direction " +
    "you cannot see. Below 40 HP, stop chasing and hide behind cover until the field thins out. " +
    "Write each plan as one or two short orders for the doer: where to go, whom to shoot, when to back off.",
  doerInstructions: Object.freeze({
    move:
      "Follow the plan. Move toward cover or the place the plan names; back off when you take fire you " +
      "cannot answer; stop when an enemy is in range to shoot.",
    turn: "Face your target when you have one. Otherwise turn toward incoming fire, then toward the last shot or footsteps you heard.",
    fire: "Fire when your target is visible, close to straight ahead, and within about 40 m.",
    target: "The closest visible enemy, unless the plan names another; none when the plan says to avoid fights.",
  }),
});

/** Row 23 [Q5]: 8 slots, 1 prompted, 0 doer-only, so 7 bots; map-1, seed 1, the full match length. */
export const DEFAULT_CONFIG: MatchForm = Object.freeze({
  mapId: "map-1",
  seed: 1,
  slots: 8,
  prompted: 1,
  doerOnly: 0,
  durationTicks: MATCH_DURATION_TICKS,
});
