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

// The sim (DESIGN.md §5.1 core role, §6.2): seeded RNG, world setup, one tick.
export { createRng, nextFloat, nextUint32, type Draw, type RngState } from "./sim/rng";
export { spawn } from "./sim/world";
export { step, type StepActions, type StepEvent, type StepResult } from "./sim/step";
