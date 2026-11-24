// The battle royale's numbers. Inside the sim the tick is the only unit of time.

export const TICK_MS = 50;
// Ticks between decisions, and the steps an observation covers: one number, so that every shot, hit and
// near miss reaches exactly one decision of each agent that perceives it.
export const DECISION_TICKS = 10;
export const MATCH_TICKS = 6_000; // 5 minutes
export const MAP_SIZE_M = 100; // every map is this wide and this high; bots see no map and count on it

export const AGENT_HP = 100;
export const AGENT_RADIUS_M = 0.5;
export const MOVE_SPEED_MPS = 5;
export const TURN_RATE_DPS = 180;
export const MOVE_STEP_M = (MOVE_SPEED_MPS * TICK_MS) / 1000; // per tick
export const TURN_STEP_DEG = (TURN_RATE_DPS * TICK_MS) / 1000; // per tick

export const BULLET_SPEED_MPS = 60;
export const BULLET_STEP_M = (BULLET_SPEED_MPS * TICK_MS) / 1000; // per tick
export const MUZZLE_OFFSET_M = AGENT_RADIUS_M + 0.1; // a bullet starts just outside its shooter's body
export const BULLET_DAMAGE = 20;
export const FIRE_INTERVAL_TICKS = 10;
export const SPREAD_DEG = 3; // the most a bullet strays from the facing, either side

export const VISION_CONE_DEG = 90; // full width
export const VISION_RANGE_M = 60;
export const HEAR_SHOT_RANGE_M = 80;
export const HEAR_STEPS_RANGE_M = 15;
export const INCOMING_RADIUS_M = 2; // a bullet passing this close is felt
export const HEARING_BANDS_M = { near: 20, mid: 45 }; // upper edges; beyond mid is far
