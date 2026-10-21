import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "@kbattle/core";
import * as brain from "../src/index";

describe("@kbattle/brain entry point", () => {
  it("exposes the Anthropic thinker and re-exports core's PlanSchema", () => {
    expect(typeof brain.makeAnthropicThinker).toBe("function");
    expect(brain.PlanSchema).toBe(core.PlanSchema);
  });

  it("types a successful ThinkerResult with core's Plan", () => {
    expectTypeOf<brain.Plan>().toEqualTypeOf<core.Plan>();
    expectTypeOf<Extract<brain.ThinkerResult, { ok: true }>["plan"]>().toEqualTypeOf<core.Plan>();
    expectTypeOf<brain.ThinkerProvider["complete"]>().returns.resolves.toEqualTypeOf<brain.ThinkerResult>();
  });
});
