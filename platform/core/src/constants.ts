// The platform's tunables (DESIGN.md §5.6). Each line names its DESIGN.md source.
// The shooter's (world, agent, weapon, perception, fire threshold) live in
// kits/shooter/src/constants.ts (ruling R23).
// ASSUMED marks a placeholder to tune in P1/P3 (§12): either DESIGN.md marks the
// value ASSUMED, or DESIGN.md gives no number and it is picked here ("not in DESIGN.md").

// ---- Models (row 18) ----

// Row 18 FLAG [Q2]: Haiku 5.5 is the spike default (plan/README.md); v3.5 picks the demo model.
export const THINKER_MODEL = "claude-haiku-5-5";
// Row 18: doer decision model on Workers AI; §5.6 allows "@cf/cloudflare/clef" if flash plays badly.
export const DOER_MODEL = "@cf/cloudflare/clef-flash";

// ---- Match clock and brain cadence (§5.2, §5.4) ----

// Row 10: one physics tick.
export const TICK_MS = 50;
// Row 20, §6.2 ASSUMED: 6,000 ticks = 5 min of sim time.
export const MATCH_DURATION_TICKS = 6000;
// Row 26 ASSUMED: one doer decision per 500 ms of sim time.
export const DOER_INTERVAL_TICKS = 10;
// §5.4 per doer call, wall-clock. ASSUMED, not in DESIGN.md: Cloudflare quotes clef-flash p95 at ~122 ms; v0.5 measures.
export const DOER_TIMEOUT_MS = 2000;
// Row 31 ASSUMED [Q6]: a tick never advances faster than real time.
export const TICK_MIN_WALL_MS = 50;
// §5.4 escalation debounce. ASSUMED, not in DESIGN.md: 2 s; caps an escalation storm at 150 calls per match.
export const THINKER_MIN_GAP_TICKS = 40;
// §5.4 forced thinker call. ASSUMED, not in DESIGN.md: 6,000 / 100 = the ~60 calls per match §9 budgets.
export const THINKER_MAX_GAP_TICKS = 100;
// Row 25 ASSUMED: escalate when the doer's `escalate` noul is >= 0.7.
export const ESCALATE_THRESHOLD = 0.7;
