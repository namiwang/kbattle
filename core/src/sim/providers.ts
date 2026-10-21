// The mind behind an agent, as the match loop sees it (DESIGN.md §5.4, §5.6;
// sim ruling R8). Scripted bots (core/src/bots) implement it from the
// observation alone; brain's doer client (v3.1) implements it by building a
// DecideRequest from the context and the user's prompts, which core never sees.

import type { DoerAnswer, Event } from "../schemas";
import type { AgentId, Observation } from "../types";

/** One doer decision: what the agent perceives and its current plan text. */
export interface DecisionContext {
  /** The tick being decided, 1, 11, 21, … (R1). The observation is of the state before this tick's step. */
  tick: number;
  agent: AgentId;
  observation: Observation;
  /** The thinker's latest plan text, or a fixed one (doer slots, row 32); bots ignore it. */
  plan: string;
}

export interface DecisionProvider {
  /** One call per due tick per living agent; the loop races it against the doer timeout (R12). */
  decide(ctx: DecisionContext): Promise<DoerAnswer>;
  /** Thinker events that arrived since the last poll; the loop appends them at the start of tick `tick` (row 31). */
  pollEvents?(tick: number): Event[];
}
