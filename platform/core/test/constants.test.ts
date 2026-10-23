import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";
import * as core from "../src/index";

// The platform's clock and the escalate threshold (DESIGN.md rows 10, 25, 31).
// The shooter's moved to kits/shooter/test/constants.test.ts with them (ruling
// R23); the version-1 model and cadence constants to ./legacy (R20, R0.4), where
// test/legacy/constants.test.ts checks them; the new cadence is contracts/constants.ts.
describe("DESIGN.md §5.6: every named constant exports its default", () => {
  it.each([
    ["TICK_MS", 50],
    ["TICK_MIN_WALL_MS", 50],
    ["ESCALATE_THRESHOLD", 0.7],
  ])("%s = %j", (name, value) => {
    expect(constants).toHaveProperty(name, value);
    expect(core).toHaveProperty(name, value);
  });
});

describe("the version-1 constants are retired from the main export (R20, R0.4)", () => {
  it.each(["THINKER_MODEL", "DOER_MODEL", "MATCH_DURATION_TICKS", "DOER_INTERVAL_TICKS", "DOER_TIMEOUT_MS", "THINKER_MIN_GAP_TICKS", "THINKER_MAX_GAP_TICKS"])(
    "%s is not on @decision-arena/core",
    (name) => {
      expect(constants).not.toHaveProperty(name);
      expect(core).not.toHaveProperty(name);
    },
  );
});

describe("invariants that later tuning must keep", () => {
  it("the escalate threshold is a probability", () => {
    expect(constants.ESCALATE_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(constants.ESCALATE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
