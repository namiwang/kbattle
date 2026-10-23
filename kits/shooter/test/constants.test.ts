import { ESCALATE_THRESHOLD } from "@decision-arena/core";
import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";

// The shooter's constants, split from platform/core/test/constants.test.ts with them
// (ruling R23).
describe("DESIGN.md §5.6: every named constant exports its default", () => {
  it.each([["FIRE_THRESHOLD", 0.5]])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
  });
});

describe("DESIGN.md §6.2: sim numbers", () => {
  it.each([
    ["ARENA_WIDTH_M", 100],
    ["ARENA_HEIGHT_M", 100],
    ["AGENT_HP", 100],
    ["AGENT_RADIUS_M", 0.5],
    ["MOVE_SPEED_MPS", 5],
    ["TURN_RATE_DPS", 180],
    ["BULLET_SPEED_MPS", 60],
    ["BULLET_DAMAGE", 20],
    ["FIRE_INTERVAL_TICKS", 10],
    ["SPREAD_DEG", 3],
    ["VISION_CONE_DEG", 90],
    ["VISION_RANGE_M", 60],
    ["HEAR_SHOT_RANGE_M", 80],
    ["HEAR_STEPS_RANGE_M", 15],
    ["INCOMING_RADIUS_M", 2],
  ])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
  });

  it("HEARING_BANDS_M holds the near and mid upper edges", () => {
    expect(constants.HEARING_BANDS_M).toEqual({ near: 20, mid: 45 });
  });
});

describe("invariants that later tuning must keep", () => {
  it("probability thresholds are within [0, 1]", () => {
    for (const t of [constants.FIRE_THRESHOLD, ESCALATE_THRESHOLD]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it("hearing band edges ascend and sit inside the shot hearing range", () => {
    const { near, mid } = constants.HEARING_BANDS_M;
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(constants.HEAR_SHOT_RANGE_M);
  });

  it("HEARING_BANDS_M is frozen", () => {
    expect(Object.isFrozen(constants.HEARING_BANDS_M)).toBe(true);
  });
});
