import { describe, expect, expectTypeOf, it } from "vitest";
import {
  dummyModel,
  MODEL_ERROR_KINDS,
  modelError,
  ModelErrorSchema,
  UsageSchema,
  type Answer,
  type AskRequest,
  type Model,
  type ModelError,
  type Reply,
} from "../../src/contracts";
import { issuePaths, roundTrip, without } from "./helpers";

// The model contract (DESIGN.md §5.3, row 37; ruling R21.b): every model, from a
// Cloudflare decision model to a TypeScript dummy, answers through one interface.

const request = (over: Partial<AskRequest> = {}): AskRequest => ({
  state: { n: 1 },
  questions: { ready: { type: "noul", instructions: "Go?" } },
  signal: new AbortController().signal,
  ...over,
});

describe("Usage: tokens a call spent", () => {
  it("parses and round-trips; zero is allowed", () => {
    expect(roundTrip(UsageSchema, { inputTokens: 412, outputTokens: 0 })).toEqual({ inputTokens: 412, outputTokens: 0 });
  });

  it.each([
    ["negative input tokens", { inputTokens: -1, outputTokens: 0 }, ["inputTokens"]],
    ["fractional output tokens", { inputTokens: 1, outputTokens: 1.5 }, ["outputTokens"]],
    ["missing output tokens", { inputTokens: 1 }, ["outputTokens"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(UsageSchema, value)).toContainEqual(path);
  });

  it("drops a provider's extra counter instead of rejecting it (ISSUES I-009)", () => {
    expect(UsageSchema.parse({ inputTokens: 3, outputTokens: 4, cachedTokens: 2 })).toEqual({ inputTokens: 3, outputTokens: 4 });
  });
});

describe("ModelError: why a call failed (the v3 fault table)", () => {
  const timeout = { kind: "timeout", fatal: false, message: "no answer within 2000 ms" };

  it("parses every kind, with and without an HTTP status", () => {
    for (const kind of MODEL_ERROR_KINDS) expect(issuePaths(ModelErrorSchema, { ...timeout, kind })).toEqual([]);
    expect(roundTrip(ModelErrorSchema, { kind: "server", fatal: false, message: "bad gateway", status: 502 })).toEqual({
      kind: "server",
      fatal: false,
      message: "bad gateway",
      status: 502,
    });
  });

  it("names the ten kinds of DESIGN.md §5.3 plus aborted", () => {
    expect([...MODEL_ERROR_KINDS].sort()).toEqual(
      ["aborted", "auth", "billing", "invalid_output", "network", "not_found", "rate_limit", "refusal", "server", "timeout"].sort(),
    );
  });

  it.each([
    ["an unknown kind", { ...timeout, kind: "teapot" }, ["kind"]],
    ["an empty message", { ...timeout, message: "" }, ["message"]],
    ["a fractional status", { ...timeout, status: 502.5 }, ["status"]],
    ["a missing fatal flag", without(timeout, "fatal"), ["fatal"]],
    ["a fatal flag that is not a boolean", { ...timeout, fatal: "no" }, ["fatal"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(ModelErrorSchema, value)).toContainEqual(path);
  });
});

describe("modelError", () => {
  it("marks auth, billing and not_found fatal, as row 29 and ISSUES I-012 rule, and nothing else", () => {
    const fatal = MODEL_ERROR_KINDS.filter((kind) => modelError(kind, "x").fatal);
    expect([...fatal].sort()).toEqual(["auth", "billing", "not_found"]);
  });

  it("builds a ModelError the schema accepts as it is, with the status only when there is one", () => {
    const withStatus = modelError("billing", "no credit", 402);
    expect(withStatus).toEqual({ kind: "billing", fatal: true, message: "no credit", status: 402 });
    expect(ModelErrorSchema.parse(withStatus)).toEqual(withStatus);
    const without = modelError("network", "connection reset");
    expect(without).toEqual({ kind: "network", fatal: false, message: "connection reset" });
    expect(without).not.toHaveProperty("status");
  });
});

describe("dummyModel: TypeScript that answers like a model (DESIGN.md §5.3 dummy adapter)", () => {
  it("supports every question type unless told otherwise", () => {
    const answer = () => ({});
    expect([...dummyModel("dummy/first", answer).supports].sort()).toEqual(["choice", "noul", "text"]);
    expect([...dummyModel("dummy/actor", answer, ["choice", "noul"]).supports].sort()).toEqual(["choice", "noul"]);
  });

  it("answers ok with the function's answers, its own id as the model, and the request handed through", async () => {
    const seen: AskRequest[] = [];
    const model = dummyModel("dummy/yes", (req) => {
      seen.push(req);
      return { ready: { type: "noul", noul: 1 } };
    });
    const req = request({ system: "Be brief." });
    const reply = await model.ask(req);
    expect(reply).toMatchObject({ ok: true, answers: { ready: { type: "noul", noul: 1 } }, model: "dummy/yes" });
    expect(seen).toEqual([req]);
    expect(model.id).toBe("dummy/yes");
  });

  it("estimates usage at 4 characters per token: input from the JSON of state and questions, output from the answers", async () => {
    // '{"n":1}' is 7 characters, '{"ready":{"type":"noul","instructions":"Go?"}}' is 46: 53 / 4 → 14 tokens.
    // '{"ready":{"type":"noul","noul":1}}' is 34 characters: 34 / 4 → 9 tokens.
    const reply = await dummyModel("dummy/yes", () => ({ ready: { type: "noul", noul: 1 } })).ask(request());
    expect(reply).toMatchObject({ usage: { inputTokens: 14, outputTokens: 9 } });
  });

  it("counts no input for a request without state", async () => {
    // Only the 46 characters of the questions: 46 / 4 → 12 tokens. No answers: '{}' → 1 token.
    const reply = await dummyModel("dummy/none", () => ({})).ask(request({ state: undefined }));
    expect(reply).toMatchObject({ usage: { inputTokens: 12, outputTokens: 1 } });
  });

  it("waits for an answer function that returns a promise", async () => {
    const model = dummyModel("dummy/slow", async () => ({ ready: { type: "noul", noul: 0 } }));
    expect(await model.ask(request())).toMatchObject({ ok: true, answers: { ready: { type: "noul", noul: 0 } } });
  });

  it("rejects when the answer function throws, for the loop to log", async () => {
    const model = dummyModel("dummy/broken", () => {
      throw new Error("boom");
    });
    await expect(model.ask(request())).rejects.toThrow("boom");
  });
});

describe("types", () => {
  it("a Reply is either answers with usage and the model, or an error", () => {
    expectTypeOf<Extract<Reply, { ok: true }>>().toEqualTypeOf<{
      ok: true;
      answers: Record<string, Answer>;
      usage: { inputTokens: number; outputTokens: number };
      model: string;
    }>();
    expectTypeOf<Extract<Reply, { ok: false }>>().toEqualTypeOf<{ ok: false; error: ModelError }>();
    expectTypeOf<Model["ask"]>().toEqualTypeOf<(req: AskRequest) => Promise<Reply>>();
    expectTypeOf<Model["supports"]>().toEqualTypeOf<ReadonlySet<"choice" | "noul" | "text">>();
  });
});
