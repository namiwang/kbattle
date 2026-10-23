// The platform's clock and the escalate threshold (DESIGN.md rows 10, 25, 31).
// The new cadence and timeouts (ACTOR_*, PLANNER_*) are in contracts/constants.ts;
// the version-1 model and cadence constants (THINKER_*, DOER_*, MATCH_DURATION_TICKS)
// in legacy/constants.ts until their consumers move (ruling R20); the shooter's
// (world, agent, weapon, perception, fire threshold, perception window) in
// kits/shooter/src/constants.ts (R23, R24).
// ASSUMED marks a placeholder to tune: either DESIGN.md marks the value ASSUMED, or
// DESIGN.md gives no number and it is picked here ("not in DESIGN.md").

// Row 10: one tick of sim time, the default of every arena that sets no tickMs.
export const TICK_MS = 50;
// Row 31 ASSUMED [Q6]: a tick never advances faster than real time (the browser runner's floor).
export const TICK_MIN_WALL_MS = 50;
// Row 25 ASSUMED: an actor's `escalate` answer asks for the planner when P(yes) >= 0.7.
export const ESCALATE_THRESHOLD = 0.7;
