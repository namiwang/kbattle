// A stand-in match loop for headless bot matches, until v1.5's loop exists
// (it replaces this; scripts/run-bots.ts and the tests here then move to it).
// spawn, then for t = 1..durationTicks: on doer-due ticks, (t − 1) %
// DOER_INTERVAL_TICKS === 0 (sim ruling R1), ask each living agent's provider
// with its perception of the world before step t; turn the answers into
// actions; step. Stops once at most one agent is alive. No log, no doer
// timeouts, no thinker events: bots answer at once.

import { makeBot } from "../../src/bots";
import { DOER_INTERVAL_TICKS } from "../../src/constants";
import type { EventOf } from "../../src/log";
import { getMap } from "../../src/maps";
import type { MatchConfig } from "../../src/schemas";
import { actionFromAnswers } from "../../src/sim/actions";
import { perceive } from "../../src/sim/perceive";
import type { DecisionProvider } from "../../src/sim/providers";
import { step } from "../../src/sim/step";
import { spawn } from "../../src/sim/world";
import type { Action, AgentId, WorldState } from "../../src/types";

export interface HeadlessRun {
  state: WorldState; // the world after the last step
  deaths: EventOf<"Death">[]; // in order
  shots: number;
  hits: number;
}

/** Plays `config` on its bundled map with one provider per slot. */
export async function runHeadless(config: MatchConfig, providers: readonly DecisionProvider[]): Promise<HeadlessRun> {
  if (providers.length !== config.slots.length) throw new Error(`${config.slots.length} slots, ${providers.length} providers`);
  let state = spawn(config, getMap(config.mapId));
  const deaths: EventOf<"Death">[] = [];
  let shots = 0;
  let hits = 0;
  for (let t = 1; t <= config.durationTicks; t++) {
    const actions: Record<AgentId, Action> = {};
    if ((t - 1) % DOER_INTERVAL_TICKS === 0) {
      for (const agent of state.agents) {
        if (!agent.alive) continue;
        const observation = perceive(state, agent.id);
        const answer = await providers[agent.slot]!.decide({ tick: t, agent: agent.id, observation, plan: "" });
        actions[agent.id] = actionFromAnswers(answer.answers, observation.visible.map((v) => v.id));
      }
    }
    const result = step(state, actions);
    state = result.state;
    for (const event of result.events) {
      if (event.kind === "Death") deaths.push(event);
      else if (event.kind === "Shot") shots++;
      else hits++;
    }
    if (state.agents.filter((a) => a.alive).length <= 1) break;
  }
  return { state, deaths, shots, hits };
}

/** A fresh bot per slot, seeded with the match seed and the slot. Throws on a slot that is not a bot. */
export function botsFor(config: MatchConfig): DecisionProvider[] {
  return config.slots.map((slot, i) => {
    if (slot.kind !== "bot") throw new Error(`slot ${i} is "${slot.kind}", not a bot`);
    return makeBot(slot.bot, config.seed, i);
  });
}
