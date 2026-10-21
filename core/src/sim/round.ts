// Decimal rounding for what leaves the sim as numbers people and models read:
// observations (perceive) and, from v1.5, the log's Tick rows (sim ruling R10).
// One function for both, so a replay that rebuilds a view from Tick rows gets
// the same self position and facing the agent was given.

/** `value` rounded to `digits` decimals (half up, as Math.round), never -0. */
export function roundTo(value: number, digits: number): number {
  const k = 10 ** digits;
  const r = Math.round(value * k) / k;
  return r === 0 ? 0 : r; // -0 === 0, so this also turns -0 into +0
}
