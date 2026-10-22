import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";

describe("DESIGN.md §5.6: every named constant exports its default", () => {
  it.each([
    ["THINKER_MODEL", "claude-haiku-5-5"],
    ["DOER_MODEL", "@cf/cloudflare/clef-flash"],
    ["MATCH_DURATION_TICKS", 6000],
    ["DOER_INTERVAL_TICKS", 10],
    ["DOER_TIMEOUT_MS", 2000],
    ["TICK_MIN_WALL_MS", 50],
    ["THINKER_MIN_GAP_TICKS", 40],
    ["THINKER_MAX_GAP_TICKS", 100],
    ["FIRE_THRESHOLD", 0.5],
    ["ESCALATE_THRESHOLD", 0.7],
  ])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
  });
});

describe("DESIGN.md §6.2: sim numbers", () => {
  it.each([
    ["TICK_MS", 50],
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
    for (const t of [constants.FIRE_THRESHOLD, constants.ESCALATE_THRESHOLD]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it("the thinker min gap is shorter than the max gap", () => {
    expect(constants.THINKER_MIN_GAP_TICKS).toBeLessThan(constants.THINKER_MAX_GAP_TICKS);
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
