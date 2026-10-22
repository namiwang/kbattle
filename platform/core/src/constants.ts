// Every tunable in one file (DESIGN.md §5.6). Each line names its DESIGN.md source.
// ASSUMED marks a placeholder to tune in P1/P3 (§12): either DESIGN.md marks the
// value ASSUMED, or DESIGN.md gives no number and it is picked here ("not in DESIGN.md").
// Speeds and rates are written in m/s and deg/s; convert them to per-tick values
// once at load with ./units (§6.1: ticks are the only time unit inside the sim).

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
// Row 25 ASSUMED: fire when the doer's `fire` noul is >= 0.5.
export const FIRE_THRESHOLD = 0.5;
// Row 25 ASSUMED: escalate when the doer's `escalate` noul is >= 0.7.
export const ESCALATE_THRESHOLD = 0.7;

// ---- World (§6.2) ----

// §6.2 ASSUMED: arena about 100 by 100 m.
export const ARENA_WIDTH_M = 100;
// §6.2 ASSUMED: arena about 100 by 100 m.
export const ARENA_HEIGHT_M = 100;

// ---- Agent and weapon (§6.2) ----

// §6.2: starting HP.
export const AGENT_HP = 100;
// §6.2 agent body. ASSUMED, not in DESIGN.md: hit-circle radius.
export const AGENT_RADIUS_M = 0.5;
// §6.2 "fixed move speed". ASSUMED, not in DESIGN.md.
export const MOVE_SPEED_MPS = 5;
// §6.2 "fixed turn rate". ASSUMED, not in DESIGN.md.
export const TURN_RATE_DPS = 180;
// §6.2 weapon stat. ASSUMED, not in DESIGN.md.
export const BULLET_SPEED_MPS = 60;
// §6.2 weapon stat. ASSUMED, not in DESIGN.md: 5 hits kill.
export const BULLET_DAMAGE = 20;
// §6.2 weapon stat. ASSUMED, not in DESIGN.md: 2 shots per second.
export const FIRE_INTERVAL_TICKS = 10;
// §6.2 seeded spread. ASSUMED, not in DESIGN.md: max deviation from facing, either side.
export const SPREAD_DEG = 3;

// ---- Perception (§6.2) ----

// §6.2 ASSUMED: vision cone full width (±45° of facing).
export const VISION_CONE_DEG = 90;
// §6.2 ASSUMED: vision range.
export const VISION_RANGE_M = 60;
// §6.2: shots are heard within 80 m.
export const HEAR_SHOT_RANGE_M = 80;
// §6.2: footsteps are heard within 15 m.
export const HEAR_STEPS_RANGE_M = 15;
// §6.2: incoming = bullets that hit or passed within 2 m this tick.
export const INCOMING_RADIUS_M = 2;
// §6.2 "coarse distance band". ASSUMED, not in DESIGN.md: upper edges in m; beyond `mid` is `far`.
export const HEARING_BANDS_M = Object.freeze({ near: 20, mid: 45 });
