// The Anthropic thinker against a fake fetch: no network. Each test answers the
// SDK's request with a canned HTTP response and checks the ThinkerResult (DESIGN.md
// §5.4 thinker contract, §5.5 fault model, row 29).
import { describe, expect, it } from "vitest";
import { THINKER_MODEL } from "@decision-arena/core";
import { makeAnthropicThinker, thinkingParamFor } from "../src/providers/anthropic";
import type { ThinkerInput } from "../src/types";
import { apiError, fakeFetch, refusal, reply } from "./fake-anthropic";

const PLAN = { text: "Hold the east wall; engage anyone crossing the gap.", scratchpad: "a3 likes the gap." };

const INPUT: ThinkerInput = {
  system: "You are the thinker of agent a0.",
  messages: [{ role: "user", content: '{"self":{"pos":[22.5,61],"facing":-30,"hp":72}}' }],
};

describe("makeAnthropicThinker", () => {
  it("returns the Plan and token usage from a 200 that carries a valid plan", async () => {
    const { fetch } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    const thinker = makeAnthropicThinker({ apiKey: "sk-test", fetch });

    await expect(thinker.complete(INPUT)).resolves.toEqual({
      ok: true,
      plan: PLAN,
      usage: { inputTokens: 812, outputTokens: 96 },
    });
  });

  it("asks for the Plan JSON schema as structured output, at low effort with thinking off", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("sk-test");
    expect(request?.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    // thinkingParamFor knows Haiku, Sonnet and Opus 5.5 (below). Another THINKER_MODEL
    // needs its row there and a re-run of these fault tests (ISSUES I-013).
    expect(THINKER_MODEL).toBe("claude-haiku-5-5");
    expect(request?.body).toEqual({
      model: THINKER_MODEL,
      max_tokens: 600,
      system: INPUT.system,
      messages: INPUT.messages,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: expect.objectContaining({
            type: "object",
            // The lengths the harness prompt asks for, as hints (ISSUES I-013): the
            // reply must fit max_tokens 600. PlanSchema still accepts up to 2000/4000.
            properties: {
              text: { type: "string", description: expect.stringMatching(/maxLength: 600\b/) },
              scratchpad: { type: "string", description: expect.stringMatching(/maxLength: 1200\b/) },
            },
            required: ["text", "scratchpad"],
            additionalProperties: false,
          }),
        },
      },
    });
  });

  it("sends the model and max_tokens it was made with", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    await makeAnthropicThinker({ apiKey: "sk-test", model: "claude-sonnet-5-5", maxTokens: 12, fetch }).complete(INPUT);

    expect(sent[0]?.body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 12 });
  });

  it("turns thinking off on Sonnet 5.5 with between_tools, its lowest setting (ISSUES I-013)", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    await makeAnthropicThinker({ apiKey: "sk-test", model: "claude-sonnet-5-5", fetch }).complete(INPUT);

    expect(sent[0]?.body).toMatchObject({ thinking: { type: "between_tools" }, output_config: { effort: "low" } });
  });

  it("sends no thinking field to Opus 5.5, which cannot turn thinking off (ISSUES I-013)", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    await makeAnthropicThinker({ apiKey: "sk-test", model: "claude-opus-5-5", fetch }).complete(INPUT);

    expect(sent[0]?.body).not.toHaveProperty("thinking");
    expect(sent[0]?.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" } });
  });

  it("keeps a plan longer than the harness asks for: PlanSchema decides, not the hint", async () => {
    const long = { text: "Hold the east wall. ".repeat(35), scratchpad: "a3 likes the gap. ".repeat(80) };
    const { fetch } = fakeFetch(200, reply(JSON.stringify(long)));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(long.text.length).toBeGreaterThan(600);
    expect(long.scratchpad.length).toBeGreaterThan(1200);
    expect(result).toMatchObject({ ok: true, plan: long });
  });

  it("maps a reply cut off at max_tokens (not JSON) to invalid_output", async () => {
    const { fetch } = fakeFetch(200, reply('{"text": "Hold the ea', { stop_reason: "max_tokens" }));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_output", fatal: false, message: expect.stringContaining("max_tokens") },
    });
  });

  it("maps a JSON reply that fails PlanSchema to invalid_output", async () => {
    const { fetch } = fakeFetch(200, reply(JSON.stringify({ text: "" })));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_output", fatal: false, message: expect.stringContaining("scratchpad") },
    });
  });

  it("maps stop_reason refusal to refusal (row 16)", async () => {
    const { fetch } = fakeFetch(200, refusal());
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "refusal", fatal: false, message: expect.stringContaining("general_harms") },
    });
  });

  it("maps HTTP 401 to auth with the status, a fatal error (row 29)", async () => {
    const { fetch } = fakeFetch(401, apiError("authentication_error", "invalid x-api-key"));
    const result = await makeAnthropicThinker({ apiKey: "sk-bad", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", fatal: true, status: 401, message: expect.stringContaining("invalid x-api-key") },
    });
  });

  it("maps HTTP 403 to auth with the status, a fatal error (row 29)", async () => {
    const { fetch } = fakeFetch(403, apiError("permission_error", "this key cannot use this model"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", fatal: true, status: 403, message: expect.stringContaining("cannot use this model") },
    });
  });

  it("maps HTTP 429 to rate_limit after one request: the caller backs off, not the SDK (§5.5)", async () => {
    const { fetch, sent } = fakeFetch(429, apiError("rate_limit_error", "rate limited"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "rate_limit", fatal: false, status: 429, message: expect.stringContaining("rate limited") },
    });
    expect(sent).toHaveLength(1);
  });

  it.each([
    [500, "api_error"],
    [529, "overloaded_error"],
  ])("maps HTTP %i to server after one request", async (status, type) => {
    const { fetch, sent } = fakeFetch(status, apiError(type, "try again later"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "server", fatal: false, status, message: `${type}: try again later` },
    });
    expect(sent).toHaveLength(1);
  });

  // ISSUES I-012: a key without credit (402) or a model the account cannot use (404)
  // would leave the match stuck on its first plan, so they stop it like 401/403.
  it("maps HTTP 402 to billing with the status, a fatal error (ISSUES I-012)", async () => {
    const { fetch } = fakeFetch(402, apiError("billing_error", "your credit balance is too low"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "billing", fatal: true, status: 402, message: "billing_error: your credit balance is too low" },
    });
  });

  it("maps HTTP 404 to not_found with the status, a fatal error (ISSUES I-012)", async () => {
    const { fetch } = fakeFetch(404, apiError("not_found_error", "model: claude-haiku-5-5"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "not_found", fatal: true, status: 404, message: "not_found_error: model: claude-haiku-5-5" },
    });
  });

  // §5.5 has no row for other error statuses; they keep the last plan like a 5xx,
  // and `status` tells them apart in the log.
  it.each([
    [400, "invalid_request_error"],
    [413, "request_too_large"],
  ])("maps any other HTTP error, here %i, to server with the status, not fatal", async (status, type) => {
    const { fetch } = fakeFetch(status, apiError(type, "not this time"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "server", fatal: false, status, message: `${type}: not this time` },
    });
  });

  it("maps a rejected fetch (offline, DNS, CORS) to network", async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "network", fatal: false, message: expect.any(String) } });
  });

  it("maps a timed-out connection to timeout", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("Request timed out");
    };
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "timeout", fatal: false, message: expect.any(String) } });
  });

  it("maps a call aborted through input.signal to timeout", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    const signal = AbortSignal.abort();
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete({ ...INPUT, signal });

    expect(result).toEqual({ ok: false, error: { kind: "timeout", fatal: false, message: expect.any(String) } });
    expect(sent).toHaveLength(0);
  });

  it("maps a 200 that is not a Messages API reply (a proxy's HTML page) to invalid_output", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("<html>gateway login</html>", { status: 200, headers: { "content-type": "text/html" } });
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "invalid_output", fatal: false, message: expect.any(String) } });
  });

  it("maps a 200 whose body is not JSON at all to invalid_output", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("{ cut off", { status: 200, headers: { "content-type": "application/json" } });
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "invalid_output", fatal: false, message: expect.any(String) } });
  });

  it("maps a connection that drops while the body is read to network", async () => {
    const fetch = async (): Promise<Response> => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "network", fatal: false, message: expect.stringContaining("terminated") },
    });
  });

  it("refuses to make a thinker without a key", () => {
    expect(() => makeAnthropicThinker({ apiKey: "  " })).toThrow(/API key/);
  });
});

// Which `thinking` value turns thinking off differs by model (ISSUES I-013). Sources:
// the per-model thinking table of Anthropic's API reference (cached 2026-10-06), which
// matches what v0.6 found; SDK 0.135.0 itself only says "depends on the model".
describe("thinkingParamFor", () => {
  it("turns thinking off on Haiku 5.5 with disabled, accepted at effort low to high", () => {
    expect(thinkingParamFor("claude-haiku-5-5")).toEqual({ type: "disabled" });
  });

  it("uses between_tools on Sonnet 5.5, which answers disabled with a 400", () => {
    expect(thinkingParamFor("claude-sonnet-5-5")).toEqual({ type: "between_tools" });
  });

  it("leaves thinking out on Opus 5.5, which answers disabled with a 400 at every effort", () => {
    expect(thinkingParamFor("claude-opus-5-5")).toBeUndefined();
  });

  it("leaves thinking out on any other model: omitting it is accepted everywhere", () => {
    expect(thinkingParamFor("claude-fable-5-1")).toBeUndefined();
    expect(thinkingParamFor("constructor")).toBeUndefined();
  });
});
