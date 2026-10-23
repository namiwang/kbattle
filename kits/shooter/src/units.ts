// Unit conversions to sim ticks (DESIGN.md §6.1): constants written in m/s,
// deg/s or seconds are converted once at load; inside the sim, ticks are the
// only time unit.

import { TICK_MS } from "@decision-arena/core";

/** Meters per second to meters per tick. */
export function mpsToMetersPerTick(mps: number): number {
  return (mps * TICK_MS) / 1000;
}

/** Degrees per second to degrees per tick. */
export function dpsToDegreesPerTick(dps: number): number {
  return (dps * TICK_MS) / 1000;
}

/** Seconds to a whole number of ticks, rounded to the nearest tick. */
export function secondsToTicks(seconds: number): number {
  return Math.round((seconds * 1000) / TICK_MS);
}
