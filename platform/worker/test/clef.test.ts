import { DOER_MODEL } from "@decision-arena/core/legacy";
import type { DecideRequest } from "@decision-arena/core/legacy";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type MockInstance } from "vitest";
import decideRequest from "../../core/fixtures/decide-request.json" with { type: "json" };
import type { AiBinding } from "../src/decision/clef";
import worker, { type Env } from "../src/index";
import { fakeEnv } from "./fake-env";

// Route failures are logged with console.error; keep test output quiet and let tests read the lines.
let errorLog: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function postDecide(body: unknown = decideRequest): Request {
  return new Request("http://localhost/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A fake Workers AI binding: run() resolves with `output`. */
function fakeAi(output: unknown) {
  return { run: vi.fn<AiBinding["run"]>(async () => output) };
}

/** As workerd's Ai.run throws it (cloudflare-internal:ai-api): "<internal code>: <description>", no HTTP status. */
class InferenceUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceUpstreamError";
  }
}

/** A fake Workers AI binding: run() throws `error`, first recording `httpStatus` on itself as workerd's Ai does. */
function throwingAi(error: unknown, httpStatus?: number) {
  const ai = {
    lastRequestHttpStatusCode: null as number | null,
    run: vi.fn<AiBinding["run"]>(async () => {
      if (httpStatus !== undefined) ai.lastRequestHttpStatusCode = httpStatus;
      throw error;
    }),
  };
  return ai;
}

function envWith(vars: Partial<Omit<Env, "ASSETS">>): Env {
  return { ...fakeEnv().env, ...vars };
}

/** Clef's answer to the fixture request, in the wire shape of clef-wire.md / ISSUES I-004. */
const clefAnswer = {
  model: "clef-flash",
  answers: {
    move: {
      type: "choice",
      choice: "left",
      probabilities: { forward: 0.12, back: 0.03, left: 0.71, right: 0.09, stop: 0.05 },
      confidence: 0.71,
    },
    turn: {
      type: "choice",
      choice: "face_target",
      probabilities: { left: 0.05, right: 0.02, none: 0.08, face_target: 0.85 },
      confidence: 0.85,
    },
    fire: { type: "noul", noul: 0.82 },
    target: { type: "choice", choice: "a3", probabilities: { a3: 0.94, none: 0.06 }, confidence: 0.94 },
    escalate: { type: "noul", noul: 0.07 },
  },
  usage: { input_tokens: 512, output_tokens: 0 },
};

/** The same answer with keys DoerAnswerSchema does not know, at every level. */
const clefAnswerWithExtraKeys = {
  ...clefAnswer,
  request_id: "req-1",
  answers: {
    ...clefAnswer.answers,
    fire: { ...clefAnswer.answers.fire, logit: 1.52 },
    jump: { type: "noul", noul: 0.5 },
  },
  usage: { ...clefAnswer.usage, cached_tokens: 0 },
};

describe("DOER_BACKEND", () => {
  it('"clef" asks @cf/cloudflare/clef-flash in Clef\'s request shape and answers with its DoerAnswer, unknown keys dropped', async () => {
    const ai = fakeAi(clefAnswerWithExtraKeys);

    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: ai }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(clefAnswer);
    expect(ai.run).toHaveBeenCalledExactlyOnceWith("@cf/cloudflare/clef-flash", { model: "clef-flash", ...decideRequest });
  });

  it.each([
    ['"mock"', { DOER_BACKEND: "mock" }],
    ["missing", {}],
    ['unknown ("Clef")', { DOER_BACKEND: "Clef" }],
  ])("%s answers with the mock and never calls Workers AI", async (_name, vars) => {
    const ai = fakeAi(clefAnswer);

    const response = await worker.fetch(postDecide(), envWith({ ...vars, AI: ai }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "mock" });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('"clef" without an AI binding → 502, and the log says how to get one', async () => {
    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "doer backend failed" });
    expect(errorLog.mock.calls[0]?.join(" ")).toContain('DOER_BACKEND is "clef" but there is no AI binding');
  });
});

describe("Clef failures", () => {
  it.each([
    ["a probability above 1", { ...clefAnswer, answers: { fire: { type: "noul", noul: 1.7 } } }],
    ["no model", { answers: clefAnswer.answers }],
    ["a string", "not an answer"],
  ])("output with %s → 502 doer backend failed, and the reason is logged", async (_name, output) => {
    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: fakeAi(output) }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "doer backend failed" });
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls[0]?.join(" ")).toContain("does not match DoerAnswerSchema");
  });

  it("a Workers AI error without a status → 502; the error is logged, not sent", async () => {
    const ai = throwingAi(new Error("Network connection lost."));

    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: ai }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "doer backend failed" });
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls[0]?.join(" ")).toContain("Error: Network connection lost.");
  });

  it.each([
    ["and Retry-After 2", { retryAfter: "2" }, "2"],
    ["and no Retry-After", {}, null],
  ])("a Workers AI error carrying status 429 %s → 429 rate limited, Retry-After passed on", async (_name, extra, retryAfter) => {
    const ai = throwingAi(Object.assign(new Error("Too Many Requests"), { status: 429, ...extra }));

    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: ai }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(retryAfter);
    expect(await response.json()).toEqual({ error: "rate limited" });
    expect(errorLog.mock.calls[0]?.join(" ")).toContain("failed with HTTP 429: Error: Too Many Requests");
  });

  it.each([
    [429, 429, { error: "rate limited" }],
    [500, 502, { error: "doer backend failed" }],
  ])("the real binding's InferenceUpstreamError after HTTP %i (recorded on the binding) → %i", async (upstream, status, body) => {
    const ai = throwingAi(new InferenceUpstreamError("3040: Capacity temporarily exceeded, please try again."), upstream);

    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: ai }));

    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toEqual(body);
    expect(errorLog.mock.calls[0]?.join(" ")).toContain(
      `failed with HTTP ${upstream}: InferenceUpstreamError: 3040: Capacity temporarily exceeded`,
    );
  });

  it.each([400, 500, 503])("a Workers AI error carrying status %i → 502 doer backend failed", async (status) => {
    const ai = throwingAi(Object.assign(new Error("upstream failure"), { status }));

    const response = await worker.fetch(postDecide(), envWith({ DOER_BACKEND: "clef", AI: ai }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "doer backend failed" });
    expect(errorLog.mock.calls[0]?.join(" ")).toContain(`failed with HTTP ${status}: Error: upstream failure`);
  });
});

describe("workers-types", () => {
  it("routes a clef-flash call to Ai.run's unknown-model overload, so the real binding needs no cast", () => {
    // @cf/cloudflare/clef-flash is not in workers-types' AiModels map (5.20261019.1), so the call resolves to
    // run(model: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>. Checked by tsc;
    // if a later workers-types adds the model, the return type changes and this fails.
    const call = (ai: Ai, request: DecideRequest) => ai.run(DOER_MODEL, { model: "clef-flash", ...request });
    expectTypeOf(call).returns.toEqualTypeOf<Promise<Record<string, unknown>>>();
  });
});
