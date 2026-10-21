// State of the v0.6 thinker spike page (disposable, may go in P4): the last plan
// that parsed, whether a key fault stopped the spike, and a log of calls. One
// ThinkerResult is applied per DESIGN.md §5.5: auth stops the spike (row 29);
// every other fault keeps the last plan (row 16) and is logged.
import type { Plan, ThinkerResult } from "@kbattle/brain";

export interface SpikeState {
  /** The last plan that parsed; faults keep it. */
  plan: Plan | null;
  /** Set by an auth fault: the error the page shows while the spike is stopped. */
  stopped: string | null;
  /** One line per call, oldest first. */
  log: string[];
}

export const initialSpikeState: SpikeState = { plan: null, stopped: null, log: [] };

/** Haiku 5.5 list prices, USD per million tokens (DESIGN.md §9, as of 2026-10-06). */
const USD_PER_MTOK = { input: 0.1, output: 0.5 };

export function costUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return (usage.inputTokens * USD_PER_MTOK.input + usage.outputTokens * USD_PER_MTOK.output) / 1_000_000;
}

/** The state after one call that took `ms` milliseconds. */
export function applyResult(state: SpikeState, result: ThinkerResult, ms: number): SpikeState {
  if (result.ok) {
    const { inputTokens, outputTokens } = result.usage;
    const line = `ok in ${ms} ms: ${inputTokens} in / ${outputTokens} out tokens, $${costUsd(result.usage).toFixed(6)}`;
    return { ...state, plan: result.plan, log: [...state.log, line] };
  }
  const { kind, status, message } = result.error;
  const fault = `${kind}${status === undefined ? "" : ` ${status}`} after ${ms} ms: ${message}`;
  if (kind === "auth") {
    return { ...state, stopped: fault, log: [...state.log, `${fault}; spike stopped (row 29)`] };
  }
  return { ...state, log: [...state.log, `${fault}; kept the last plan (§5.5)`] };
}
