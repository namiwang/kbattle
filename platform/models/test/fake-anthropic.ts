// Canned Anthropic Messages API traffic for tests: no network.
import { THINKER_MODEL } from "@decision-arena/core/legacy";

export interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records each request and answers it with `status` and a JSON `body`. */
export function fakeFetch(status: number, body: unknown) {
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
export function reply(text: string, overrides: Record<string, unknown> = {}) {
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

/** A reply declined by a safety classifier: HTTP 200, stop_reason refusal, no content. */
export function refusal() {
  return reply("", {
    content: [],
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: "general_harms", explanation: "Declined by a safety classifier." },
  });
}

/** A Messages API error body. */
export function apiError(type: string, message: string) {
  return { type: "error", error: { type, message }, request_id: "req_test" };
}
