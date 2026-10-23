// @decision-arena/core public surface: the platform (DESIGN.md §5.1). The shooter
// lives in kits/shooter, which core never imports; the version-1 schemas, log helpers
// and types live under @decision-arena/core/legacy until their consumers move (ruling R20).
export * from "./constants";

// Seeded RNG and the rounding of numbers that leave a sim (sim rulings R3, R10).
export { createRng, nextFloat, nextUint32, type Draw, type RngState } from "./rng";
export { roundTo } from "./round";
