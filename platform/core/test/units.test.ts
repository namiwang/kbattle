import { describe, expect, it } from "vitest";
import { DOER_INTERVAL_TICKS, MATCH_DURATION_TICKS, TICK_MS } from "../src/constants";
import { dpsToDegreesPerTick, mpsToMetersPerTick, secondsToTicks } from "../src/units";

// §6.1: constants written in m/s or seconds are converted once at load.
describe("per-tick conversions", () => {
  it("assume the 50 ms tick (row 10)", () => {
    expect(TICK_MS).toBe(50);
  });

  it("mpsToMetersPerTick", () => {
    expect(mpsToMetersPerTick(5)).toBe(0.25);
    expect(mpsToMetersPerTick(60)).toBe(3);
  });

  it("dpsToDegreesPerTick", () => {
    expect(dpsToDegreesPerTick(180)).toBe(9);
    expect(dpsToDegreesPerTick(-90)).toBe(-4.5);
  });

  it("secondsToTicks matches the design's stated equivalences", () => {
    expect(secondsToTicks(300)).toBe(MATCH_DURATION_TICKS); // §6.2: 6,000 ticks = 5 min
    expect(secondsToTicks(0.5)).toBe(DOER_INTERVAL_TICKS); // row 26: one decision per 500 ms
  });

  it("secondsToTicks returns whole ticks, rounding to the nearest", () => {
    expect(secondsToTicks(16.15)).toBe(323); // 16.15 * 1000 / 50 is 322.99999999999994 in floats
    expect(secondsToTicks(8.05)).toBe(161); // and this one is 161.00000000000003
    expect(secondsToTicks(0.07)).toBe(1); // 1.4 ticks
    expect(secondsToTicks(0.08)).toBe(2); // 1.6 ticks
  });
});
