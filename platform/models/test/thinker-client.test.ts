// One thinker call (DESIGN.md §5.4, §5.5): the client builds the prompt, asks the
// provider under a deadline, and returns the result with what the log records.
// Fake providers and a fake fetch: no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSchema, type Observation } from "@decision-arena/core";
import { makeAnthropicThinker } from "../src/providers/anthropic";
import { makeThinkerClient } from "../src/thinker-client";
import { buildSystem, buildUserMessage } from "../src/thinker-prompt";
import type { ThinkerInput, ThinkerProvider, ThinkerResult } from "../src/types";
import { apiError, fakeFetch, refusal } from "./fake-anthropic";

const OBS: Observation = {
  self: { pos: { x: 22.5, y: 61 }, facing: -30, hp: 80, kills: 0, secondsLeft: 239.9 },
  visible: [{ id: "a3", bearing: -12, dist: 38, moving: true }],
  heard: [{ kind: "shot", bearing: 140, dist: "far" }],
  incoming: [{ bearing: 95 }],
};
const PROMPTS = { thinkerSystem: "Play it safe." };
const PLAN = { text: "Hold the east wall.", scratchpad: "a3 likes the gap." };
const OK: ThinkerResult = { ok: true, plan: PLAN, usage: { inputTokens: 812, outputTokens: 96 } };

// What the Thinker event's `input` records: the call minus agentId and signal.
const LOG_INPUT = { tick: 1201, observation: OBS, plan: "Find cover.", scratchpad: "", digest: "lost 20 hp (100 -> 80)" };
const CALL = { agentId: "a0", ...LOG_INPUT };

/** A provider that records every input and answers with `answer(input)`. */
function fakeProvider(answer: (input: ThinkerInput) => Promise<ThinkerResult>) {
  const inputs: ThinkerInput[] = [];
  const provider: ThinkerProvider = {
    complete(input) {
      inputs.push(input);
      return answer(input);
    },
  };
  return { provider, inputs };
}

/** A provider that never answers and ignores its signal. */
const silent = () => fakeProvider(() => new Promise<ThinkerResult>(() => undefined));

afterEach(() => {
  vi.useRealTimers();
});

describe("makeThinkerClient", () => {
  it("returns the provider's plan with the input to log and the latency", async () => {
    vi.useFakeTimers();
    const { provider } = fakeProvider(() => new Promise((resolve) => setTimeout(() => resolve(OK), 1234)));
    const pending = makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);
    await vi.advanceTimersByTimeAsync(1234);

    expect(await pending).toEqual({ result: OK, input: LOG_INPUT, latencyMs: 1234 });
  });

  it("sends the harness with the user's prompt as system, and one user message built from the call", async () => {
    const { provider, inputs } = fakeProvider(async () => OK);
    await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.system).toBe(buildSystem(PROMPTS));
    expect(inputs[0]?.messages).toEqual([{ role: "user", content: buildUserMessage(LOG_INPUT) }]);
    expect(inputs[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a refusal as ok:false, refusal, not fatal, with the input still there to log (row 16)", async () => {
    const { fetch } = fakeFetch(200, refusal());
    const provider = makeAnthropicThinker({ apiKey: "sk-test", fetch });
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);

    expect(call.result).toEqual({
      ok: false,
      error: { kind: "refusal", fatal: false, message: expect.stringContaining("general_harms") },
    });
    expect(call.input).toEqual(LOG_INPUT);
  });

  it("returns 401 as a fatal auth error, so the caller stops the match (row 29)", async () => {
    const { fetch } = fakeFetch(401, apiError("authentication_error", "invalid x-api-key"));
    const provider = makeAnthropicThinker({ apiKey: "sk-bad", fetch });
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);

    expect(call.result).toEqual({
      ok: false,
      error: { kind: "auth", fatal: true, status: 401, message: "authentication_error: invalid x-api-key" },
    });
  });

  it("returns 402 as a fatal billing error (ISSUES I-012)", async () => {
    const { fetch } = fakeFetch(402, apiError("billing_error", "your credit balance is too low"));
    const provider = makeAnthropicThinker({ apiKey: "sk-test", fetch });
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);

    expect(call.result).toEqual({
      ok: false,
      error: { kind: "billing", fatal: true, status: 402, message: "billing_error: your credit balance is too low" },
    });
  });

  it("times out after timeoutMs even when the provider never answers, and aborts the provider's call", async () => {
    const { provider, inputs } = silent();
    const call = await makeThinkerClient({ provider, prompts: PROMPTS, timeoutMs: 20 }).call(CALL);

    expect(call.result).toEqual({ ok: false, error: { kind: "timeout", fatal: false, message: "no reply within 20 ms" } });
    expect(inputs[0]?.signal?.aborted).toBe(true);
    expect(call.input).toEqual(LOG_INPUT);
  });

  it("times out a real request: the deadline aborts the fetch", async () => {
    const signals: AbortSignal[] = [];
    const fetch = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }
      });
    const provider = makeAnthropicThinker({ apiKey: "sk-test", fetch });
    const call = await makeThinkerClient({ provider, prompts: PROMPTS, timeoutMs: 20 }).call(CALL);

    expect(call.result).toMatchObject({ ok: false, error: { kind: "timeout", fatal: false } });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("ends the call when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const { provider } = silent();
    const pending = makeThinkerClient({ provider, prompts: PROMPTS }).call({ ...CALL, signal: controller.signal });
    controller.abort();

    expect((await pending).result).toEqual({
      ok: false,
      error: { kind: "timeout", fatal: false, message: "the call was aborted" },
    });
  });

  it("does not call the provider when the caller's signal is already aborted", async () => {
    const { provider, inputs } = fakeProvider(async () => OK);
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call({ ...CALL, signal: AbortSignal.abort() });

    expect(call.result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(inputs).toHaveLength(0);
  });

  it("never throws: a provider that rejects becomes a network error", async () => {
    const { provider } = fakeProvider(() => Promise.reject(new Error("boom")));
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);

    expect(call.result).toEqual({ ok: false, error: { kind: "network", fatal: false, message: "Error: boom" } });
  });

  it("gives what a failed call's Thinker event needs, and the match log accepts that event (§5.3)", async () => {
    const { fetch } = fakeFetch(200, refusal());
    const provider = makeAnthropicThinker({ apiKey: "sk-test", fetch });
    const call = await makeThinkerClient({ provider, prompts: PROMPTS }).call(CALL);
    if (call.result.ok) throw new Error("expected a refusal");
    const event = {
      kind: "Thinker",
      tick: 1211,
      requestedTick: CALL.tick,
      agent: CALL.agentId,
      input: call.input,
      ok: false,
      error: `${call.result.error.kind}: ${call.result.error.message}`,
    };

    expect(EventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});
