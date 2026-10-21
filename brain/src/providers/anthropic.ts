// ThinkerProvider on the Anthropic Messages API, called from the browser with the
// user's key (DESIGN.md row 2, §5.6). A failed call comes back as a ThinkerError,
// never as an exception (§5.5, principle 4):
//
//   401, 403                       auth          (fatal: stop the match, row 29)
//   429                            rate_limit    (caller backs off)
//   other HTTP error status        server        (5xx; also 400, 402, 404...: see `status`)
//   stop_reason "refusal"          refusal       (row 16)
//   not JSON, or not a Plan        invalid_output
//   aborted, or connection timeout timeout
//   connection failed              network
//
// Every kind but auth keeps the last plan; deciding that is the caller's job.
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { THINKER_MODEL } from "@kbattle/core";
import { PlanSchema } from "../schemas";
import type { ThinkerError, ThinkerProvider, ThinkerResult } from "../types";

export interface AnthropicThinkerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Replaces the global fetch; tests pass a fake. */
  fetch?: ClientOptions["fetch"];
}

// Structured output (§5.4): the API constrains the reply to Plan's JSON schema.
// The SDK helper derives it from the zod schema; limits the API cannot enforce
// (minLength, maxLength) become description hints, and PlanSchema checks them.
const { schema: PLAN_JSON_SCHEMA } = zodOutputFormat(PlanSchema);

export function makeAnthropicThinker({
  apiKey,
  model = THINKER_MODEL,
  maxTokens = 600,
  fetch,
}: AnthropicThinkerOptions): ThinkerProvider {
  // A thinker needs the user's key (row 2); without one the UI offers no prompted slots (§7).
  if (apiKey.trim() === "") throw new Error("makeAnthropicThinker: the API key is empty");

  // maxRetries 0: every failed call surfaces as a logged fault (§5.5), and the
  // caller owns backoff on 429 (row 21); the SDK would otherwise retry silently.
  const client = new Anthropic({ apiKey, fetch, dangerouslyAllowBrowser: true, maxRetries: 0 });

  return {
    async complete({ system, messages, signal }): Promise<ThinkerResult> {
      let reply: unknown;
      try {
        reply = await client.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system,
            messages,
            // §5.6: low effort. Haiku 5.5 accepts thinking off at effort low..high;
            // Sonnet 5.5 and Opus 5.5 reject it (400), so a model change revisits this.
            thinking: { type: "disabled" },
            output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_JSON_SCHEMA } },
          },
          { signal },
        );
      } catch (err) {
        return { ok: false, error: toThinkerError(err) };
      }
      return readPlan(reply);
    },
  };
}

/** The Plan in a 200 reply, or the fault that replaces it. */
function readPlan(reply: unknown): ThinkerResult {
  if (!isMessage(reply)) return invalidOutput("the reply is not a Messages API message");

  if (reply.stop_reason === "refusal") {
    const reason = [reply.stop_details?.category, reply.stop_details?.explanation].filter(Boolean).join(": ");
    return { ok: false, error: { kind: "refusal", message: `the model declined${reason ? ` (${reason})` : ""}` } };
  }

  // Read blocks by type: a reply may hold other blocks before the text.
  const text = reply.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Most likely cut off at max_tokens, which the stop_reason shows.
    return invalidOutput(`the reply is not JSON (stop_reason: ${reply.stop_reason})`);
  }

  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return invalidOutput(`the reply does not match Plan: ${issues.join("; ")}`);
  }
  return {
    ok: true,
    plan: parsed.data,
    usage: { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens },
  };
}

/** The SDK hands back whatever a 200 carried: a proxy's HTML page arrives as a string. */
function isMessage(reply: unknown): reply is Anthropic.Message {
  return typeof reply === "object" && reply !== null && Array.isArray((reply as { content?: unknown }).content);
}

function invalidOutput(message: string): ThinkerResult {
  return { ok: false, error: { kind: "invalid_output", message } };
}

/** The fault for an error thrown by the SDK call (table at the top). */
function toThinkerError(err: unknown): ThinkerError {
  if (err instanceof APIError && err.status !== undefined) {
    const { status } = err;
    const message = apiMessage(err);
    if (status === 401 || status === 403) return { kind: "auth", status, message };
    if (status === 429) return { kind: "rate_limit", status, message };
    return { kind: "server", status, message };
  }
  // The caller aborts through input.signal when its own deadline passes.
  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) {
    return { kind: "timeout", message: err.message };
  }
  if (err instanceof APIConnectionError) {
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return { kind: "network", message: `${err.message}${cause}` };
  }
  // The SDK parses a 200 body itself and lets JSON.parse's error through.
  if (err instanceof SyntaxError) {
    return { kind: "invalid_output", message: `the response body is not JSON: ${err.message}` };
  }
  // Anything else broke in transport, e.g. the body stream failed mid-read.
  return { kind: "network", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
}

/** The API's own error text ("authentication_error: invalid x-api-key"), else the SDK's message. */
function apiMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const detail = body?.error?.message;
  return typeof detail === "string" ? `${err.type ?? "error"}: ${detail}` : err.message;
}
