// @decision-arena/kit-shooter public surface: the 2D shooter engine (DESIGN.md §5.1).
// Vector helpers live under `vec2` (vec2.add, vec2.fromAngle, ...) to keep
// generic names like `add` and `len` off the package root.
export * as vec2 from "./vec2";
export type { Vec2 } from "./vec2";
export * from "./angles";
export * from "./units";
export * from "./constants";
export * from "./types";
export * from "./maps";

// The sim (DESIGN.md §6.2): world setup, one tick, perception, answers to
// actions. Geometry lives under `collision` (collision.hasLineOfSight, ...).
export { spawn, spawnWorld, type SpawnConfig } from "./sim/world";
export { step, type DeathEvent, type HitEvent, type ShotEvent, type StepActions, type StepEvent, type StepResult } from "./sim/step";
export { perceive, type PerceivedAgent, type PerceptionState } from "./sim/perceive";
export { actionFromAnswers, type ActionAnswers } from "./sim/actions";
export * as collision from "./sim/collision";

// Scripted bots (§13 Bots): the quality floor. One mind per bot (makeBotMind);
// makeBot and botProviders ask it as version-1 DecisionProviders until R0.5.
export { BOT_KINDS, botProviders, makeBot, makeBotMind, type BotIntent, type BotKind, type BotMind } from "./bots";

// The version-1 match loop and its log writer and replay (ruling R20): kept for the
// web's test helper and smoke until R0.5 moves the web to version 2.
export type { DecisionContext, DecisionProvider, ProviderFactory } from "./legacy/providers";
export { rankAgents, runMatch, type RunMatchDeps } from "./legacy/match";
export { createLogWriter, spawnEvents, tickEvent, type LogWriter } from "./legacy/log";
export { makeReplayingProvider, replayMatch } from "./legacy/replay-provider";
