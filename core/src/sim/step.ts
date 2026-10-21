// One physics tick (DESIGN.md §5.1, §6.2; sim rulings R1, R2).
//
// step is pure: the same state and actions give the same result, nothing
// outside its arguments is read (no Math.random, no clock), and the input state
// is never mutated. The result is a new state object; parts that did not change
// may be shared with the input, so treat every state as read-only.
//
// v1.1 skeleton: time advances, new actions are recorded on their agents, and
// bullets travel in straight lines. Turning, moving, firing and collisions
// arrive in v1.2.

import type { EventOf } from "../log";
import type { Action, AgentId, WorldState } from "../types";
import { add } from "../vec2";

/** New actions from this tick's doer answers, by agent id; an agent without one keeps its current action. */
export type StepActions = Readonly<Record<AgentId, Action>>;

/** The events a step can produce; the match loop adds Spawn, Tick, Doer, Thinker and MatchEnd. */
export type StepEvent = EventOf<"Shot" | "Hit" | "Death">;

export interface StepResult {
  state: WorldState;
  events: StepEvent[];
}

/** Advances `state` from tick t − 1 to tick t. */
export function step(state: WorldState, actions: StepActions = {}): StepResult {
  const agents = state.agents.map((agent) => {
    const action = Object.hasOwn(actions, agent.id) ? actions[agent.id] : undefined;
    return action ? { ...agent, action: { ...action } } : agent;
  });
  const bullets = state.bullets.map((b) => ({ ...b, pos: add(b.pos, b.vel) }));
  return { state: { ...state, tick: state.tick + 1, agents, bullets }, events: [] };
}
