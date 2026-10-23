// The model contract (DESIGN.md §5.3, rows 37 and 39; ruling R21.b): anything
// that answers structured questions. A Cloudflare decision model, a chat model
// through the gateway and a TypeScript dummy differ in speed, cost and the
// question types they support, never in how they are called.
//
// A model reports a failed call as a reply, `{ ok: false, error }`, not as an
// exception (principle 4: failures are events). The match loop logs whatever
// it gets, a rejection included.

import * as z from "zod";
import { QUESTION_TYPES, type Answers, type QuestionType, type Questions } from "./question";

/** Tokens one call spent, as the provider reports them (estimated for dummies). */
export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Why a call failed: the v3 fault table (timeout, network, server, rate_limit,
 * invalid_output, refusal, auth, billing, not_found), plus `aborted` for a call the
 * match cancelled.
 */
export const MODEL_ERROR_KINDS = Object.freeze([
  "timeout",
  "network",
  "server",
  "rate_limit",
  "invalid_output",
  "refusal",
  "auth",
  "billing",
  "not_found",
  "aborted",
] as const);
export type ModelErrorKind = (typeof MODEL_ERROR_KINDS)[number];

/**
 * The kinds that stop the match (row 29, ISSUES I-012): a bad key or one without
 * access, a key without credit, a model the account cannot use. Every later call
 * would fail the same way, so keeping the last answer would leave the agent stuck.
 */
export const FATAL_MODEL_ERRORS = Object.freeze(["auth", "billing", "not_found"] as const);

export const ModelErrorSchema = z.object({
  kind: z.enum(MODEL_ERROR_KINDS),
  /** True exactly for FATAL_MODEL_ERRORS: the match ends (R22.g). */
  fatal: z.boolean(),
  message: z.string().min(1),
  /** The HTTP status, when the provider answered with one. */
  status: z.number().int().optional(),
});
export type ModelError = z.infer<typeof ModelErrorSchema>;

/** A ModelError whose `fatal` follows from its kind. */
export function modelError(kind: ModelErrorKind, message: string, status?: number): ModelError {
  const fatal = (FATAL_MODEL_ERRORS as readonly ModelErrorKind[]).includes(kind);
  return status === undefined ? { kind, fatal, message } : { kind, fatal, message, status };
}

/** One call: an optional system prompt, the state the model reads, its questions, and the call's own signal. */
export interface AskRequest {
  system?: string;
  state: unknown;
  questions: Questions;
  /** Aborted when the caller stops waiting (the timeout, a cancelled match). Pass it to fetch. */
  signal: AbortSignal;
}

/** The answers, the tokens spent and the model that answered (as the provider names it); or why not. */
export type Reply = { ok: true; answers: Answers; usage: Usage; model: string } | { ok: false; error: ModelError };

export interface Model {
  /** The catalog id: "workers-ai/@cf/cloudflare/clef-flash", "dummy/random", "bot/wanderer". */
  id: string;
  /** The question types it can answer; a role's model must support the types the role is asked. */
  supports: ReadonlySet<QuestionType>;
  ask(req: AskRequest): Promise<Reply>;
}

/**
 * A model that is a TypeScript function (DESIGN.md §5.3: dummies and bots). It
 * supports every question type unless told otherwise, answers as `id`, and
 * estimates usage at 4 characters per token so its calls are logged like any
 * other: input from the JSON of the state and the questions, output from the JSON
 * of the answers. Its answers are not checked here; the match loop checks every
 * model's answers the same way. A throwing answer function makes `ask` reject.
 */
export function dummyModel(
  id: string,
  answer: (req: AskRequest) => Answers | Promise<Answers>,
  supports: Iterable<QuestionType> = QUESTION_TYPES,
): Model {
  return {
    id,
    supports: new Set(supports),
    async ask(req) {
      const answers = await answer(req);
      const inputChars = jsonLength(req.state) + jsonLength(req.questions);
      const usage = { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(jsonLength(answers) / 4) };
      return { ok: true, answers, usage, model: id };
    },
  };
}

/** The length of a value's JSON text; 0 for a value with none (undefined). */
function jsonLength(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}
