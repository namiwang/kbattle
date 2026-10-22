import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "@decision-arena/core";
import * as brain from "../src/index";

describe("@decision-arena/models entry point", () => {
  it("exposes the Anthropic thinker and re-exports core's PlanSchema", () => {
    expect(typeof brain.makeAnthropicThinker).toBe("function");
    expect(typeof brain.thinkingParamFor).toBe("function");
    expect(brain.PlanSchema).toBe(core.PlanSchema);
  });

  it("exposes the thinker client, its prompt builders and the digest (v3.2)", () => {
    for (const fn of [
      brain.makeThinkerClient,
      brain.buildSystem,
      brain.buildUserMessage,
      brain.formatObservation,
      brain.estimateTokens,
      brain.createDigest,
      brain.thinkerError,
    ]) {
      expect(typeof fn).toBe("function");
    }
    expect(brain.HARNESS_PROMPT).toContain("Output only the JSON");
    expect([brain.THINKER_TIMEOUT_MS, brain.DIGEST_MAX_CHARS]).toEqual([20_000, 800]);
    expect(brain.PLAN_REPLY_CHARS).toEqual({ text: 600, scratchpad: 1200 });
  });

  it("marks exactly auth, billing and not_found as fatal (row 29, ISSUES I-012)", () => {
    expect(brain.FATAL_THINKER_ERRORS).toEqual(["auth", "billing", "not_found"]);
    expect(brain.thinkerError("billing", "no credit", 402)).toEqual({
      kind: "billing",
      fatal: true,
      status: 402,
      message: "no credit",
    });
    expect(brain.thinkerError("timeout", "no reply")).toEqual({ kind: "timeout", fatal: false, message: "no reply" });
  });

  it("types a successful ThinkerResult with core's Plan", () => {
    expectTypeOf<brain.Plan>().toEqualTypeOf<core.Plan>();
    expectTypeOf<Extract<brain.ThinkerResult, { ok: true }>["plan"]>().toEqualTypeOf<core.Plan>();
    expectTypeOf<brain.ThinkerProvider["complete"]>().returns.resolves.toEqualTypeOf<brain.ThinkerResult>();
  });

  it("types a thinker call's log input as the turn it was built from", () => {
    expectTypeOf<brain.ThinkerCall["input"]>().toEqualTypeOf<brain.ThinkerLogInput>();
    expectTypeOf<brain.ThinkerLogInput["observation"]>().toEqualTypeOf<core.Observation>();
    expectTypeOf<brain.ThinkerClient["call"]>().returns.resolves.toEqualTypeOf<brain.ThinkerCall>();
    expectTypeOf<brain.ThinkerError["fatal"]>().toEqualTypeOf<boolean>();
  });
});
