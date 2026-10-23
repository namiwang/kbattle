import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";

// The platform's constants; the shooter's moved to kits/shooter/test/constants.test.ts
// with them (ruling R23).
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
    ["ESCALATE_THRESHOLD", 0.7],
  ])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
  });
});

describe("DESIGN.md §6.2: sim numbers", () => {
  it.each([["TICK_MS", 50]])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
  });
});

describe("invariants that later tuning must keep", () => {
  it("the thinker min gap is shorter than the max gap", () => {
    expect(constants.THINKER_MIN_GAP_TICKS).toBeLessThan(constants.THINKER_MAX_GAP_TICKS);
  });
});
