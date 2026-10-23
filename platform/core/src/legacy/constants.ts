// The version-1 model and cadence constants (ruling R20), retired from the main
// export in R0.4 and frozen here for the web, models and Worker until they move to
// version 2 (ISSUES I-028). Their successors: ACTOR_INTERVAL_TICKS, ACTOR_TIMEOUT_MS,
// PLANNER_MIN_GAP_TICKS and PLANNER_MAX_GAP_TICKS (contracts/constants.ts), the
// shooter kit's PERCEPTION_WINDOW_TICKS, the battle royale's DEFAULT_DURATION_TICKS
// and, for models, the catalog (R2.1).

// Row 18 FLAG [Q2]: Haiku 5.5 is the spike default (plan/README.md); v3.5 picks the demo model.
export const THINKER_MODEL = "claude-haiku-5-5";
// Row 18: doer decision model on Workers AI; §5.6 allows "@cf/cloudflare/clef" if flash plays badly.
export const DOER_MODEL = "@cf/cloudflare/clef-flash";
// Row 20, §6.2 ASSUMED: 6,000 ticks = 5 min of sim time.
export const MATCH_DURATION_TICKS = 6000;
// Row 26 ASSUMED: one doer decision per 500 ms of sim time.
export const DOER_INTERVAL_TICKS = 10;
// §5.4 per doer call, wall-clock. ASSUMED, not in DESIGN.md: Cloudflare quotes clef-flash p95 at ~122 ms; v0.5 measures.
export const DOER_TIMEOUT_MS = 2000;
// §5.4 escalation debounce. ASSUMED, not in DESIGN.md: 2 s; caps an escalation storm at 150 calls per match.
export const THINKER_MIN_GAP_TICKS = 40;
// §5.4 forced thinker call. ASSUMED, not in DESIGN.md: 6,000 / 100 = the ~60 calls per match §9 budgets.
export const THINKER_MAX_GAP_TICKS = 100;
