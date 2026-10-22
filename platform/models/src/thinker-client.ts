// One thinker call (DESIGN.md §5.4, §5.5): the system prompt is the harness plus
// the user's prompt, the user message is this turn's perception, plan, digest and
// scratchpad (thinker-prompt.ts), and the provider gets a deadline. The call never
// throws and never rejects: every failure is a ThinkerResult (principle 4), so the
// orchestrator (v3.3) can fire it off without holding a tick (row 31).
import type { AgentId, Prompts } from "@decision-arena/core";
import { buildSystem, buildUserMessage, type ThinkerTurn } from "./thinker-prompt";
import { thinkerError, type ThinkerProvider, type ThinkerResult } from "./types";

/**
 * How long a thinker call may take before it is a `timeout` fault, which keeps the
 * last plan (§5.5). ASSUMED, not in DESIGN.md: the thinker never holds a tick, so a
 * generous deadline costs only a later next call (one in flight per agent).
 */
export const THINKER_TIMEOUT_MS = 20_000;

export interface ThinkerClientOptions {
  provider: ThinkerProvider;
  /** Only the thinker's system prompt is used. */
  prompts: Pick<Prompts, "thinkerSystem">;
  timeoutMs?: number;
}

export interface ThinkerCallInput extends ThinkerTurn {
  /**
   * The agent the call is for, so one client serves every prompted slot. The prompt
   * does not name it: perception never shows an agent its own id.
   */
  agentId: AgentId;
  /** Aborting it ends the call with a `timeout` fault, e.g. when the match is cancelled. */
  signal?: AbortSignal;
}

/**
 * What a Thinker event's `input` records (§5.3, principle 4). The harness and the
 * user's prompts are not repeated: MatchLog.prompts holds them.
 */
export type ThinkerLogInput = ThinkerTurn;

export interface ThinkerCall {
  result: ThinkerResult;
  input: ThinkerLogInput;
  /** Wall time from asking the provider to its answer, or to the timeout, in whole ms. */
  latencyMs: number;
}

export interface ThinkerClient {
  call(input: ThinkerCallInput): Promise<ThinkerCall>;
}

export function makeThinkerClient({
  provider,
  prompts,
  timeoutMs = THINKER_TIMEOUT_MS,
}: ThinkerClientOptions): ThinkerClient {
  const system = buildSystem(prompts);

  return {
    async call({ tick, observation, plan, scratchpad, digest, signal }) {
      const input: ThinkerLogInput = { tick, observation, plan, scratchpad, digest };
      const deadline = AbortSignal.timeout(timeoutMs);
      const abort = signal === undefined ? deadline : AbortSignal.any([deadline, signal]);
      const why = () => (deadline.aborted ? `no reply within ${timeoutMs} ms` : "the call was aborted");

      const started = performance.now();
      const result = await untilAborted(abort, why, () =>
        provider.complete({ system, messages: [{ role: "user", content: buildUserMessage(input) }], signal: abort }),
      );
      return { result, input, latencyMs: Math.round(performance.now() - started) };
    },
  };
}

/**
 * The result of `ask()`, or a timeout as soon as `signal` aborts, whichever comes
 * first, so a provider that ignores its signal cannot hold the call. A throw or a
 * rejection becomes a `network` fault, like any other transport failure.
 */
async function untilAborted(
  signal: AbortSignal,
  why: () => string,
  ask: () => Promise<ThinkerResult>,
): Promise<ThinkerResult> {
  const timedOut = (): ThinkerResult => ({ ok: false, error: thinkerError("timeout", why()) });
  if (signal.aborted) return timedOut();

  let onAbort = () => {};
  const aborted = new Promise<ThinkerResult>((resolve) => {
    onAbort = () => resolve(timedOut());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([ask().catch(asFault), aborted]);
  } catch (err) {
    return asFault(err);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function asFault(err: unknown): ThinkerResult {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { ok: false, error: thinkerError("network", message) };
}
