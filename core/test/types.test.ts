import { describe, expect, it } from "vitest";
import { STOP_ACTION } from "../src/types";

describe("STOP_ACTION, the default action", () => {
  it("stands still, keeps facing, holds fire, has no target", () => {
    expect(STOP_ACTION).toEqual({ move: "stop", turn: "none", fire: false, target: null });
  });

  it("is frozen, so the shared default cannot be changed by accident", () => {
    expect(Object.isFrozen(STOP_ACTION)).toBe(true);
  });
});
