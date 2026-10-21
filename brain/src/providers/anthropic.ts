// ThinkerProvider on the Anthropic Messages API, called from the browser with the
// user's key (DESIGN.md row 2, §5.6). A failed call comes back as a ThinkerError,
// never as an exception (§5.5, principle 4):
//
//   401, 403                       auth          (fatal: stop the match, row 29)
//   402                            billing       (fatal: no credit, ISSUES I-012)
//   404                            not_found     (fatal: model not available, I-012)
//   429                            rate_limit    (caller backs off)
//   other HTTP error status        server        (5xx; also 400, 413...: see `status`)
//   stop_reason "refusal"          refusal       (row 16)
//   not JSON, or not a Plan        invalid_output
//   aborted, or connection timeout timeout
//   connection failed              network
//
// `fatal` marks the kinds that stop the match; every other kind keeps the last
// plan. Acting on either is the caller's job.
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { THINKER_MODEL } from "@kbattle/core";
import { PlanReplySchema, PlanSchema } from "../schemas";
import {
  thinkerError,
  type ThinkerError,
  type ThinkerErrorKind,
  type ThinkerProvider,
  type ThinkerResult,
} from "../types";

export interface AnthropicThinkerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Replaces the global fetch; tests pass a fake. */
  fetch?: ClientOptions["fetch"];
}

/**
 * The `thinking` parameter that turns thinking off for `model`, or undefined to
 * leave it out (ISSUES I-013). §5.6 wants a low-effort call, but which value turns
 * thinking off is model-specific, and a wrong one is a 400 on every call: Haiku 5.5
 * takes `disabled` (at effort low to high), Sonnet 5.5 answers `disabled` with a 400
 * and takes `between_tools` (its lowest setting, effort high or below), Opus 5.5
 * cannot turn thinking off at all (effort low is the only lever). Leaving the
 * field out is accepted by every model, so unknown models get that.
 */
export function thinkingParamFor(model: string): Anthropic.ThinkingConfigParam | undefined {
  return THINKING_OFF.get(model);
}

const THINKING_OFF = new Map<string, Anthropic.ThinkingConfigParam>([
  ["claude-haiku-5-5", { type: "disabled" }],
  ["claude-sonnet-5-5", { type: "between_tools" }],
]);

// Structured output (§5.4): the API constrains the reply to Plan's JSON schema.
// The SDK helper derives it from the zod schema; limits the API cannot enforce
// (minLength, maxLength) become description hints. The hints carry the lengths
// the harness prompt asks for (PlanReplySchema); PlanSchema checks the reply.
const { schema: PLAN_JSON_SCHEMA } = zodOutputFormat(PlanReplySchema);

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

  // §5.6: low effort, and thinking off where the model allows it.
  const thinking = thinkingParamFor(model);

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
            ...(thinking === undefined ? {} : { thinking }),
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
    return { ok: false, error: thinkerError("refusal", `the model declined${reason ? ` (${reason})` : ""}`) };
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
  return { ok: false, error: thinkerError("invalid_output", message) };
}

/** The fault for an error thrown by the SDK call (table at the top). */
function toThinkerError(err: unknown): ThinkerError {
  if (err instanceof APIError && err.status !== undefined) {
    return thinkerError(kindOfStatus(err.status), apiMessage(err), err.status);
  }
  // The caller aborts through input.signal when its own deadline passes.
  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) {
    return thinkerError("timeout", err.message);
  }
  if (err instanceof APIConnectionError) {
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return thinkerError("network", `${err.message}${cause}`);
  }
  // The SDK parses a 200 body itself and lets JSON.parse's error through.
  if (err instanceof SyntaxError) {
    return thinkerError("invalid_output", `the response body is not JSON: ${err.message}`);
  }
  // Anything else broke in transport, e.g. the body stream failed mid-read.
  return thinkerError("network", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

/** The kind of an HTTP error status (table at the top). */
function kindOfStatus(status: number): ThinkerErrorKind {
  switch (status) {
    case 401:
    case 403:
      return "auth";
    case 402:
      return "billing";
    case 404:
      return "not_found";
    case 429:
      return "rate_limit";
    default:
      return "server";
  }
}

/** The API's own error text ("authentication_error: invalid x-api-key"), else the SDK's message. */
function apiMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const detail = body?.error?.message;
  return typeof detail === "string" ? `${err.type ?? "error"}: ${detail}` : err.message;
}
