// The v0.6 thinker spike page's state: how one ThinkerResult changes it
// (DESIGN.md §5.5; row 29 for auth, row 16 for everything else).
import { describe, expect, it } from "vitest";
import type { ThinkerResult } from "@kbattle/brain";
import { applyResult, costUsd, initialSpikeState } from "../src/spike-thinker-state";

const PLAN_A = { text: "Hold the east wall.", scratchpad: "a3 likes the gap." };
const PLAN_B = { text: "Retreat north.", scratchpad: "Took fire from 95." };
const ok = (plan: typeof PLAN_A): ThinkerResult => ({ ok: true, plan, usage: { inputTokens: 812, outputTokens: 96 } });

describe("spike page state", () => {
  it("takes the new plan and logs tokens, cost and latency", () => {
    const state = applyResult(applyResult(initialSpikeState, ok(PLAN_A), 900), ok(PLAN_B), 1234);

    expect(state.plan).toEqual(PLAN_B);
    expect(state.stopped).toBeNull();
    expect(state.log).toHaveLength(2);
    expect(state.log[1]).toContain("1234 ms");
    expect(state.log[1]).toContain("812 in / 96 out");
    expect(state.log[1]).toContain("$0.000129");
  });

  it("keeps the last plan and logs the fault on invalid output", () => {
    const fault: ThinkerResult = {
      ok: false,
      error: { kind: "invalid_output", fatal: false, message: "the reply is not JSON (stop_reason: max_tokens)" },
    };
    const state = applyResult(applyResult(initialSpikeState, ok(PLAN_A), 900), fault, 300);

    expect(state.plan).toEqual(PLAN_A);
    expect(state.stopped).toBeNull();
    expect(state.log[1]).toContain("invalid_output");
    expect(state.log[1]).toContain("kept the last plan");
  });

  it("stops the spike on any fatal error, such as 402 billing (ISSUES I-012)", () => {
    const fault: ThinkerResult = {
      ok: false,
      error: { kind: "billing", fatal: true, status: 402, message: "billing_error: insufficient credit" },
    };
    const state = applyResult(applyResult(initialSpikeState, ok(PLAN_A), 900), fault, 120);

    expect(state.stopped).toContain("402");
    expect(state.plan).toEqual(PLAN_A);
  });

  it("stops the spike with a visible error on auth", () => {
    const fault: ThinkerResult = {
      ok: false,
      error: { kind: "auth", fatal: true, status: 401, message: "authentication_error: invalid x-api-key" },
    };
    const state = applyResult(applyResult(initialSpikeState, ok(PLAN_A), 900), fault, 120);

    expect(state.stopped).toContain("401");
    expect(state.stopped).toContain("invalid x-api-key");
    expect(state.plan).toEqual(PLAN_A);
    expect(state.log[1]).toContain("stopped");
  });

  it("prices a call at the Haiku 5.5 list prices of DESIGN.md §9", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1);
    expect(costUsd({ inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(0.5);
  });
});
