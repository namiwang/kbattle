// @decision-arena/arena-battle-royale public surface (DESIGN.md §5.1, §13): the
// battle royale arena over the shooter kit, and what a page or a script needs
// beside it (its config, events and Tick payload, defaults, ranking).
export { battleRoyale, createBattleRoyale, type BattleRoyaleTypes } from "./arena";
export { BattleRoyaleConfigSchema, DEFAULT_DURATION_TICKS, type BattleRoyaleConfig } from "./config";
export {
  BattleRoyaleEventSchema,
  DeathEventSchema,
  HitEventSchema,
  ShotEventSchema,
  SpawnEventSchema,
  TickDataSchema,
  type BattleRoyaleEvent,
  type SpawnEvent,
  type TickData,
} from "./events";
export { DEFAULTS, MOVE_CRITERIA, NO_TARGET, TURN_CRITERIA } from "./questions";
export { rankAgents } from "./ranking";
