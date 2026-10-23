// Test models and agents for the loop's planner, fatal and replay tests (R22.f, g,
// k), on the fake counters arena (test/fake-arena.ts).

import { botSpec, QUESTION_TYPES, type AgentSpec, type Answers, type AskRequest, type Model, type Reply } from "../../src/contracts";
import { stepAnswer, type Direction } from "../fake-arena";

export const USAGE = { inputTokens: 10, outputTokens: 2 };
const SUPPORTS = new Set(QUESTION_TYPES);

/** A test model whose n-th call (from 0) gets script(req, n); every request lands in `seen`. Not async: it returns what the script returns. */
export function scripted(id: string, script: (req: AskRequest, n: number) => Reply | Promise<Reply>, seen: AskRequest[] = []): Model {
  let n = 0;
  return {
    id,
    supports: SUPPORTS,
    ask: (req) => {
      seen.push(req);
      return Promise.resolve(script(req, n++));
    },
  };
}

/** A reply choosing `choice` for the `step` question, from a model that calls itself `name`, with the escalate answer when given. */
export function stepped(name: string, choice: Direction, escalate?: number): Reply {
  const answers: Answers = escalate === undefined ? stepAnswer(choice) : { ...stepAnswer(choice), escalate: { type: "noul", noul: escalate } };
  return { ok: true, answers, usage: USAGE, model: name };
}

/** An actor that always steps `choice`, escalating with `escalate` when given. */
export const actor = (id: string, choice: Direction, escalate?: number) => scripted(id, () => stepped(id, choice, escalate));

/** A planner's reply: the new plan and scratchpad. */
export function planned(name: string, plan: string, scratchpad = ""): Reply {
  return { ok: true, answers: { plan: { type: "text", text: plan }, scratchpad: { type: "text", text: scratchpad } }, usage: USAGE, model: name };
}

/** A reply that never comes. */
export const never = () => new Promise<Reply>(() => {});

/** An agent of the counters arena whose actor is `model`, and whose planner is `planner` when given. */
export function player(model: string, planner?: string, prompts: Partial<AgentSpec["prompts"]> = {}): AgentSpec {
  return {
    arena: "counters",
    roles: planner === undefined ? { actor: { model } } : { actor: { model }, planner: { model: planner } },
    prompts: { planner: "", actor: {}, ...prompts },
  };
}

export const upper = botSpec("counters", "upper");

/** deps.models over a list of models, by id. */
export const resolver = (...models: Model[]) => (id: string) => models.find((model) => model.id === id);

/**
 * A clock driven by the match's onTick: `after(k)` settles when tick k has been
 * logged, so a model can answer "during" tick k + 1 the way a slow one would.
 */
export function ticks() {
  const waiting: { tick: number; go: () => void }[] = [];
  return {
    after(tick: number): Promise<void> {
      return new Promise((go) => waiting.push({ tick, go }));
    },
    onTick(tick: number): void {
      for (const wait of waiting) if (wait.tick === tick) wait.go();
    },
  };
}

/** [kind, tick, agent?, role?] per event, for compact expectations. */
export function outline(events: readonly { kind: string; tick: number; agent?: unknown; role?: unknown }[]) {
  return events.map((event) => {
    const row: unknown[] = [event.kind, event.tick];
    if (event.agent !== undefined) row.push(event.agent);
    if (event.role !== undefined) row.push(event.role);
    return row;
  });
}
