// The mind behind an agent, as the match loop sees it (DESIGN.md §5.4, §5.6;
// sim ruling R8). Scripted bots (kits/shooter/src/bots) implement it from the
// observation alone; brain's doer client (v3.1) implements it by building a
// DecideRequest from the context and the user's prompts, which core never sees.

import type { DoerAnswer, Event, Slot } from "@decision-arena/core/legacy";
import type { AgentId, Observation } from "../types";

/** One doer decision: what the agent perceives and its current plan text. */
export interface DecisionContext {
  /** The tick being decided, 1, 11, 21, … (R1). The observation is of the state before this tick's step. */
  tick: number;
  agent: AgentId;
  observation: Observation;
  /**
   * The text of the agent's latest successful Thinker event in the log, "" before
   * the first. A doer-only slot's provider uses its fixed plan instead (row 32);
   * bots ignore it.
   */
  plan: string;
  /**
   * This call's own signal (R17): aborted when the loop stops waiting for it (the
   * doer timeout; reason a "TimeoutError" DOMException), and when the match is
   * cancelled, during the call or after it. Pass it to fetch, and start no
   * follow-up work (a thinker call, a retry) once it has fired. Bots and the
   * replaying provider answer at once and ignore it.
   */
  signal: AbortSignal;
}

export interface DecisionProvider {
  /**
   * One call per due tick per living agent; the loop races it against the doer
   * timeout (R12). A rejection is logged as `Doer { ok: false, error }` with the
   * Error's message (its name when the message is empty, String(value) for a
   * non-Error), and the agent keeps its action. The answers are checked, not
   * trusted (R16): probabilities and confidence are rounded to 4 decimals, then
   * DoerAnswersSchema reads them (unknown keys dropped); what it rejects is
   * logged as `invalid answer: <path>: <message>` and the agent keeps its action.
   */
  decide(ctx: DecisionContext): Promise<DoerAnswer>;
  /**
   * Thinker events that arrived since the last poll, each stamped `tick`; the loop
   * calls it at the start of every tick 1, 2, … for every slot, living or not, and
   * appends the events before that tick's doer calls (row 31), as EventSchema
   * reads their JSON form. An event stamped with another tick or failing the
   * schema is a provider bug: runMatch rejects (R16). It gets no signal: once the
   * match ends or is cancelled nothing is polled again, so thinker work still
   * running then is never logged; a cancel reaches the provider through the
   * signals of its decide calls (R17).
   */
  pollEvents?(tick: number): Event[];
}

/** Makes the mind of one slot; runMatch calls it once per slot per match, in slot order. */
export type ProviderFactory = (slot: Slot, slotIndex: number) => DecisionProvider;
