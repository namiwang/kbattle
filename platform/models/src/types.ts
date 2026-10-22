// The thinker contract (DESIGN.md §5.4, §5.6). A provider turns a system prompt and
// a conversation into a Plan, or into a ThinkerError; it never throws for a failed
// call (§5.5, principle 4: failures are events, not exceptions).
import type { Plan } from "./schemas";

export interface ThinkerInput {
  /** The harness prompt followed by the user's thinker prompt (§5.4). */
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Aborting it ends the call with a `timeout` error. */
  signal?: AbortSignal;
}

export type ThinkerResult =
  | { ok: true; plan: Plan; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: ThinkerError };

/**
 * The faults that stop the match and show the error (row 29, ISSUES I-012): a bad key
 * or one without access (`auth`, 401/403), a key without credit (`billing`, 402), a
 * model the account cannot use (`not_found`, 404). Every later call would fail the
 * same way, so keeping the last plan would leave the agent stuck on it.
 */
export const FATAL_THINKER_ERRORS = Object.freeze(["auth", "billing", "not_found"] as const);
export type FatalThinkerErrorKind = (typeof FATAL_THINKER_ERRORS)[number];

/** Why a thinker call failed, by §5.5 row. Non-fatal kinds keep the last plan (row 16); `rate_limit` also backs off. */
export type ThinkerErrorKind =
  | FatalThinkerErrorKind
  | "rate_limit"
  | "refusal"
  | "invalid_output"
  | "network"
  | "server"
  | "timeout";

export interface ThinkerError {
  kind: ThinkerErrorKind;
  /** True exactly for the FATAL_THINKER_ERRORS kinds: the caller stops the match (row 29). */
  fatal: boolean;
  /** HTTP status, when the provider answered with an error status. */
  status?: number;
  message: string;
}

/** A ThinkerError whose `fatal` follows from its kind. */
export function thinkerError(kind: ThinkerErrorKind, message: string, status?: number): ThinkerError {
  const fatal = (FATAL_THINKER_ERRORS as readonly ThinkerErrorKind[]).includes(kind);
  return status === undefined ? { kind, fatal, message } : { kind, fatal, status, message };
}

export interface ThinkerProvider {
  complete(input: ThinkerInput): Promise<ThinkerResult>;
}
