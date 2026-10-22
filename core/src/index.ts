// @kbattle/core public surface.
// Vector helpers live under `vec2` (vec2.add, vec2.fromAngle, ...) to keep
// generic names like `add` and `len` off the package root.
export * as vec2 from "./vec2";
export type { Vec2 } from "./vec2";
export * from "./angles";
export * from "./units";
export * from "./constants";
export * from "./types";
export * from "./schemas";
export * from "./maps";
export * from "./log";

// The sim (DESIGN.md §5.1 core role, §6.2): seeded RNG, world setup, one tick,
// perception, doer answers to actions, and the match loop with its log writer.
// Geometry lives under `collision` (collision.hasLineOfSight, ...).
export { createRng, nextFloat, nextUint32, type Draw, type RngState } from "./sim/rng";
export { spawn } from "./sim/world";
export { step, type StepActions, type StepEvent, type StepResult } from "./sim/step";
export { perceive, type PerceivedAgent, type PerceptionState } from "./sim/perceive";
export { actionFromAnswers } from "./sim/actions";
export type { DecisionContext, DecisionProvider, ProviderFactory } from "./sim/providers";
export { rankAgents, runMatch, type RunMatchDeps } from "./sim/match";
export { createLogWriter, spawnEvents, tickEvent, type LogWriter } from "./sim/log";
export { makeReplayingProvider, replayMatch } from "./sim/replay-provider";
export * as collision from "./sim/collision";

// Scripted bots (§6.2 Bots): the quality floor, as DecisionProviders.
export { botProviders, makeBot } from "./bots";
