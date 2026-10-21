// The Anthropic thinker against a fake fetch: no network. Each test answers the
// SDK's request with a canned HTTP response and checks the ThinkerResult (DESIGN.md
// §5.4 thinker contract, §5.5 fault model, row 29).
import { describe, expect, it } from "vitest";
import { THINKER_MODEL } from "@kbattle/core";
import { makeAnthropicThinker } from "../src/providers/anthropic";
import type { ThinkerInput } from "../src/types";

interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records each request and answers it with `status` and a JSON `body`. */
function fakeFetch(status: number, body: unknown) {
  const sent: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  return { fetch, sent };
}

/** A Messages API reply whose only content block is the text `text`. */
function reply(text: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: THINKER_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 812, output_tokens: 96, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...overrides,
  };
}

/** A Messages API error body. */
function apiError(type: string, message: string) {
  return { type: "error", error: { type, message }, request_id: "req_test" };
}

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
    // `thinking: disabled` is accepted by Haiku 5.5 at effort low..high; Sonnet 5.5
    // and Opus 5.5 reject it with a 400. Moving THINKER_MODEL means revisiting it.
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
            properties: {
              text: expect.objectContaining({ type: "string" }),
              scratchpad: expect.objectContaining({ type: "string" }),
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

  it("maps a reply cut off at max_tokens (not JSON) to invalid_output", async () => {
    const { fetch } = fakeFetch(200, reply('{"text": "Hold the ea', { stop_reason: "max_tokens" }));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_output", message: expect.stringContaining("max_tokens") },
    });
  });

  it("maps a JSON reply that fails PlanSchema to invalid_output", async () => {
    const { fetch } = fakeFetch(200, reply(JSON.stringify({ text: "" })));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_output", message: expect.stringContaining("scratchpad") },
    });
  });

  it("maps stop_reason refusal to refusal (row 16)", async () => {
    const refused = reply("", {
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms", explanation: "Declined by a safety classifier." },
    });
    const { fetch } = fakeFetch(200, refused);
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "refusal", message: expect.stringContaining("general_harms") },
    });
  });

  it("maps HTTP 401 to auth with the status, the fatal kind (row 29)", async () => {
    const { fetch } = fakeFetch(401, apiError("authentication_error", "invalid x-api-key"));
    const result = await makeAnthropicThinker({ apiKey: "sk-bad", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", status: 401, message: expect.stringContaining("invalid x-api-key") },
    });
  });

  it("maps HTTP 403 to auth with the status (row 29)", async () => {
    const { fetch } = fakeFetch(403, apiError("permission_error", "this key cannot use this model"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", status: 403, message: expect.stringContaining("cannot use this model") },
    });
  });

  it("maps HTTP 429 to rate_limit after one request: the caller backs off, not the SDK (§5.5)", async () => {
    const { fetch, sent } = fakeFetch(429, apiError("rate_limit_error", "rate limited"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "rate_limit", status: 429, message: expect.stringContaining("rate limited") },
    });
    expect(sent).toHaveLength(1);
  });

  it.each([
    [500, "api_error"],
    [529, "overloaded_error"],
  ])("maps HTTP %i to server after one request", async (status, type) => {
    const { fetch, sent } = fakeFetch(status, apiError(type, "try again later"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "server", status, message: `${type}: try again later` } });
    expect(sent).toHaveLength(1);
  });

  // §5.5 has no row for other error statuses; they keep the last plan like a 5xx,
  // and `status` tells them apart in the log.
  it.each([
    [400, "invalid_request_error"],
    [402, "billing_error"],
    [404, "not_found_error"],
  ])("maps any other HTTP error, here %i, to server with the status", async (status, type) => {
    const { fetch } = fakeFetch(status, apiError(type, "not this time"));
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "server", status, message: `${type}: not this time` } });
  });

  it("maps a rejected fetch (offline, DNS, CORS) to network", async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "network", message: expect.any(String) } });
  });

  it("maps a timed-out connection to timeout", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("Request timed out");
    };
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "timeout", message: expect.any(String) } });
  });

  it("maps a call aborted through input.signal to timeout", async () => {
    const { fetch, sent } = fakeFetch(200, reply(JSON.stringify(PLAN)));
    const signal = AbortSignal.abort();
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete({ ...INPUT, signal });

    expect(result).toEqual({ ok: false, error: { kind: "timeout", message: expect.any(String) } });
    expect(sent).toHaveLength(0);
  });

  it("maps a 200 that is not a Messages API reply (a proxy's HTML page) to invalid_output", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("<html>gateway login</html>", { status: 200, headers: { "content-type": "text/html" } });
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "invalid_output", message: expect.any(String) } });
  });

  it("maps a 200 whose body is not JSON at all to invalid_output", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("{ cut off", { status: 200, headers: { "content-type": "application/json" } });
    const result = await makeAnthropicThinker({ apiKey: "sk-test", fetch }).complete(INPUT);

    expect(result).toEqual({ ok: false, error: { kind: "invalid_output", message: expect.any(String) } });
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

    expect(result).toEqual({ ok: false, error: { kind: "network", message: expect.stringContaining("terminated") } });
  });

  it("refuses to make a thinker without a key", () => {
    expect(() => makeAnthropicThinker({ apiKey: "  " })).toThrow(/API key/);
  });
});
