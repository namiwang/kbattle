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
 * Why a thinker call failed, by §5.5 row. Only `auth` (401/403, a bad key) stops
 * the match (row 29); every other kind keeps the last plan (row 16), and
 * `rate_limit` also backs off.
 */
export interface ThinkerError {
  kind: "auth" | "rate_limit" | "refusal" | "invalid_output" | "network" | "server" | "timeout";
  /** HTTP status, when the provider answered with an error status. */
  status?: number;
  message: string;
}

export interface ThinkerProvider {
  complete(input: ThinkerInput): Promise<ThinkerResult>;
}
