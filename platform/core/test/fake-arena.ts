// The smallest arena the platform tests run (R0.2): a counter per agent instead
// of a world. Each step moves an agent's counter by its action, +1 for up and -1
// for down. An agent whose counter reaches +5 leaves alive and is no longer
// asked; the match ends when every agent has left or at durationTicks, ranked by
// counter then slot, with the counters as results. It has its own tick length
// and actor interval, one question (`step`: up or down), one event kind (Step),
// the counters as Tick payload, and one bot, `upper`, that always answers up.

import * as z from "zod";
import { BaseConfigSchema, dummyModel, type AgentId, type Answers, type Arena } from "../src/contracts";

/** The counter at which an agent leaves. */
export const GOAL = 5;

const CounterConfigSchema = BaseConfigSchema.extend({
  /** Every counter's value at tick 0. */
  start: z.number().int().min(-4).max(4),
});
export type CounterConfig = z.infer<typeof CounterConfigSchema>;

const StepEventSchema = z.object({
  kind: z.literal("Step"),
  tick: z.number().int().min(0),
  agent: z.string().min(1),
  delta: z.union([z.literal(1), z.literal(-1)]),
});
export type StepEvent = z.infer<typeof StepEventSchema>;

const CountersSchema = z.record(z.string().min(1), z.number().int());

export type CounterState = {
  tick: number;
  durationTicks: number;
  /** In slot order. */
  agents: readonly AgentId[];
  counters: Readonly<Record<AgentId, number>>;
  /** Agents that reached GOAL, in the order they left. */
  left: readonly AgentId[];
};

export type CounterObs = { counter: number; ticksLeft: number };
export type Direction = "up" | "down";

export type CounterTypes = {
  Config: CounterConfig;
  State: CounterState;
  Obs: CounterObs;
  Action: Direction;
  Event: StepEvent;
  TickData: Record<AgentId, number>;
};

/** A crisp answer to the `step` question. */
export function stepAnswer(choice: Direction): Answers {
  return { step: { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 } };
}

/** A valid config for the fake arena: 40 ticks from 0, seed 1, unless overridden. */
export function counterConfig(over: Partial<CounterConfig> = {}): CounterConfig {
  return { seed: 1, durationTicks: 40, start: 0, ...over };
}

const DEFAULTS = {
  planner: "Reach +5 before the time runs out.",
  actor: { step: "Go up unless the plan says otherwise." },
  fixedPlan: "Go up.",
};

/** The fake arena, typed as the contract so runMatch infers its types; `satisfies` checks the literal itself. */
export const fakeArena: Arena<CounterTypes> = {
  id: "counters",
  title: "Counters",
  modes: ["solo"],
  maps: [],
  config: CounterConfigSchema,
  tickMs: 100,
  actorIntervalTicks: 2,

  spawn(config, agents) {
    const counters = Object.fromEntries(agents.map((agent) => [agent, config.start]));
    return { state: { tick: 0, durationTicks: config.durationTicks, agents: [...agents], counters, left: [] }, events: [] };
  },

  perceive(state, agent) {
    return { counter: state.counters[agent] ?? 0, ticksLeft: state.durationTicks - state.tick };
  },

  questions() {
    return {
      step: {
        type: "choice",
        instructions: DEFAULTS.actor.step,
        criteria: { up: "Add one to your counter.", down: "Take one from your counter." },
      },
    };
  },

  actionFrom(answers, _obs, previous) {
    const step = answers.step;
    if (step?.type === "choice" && (step.choice === "up" || step.choice === "down")) return step.choice;
    return previous ?? "down";
  },

  step(state, actions) {
    const tick = state.tick + 1;
    const counters = { ...state.counters };
    const left = [...state.left];
    const events: StepEvent[] = [];
    for (const agent of state.agents) {
      const action = Object.hasOwn(actions, agent) ? actions[agent] : undefined;
      if (left.includes(agent) || action === undefined) continue;
      const delta = action === "up" ? 1 : -1;
      const counter = (counters[agent] ?? 0) + delta;
      counters[agent] = counter;
      events.push({ kind: "Step", tick, agent, delta });
      if (counter >= GOAL) left.push(agent);
    }
    return { state: { ...state, tick, counters, left }, events };
  },

  tick(state) {
    return { ...state.counters };
  },
  tickData: CountersSchema,
  events: z.discriminatedUnion("kind", [StepEventSchema]),

  active(state) {
    return state.agents.filter((agent) => !state.left.includes(agent));
  },

  ended(state) {
    if (state.left.length < state.agents.length && state.tick < state.durationTicks) return null;
    const counter = (agent: AgentId) => state.counters[agent] ?? 0;
    const ranking = [...state.agents].sort((a, b) => counter(b) - counter(a) || state.agents.indexOf(a) - state.agents.indexOf(b));
    return { ranking, results: { ...state.counters } };
  },

  staticText(config) {
    return `Counters start at ${config.start}; reach +${GOAL} within ${config.durationTicks} ticks to leave.`;
  },

  observationText(obs) {
    return `counter ${obs.counter}, ${obs.ticksLeft} ticks left`;
  },

  bots: {
    upper: () => dummyModel("bot/upper", () => stepAnswer("up")),
  },

  defaults: DEFAULTS,
} satisfies Arena<CounterTypes>;
