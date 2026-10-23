import { describe, expect, it } from "vitest";
import * as core from "../../src/index";
import * as legacy from "../../src/legacy/index";

// The version-1 model and cadence constants, frozen under @decision-arena/core/legacy
// for the web, models and Worker until they move to version 2 (ruling R20; ISSUES I-028).
// Their version-2 successors: ACTOR_INTERVAL_TICKS, ACTOR_TIMEOUT_MS and the planner's
// gaps in contracts/constants.ts, the kit's PERCEPTION_WINDOW_TICKS, the arena's length.
describe("@decision-arena/core/legacy: the version-1 constants (R20)", () => {
  it.each([
    ["THINKER_MODEL", "claude-haiku-5-5"],
    ["DOER_MODEL", "@cf/cloudflare/clef-flash"],
    ["MATCH_DURATION_TICKS", 6000],
    ["DOER_INTERVAL_TICKS", 10],
    ["DOER_TIMEOUT_MS", 2000],
    ["THINKER_MIN_GAP_TICKS", 40],
    ["THINKER_MAX_GAP_TICKS", 100],
  ])("%s = %j", (name, value) => {
    expect(legacy).toHaveProperty(name, value);
  });

  it("the thinker min gap is shorter than the max gap", () => {
    expect(legacy.THINKER_MIN_GAP_TICKS).toBeLessThan(legacy.THINKER_MAX_GAP_TICKS);
  });

  it("the doer interval and timeout are the version-2 actor's", () => {
    expect([legacy.DOER_INTERVAL_TICKS, legacy.DOER_TIMEOUT_MS]).toEqual([core.ACTOR_INTERVAL_TICKS, core.ACTOR_TIMEOUT_MS]);
  });
});
