// Seeded random numbers and decimal rounding: the numbers that must come out the same in every engine and run.

/** splitmix32 state, one unsigned 32-bit integer. Each draw returns the next state, so it can live in an arena's state. */
export interface RngState {
  readonly s: number;
}

interface Draw {
  value: number;
  rng: RngState;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** The next unsigned 32-bit integer: splitmix32, integer arithmetic only. */
export function nextUint32(rng: RngState): Draw {
  const s = (rng.s + 0x9e3779b9) >>> 0;
  let t = s ^ (s >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return { value: t >>> 0, rng: { s } };
}

/** The next float in [0, 1). */
export function nextFloat(rng: RngState): Draw {
  const { value, rng: next } = nextUint32(rng);
  return { value: value / 4294967296, rng: next };
}

/** `value` to `digits` decimals, half up, never -0: one rounding for observations, snapshots and probabilities. */
export function roundTo(value: number, digits: number): number {
  const k = 10 ** digits;
  const r = Math.round(value * k) / k;
  return r === 0 ? 0 : r;
}
