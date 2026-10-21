import { describe, expect, it } from "vitest";
import * as core from "../src/index";

describe("@kbattle/core entry point", () => {
  it("exposes the vector helpers under the vec2 namespace", () => {
    expect(core.vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(core.vec2.fromAngle(90).y).toBe(1);
  });

  it("re-exports angles, units, constants and STOP_ACTION", () => {
    expect(core.normalizeDeg(-180)).toBe(180);
    expect(core.bearingTo({ x: 0, y: 0 }, 0, { x: 0, y: 10 })).toBe(90);
    expect(core.mpsToMetersPerTick(core.MOVE_SPEED_MPS)).toBe(0.25);
    expect(core.THINKER_MODEL).toBe("claude-haiku-5-5");
    expect(core.STOP_ACTION.move).toBe("stop");
  });
});
