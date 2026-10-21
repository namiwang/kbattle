// Seeded RNG for the sim (DESIGN.md §6.1; sim ruling R3): splitmix32, pure
// 32-bit integer arithmetic (Math.imul, shifts), so every JS engine draws the
// same numbers. The state is one unsigned 32-bit integer in a plain object: it
// lives in WorldState, serializes with it, and is advanced functionally (each
// draw returns the next state; the given state is never changed).
//
// The sim draws only for the spawn shuffle and bullet spread (R3).
// Algorithm: splitmix32 as published in bryc's "PRNGs" collection, with the
// golden-ratio increment and the 0x21f0aaad / 0x735a2d97 mixer.

/** splitmix32 state: an unsigned 32-bit integer. */
export interface RngState {
  readonly s: number;
}

/** A drawn value and the state to draw the next one from. */
export interface Draw {
  value: number;
  rng: RngState;
}

const GOLDEN_GAMMA = 0x9e3779b9;
const TWO_POW_32 = 4294967296;

/** A generator seeded with `seed`, wrapped to an unsigned 32-bit integer (MatchConfig seeds already are). */
export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** The next unsigned 32-bit integer, in [0, 2^32). */
export function nextUint32(rng: RngState): Draw {
  const s = (rng.s + GOLDEN_GAMMA) >>> 0;
  let t = s ^ (s >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return { value: t >>> 0, rng: { s } };
}

/** The next float in [0, 1): a uint32 divided by 2^32. */
export function nextFloat(rng: RngState): Draw {
  const { value, rng: next } = nextUint32(rng);
  return { value: value / TWO_POW_32, rng: next };
}
