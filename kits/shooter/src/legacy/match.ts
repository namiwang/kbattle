// The match loop (DESIGN.md §5.1 core role, §5.2 tick rule, row 31; sim rulings
// R1, R8–R12): spawn, then tick by tick ask the minds, step the world and append
// everything to the log, until one agent is left or the time is up.
//
// The log starts with a Spawn event per agent and Tick(0). Then, for each tick
// t = 1, 2, …:
//   1. every slot's pollEvents(t), in slot order, living or dead: thinker results
//      that arrived since the last tick land now (row 31);
//   2. on doer-due ticks, (t − 1) % DOER_INTERVAL_TICKS === 0 (1, 11, 21, …),
//      every living agent's decide, all at once, each with its view of the world
//      before step t and raced against the doer timeout; a Doer event per call in
//      slot order; answers, their probabilities and confidence rounded to 4
//      decimals and checked against DoerAnswersSchema (R16, ISSUES I-018), are
//      logged as the schema reads them and become actions (actionFromAnswers),
//      and a call that fails, times out, is cut short or answers something the
//      schema rejects leaves the agent's action as it was (R12, principle 5);
//   3. with minWallMsPerTick > 0, wait until that much wall time has passed
//      since the previous step (§5.2: a tick advances when its doer answers are
//      in and the wall floor has passed);
//   4. step: its Shot, Hit and Death events, then Tick(t);
//   5. MatchEnd with the R11 ranking when at most one agent is alive or t is
//      config.durationTicks.
// Each doer call gets its own AbortSignal (DecisionContext.signal, R17), aborted
// at its timeout and when the match is cancelled. Cancelling (deps.signal) ends
// the match after the tick in progress: its calls in flight are logged as
// aborted, the floor is not waited out, and MatchEnd { ranking: [] } follows
// that tick's Tick. A failed doer call never
// stops the loop. These are bugs, and runMatch rejects: a config or prompts that
// do not validate, a provider factory that throws, and a pollEvents that throws
// or returns an event stamped with another tick or failing EventSchema (R16).
// Polled events are logged as EventSchema reads them, so every log parses.
//
// Determinism contract (DESIGN.md §6.1; plan v1.6). runMatch writes the same
// MatchLog, byte for byte under JSON.stringify, for the same config, map and
// prompts, when the providers give the same answers (or failures, with the same
// text) at the same ticks and the same Thinker events at the same ticks:
// - the sim is pure (spawn, step, perceive) and its only randomness is the
//   seeded RNG inside the world state; bots draw from their own RNG seeded with
//   (seed, slot), so they replay too;
// - the loop asks, polls and logs in slot order, whatever order answers arrive in;
// - wall time never reaches the log. The doer timeout and the wall floor only
//   decide how long the loop waits; what a clock decided (a call that timed out,
//   a plan that landed on tick t) is an event in the log, and the replaying
//   provider (replay-provider.ts) plays those events back at their ticks;
// - nothing here reads Math.random or Date, and performance.now only times the
//   wall floor.
// A cancelled match replays by cancelling after the same tick. Cross-engine
// determinism is not required (§6.1): the renderer reads Tick rows.

import { roundTo } from "@decision-arena/core";
import {
  DOER_INTERVAL_TICKS,
  DOER_TIMEOUT_MS,
  DoerAnswersSchema,
  EventSchema,
  MatchConfigSchema,
  PromptsSchema,
  type DoerAnswers,
  type Event,
  type MatchConfig,
  type MatchLog,
  type Prompts,
} from "@decision-arena/core/legacy";
import type * as z from "zod";
import { getMap, type MapSpec } from "../maps";
import { actionFromAnswers } from "../sim/actions";
import { perceive } from "../sim/perceive";
import { step } from "../sim/step";
import { spawn } from "../sim/world";
import type { Action, Agent, AgentId, WorldState } from "../types";
import { createLogWriter } from "./log";
import type { DecisionContext, DecisionProvider, ProviderFactory } from "./providers";

export interface RunMatchDeps {
  /** The arena; defaults to the bundled map named by config.mapId. */
  map?: MapSpec;
  /** Makes the mind of each slot, once per match, in slot order. */
  providers: ProviderFactory;
  /** The prompts that produced the match; the log carries them (§5.3). */
  prompts: Prompts;
  /** Wall time a doer call gets before it is logged as a timeout (R12). Default DOER_TIMEOUT_MS. */
  doerTimeoutMs?: number;
  /** Least wall time between two steps (row 31; the browser runner passes TICK_MIN_WALL_MS). Default 0: no floor. */
  minWallMsPerTick?: number;
  /** Cancels the match: it ends after the tick in progress with ranking []. */
  signal?: AbortSignal;
  /** Called after each Tick event, tick 0 included, with that tick and the world after it. */
  onTick?: (tick: number, state: WorldState) => void;
}

/** The error of a Doer event whose call was cut short by cancelling. */
const ABORTED = "aborted: the match was cancelled";

/** Plays one match to its end (or until cancelled) and returns its log. */
export async function runMatch(config: MatchConfig, deps: RunMatchDeps): Promise<MatchLog> {
  const match = MatchConfigSchema.parse(config);
  const writer = createLogWriter(match, PromptsSchema.parse(deps.prompts));
  const { signal, onTick } = deps;
  const timeoutMs = deps.doerTimeoutMs ?? DOER_TIMEOUT_MS;
  const minWallMs = deps.minWallMsPerTick ?? 0;
  const providers = match.slots.map((slot, slotIndex) => deps.providers(slot, slotIndex));
  const plans = new Map<AgentId, string>(); // each agent's latest successful plan text

  let state = spawn(match, deps.map ?? getMap(match.mapId));
  writer.spawn(state);
  onTick?.(0, state);
  let steppedAt = minWallMs > 0 ? performance.now() : 0; // wall clock of the last step (spawn for tick 1)

  for (;;) {
    if (signal?.aborted) {
      writer.end(state.tick, []);
      break;
    }
    const t = state.tick + 1;

    writer.append(poll(providers, t, plans));

    const actions: Record<AgentId, Action> = {};
    if ((t - 1) % DOER_INTERVAL_TICKS === 0) {
      const world = state;
      const asked = world.agents
        .filter((agent) => agent.alive)
        .map((agent) => {
          const observation = perceive(world, agent.id);
          const ctx = { tick: t, agent: agent.id, observation, plan: plans.get(agent.id) ?? "" };
          return { agent, observation, outcome: ask(providers[agent.slot]!, ctx, timeoutMs, signal) };
        });
      const outcomes = await Promise.all(asked.map((call) => call.outcome));
      writer.append(
        asked.map(({ agent, observation }, i): Event => {
          const outcome = outcomes[i]!;
          if (!outcome.ok) return { kind: "Doer", tick: t, agent: agent.id, ok: false, error: outcome.error };
          actions[agent.id] = actionFromAnswers(outcome.answers, observation.visible.map((v) => v.id));
          return { kind: "Doer", tick: t, agent: agent.id, ok: true, answers: outcome.answers };
        }),
      );
    }

    if (minWallMs > 0) {
      await waitUntil(steppedAt + minWallMs, signal);
      steppedAt = performance.now();
    }
    const result = step(state, actions);
    state = result.state;
    writer.append(result.events);
    writer.tick(state);
    onTick?.(t, state);

    if (t >= match.durationTicks || state.agents.filter((agent) => agent.alive).length <= 1) {
      writer.end(t, rankAgents(state.agents));
      break;
    }
    if (signal?.aborted) {
      writer.end(t, []);
      break;
    }
  }
  return writer.log();
}

/**
 * The final ranking (R11), winner first: living agents by kills, then HP, then
 * slot; then the dead, latest death first, then by kills, then slot. Slot order
 * is id order a0, a1, …, a15 (§6.1).
 */
export function rankAgents(agents: readonly Pick<Agent, "id" | "slot" | "alive" | "hp" | "kills" | "deathTick">[]): AgentId[] {
  const alive = agents.filter((a) => a.alive).sort((a, b) => b.kills - a.kills || b.hp - a.hp || a.slot - b.slot);
  const dead = agents
    .filter((a) => !a.alive)
    .sort((a, b) => (b.deathTick ?? 0) - (a.deathTick ?? 0) || b.kills - a.kills || a.slot - b.slot);
  return [...alive, ...dead].map((a) => a.id);
}

/**
 * Every slot's events for tick t, in slot order, as the log file will hold them: their JSON form
 * as EventSchema reads it (unknown keys dropped); a Thinker plan that worked becomes its agent's
 * plan text. Throws on an event stamped with another tick or failing the schema (R16): a provider
 * bug, which must not reach the log. Checking the JSON form also catches what only the file loses,
 * such as a Thinker `input` that is undefined (zod passes a present key holding undefined).
 */
function poll(providers: readonly DecisionProvider[], t: number, plans: Map<AgentId, string>): Event[] {
  const events: Event[] = [];
  for (const provider of providers) {
    for (const polled of provider.pollEvents?.(t) ?? []) {
      if (polled.tick !== t) throw new Error(`pollEvents(${t}) returned a ${polled.kind} event stamped tick ${polled.tick}`);
      const parsed = EventSchema.safeParse(asJson(polled));
      if (!parsed.success) throw new Error(`pollEvents(${t}) returned an invalid ${String(polled.kind)} event: ${issueText(parsed.error, "event")}`);
      const event = parsed.data;
      if (event.kind === "Thinker" && event.ok && event.plan) plans.set(event.agent, event.plan.text);
      events.push(event);
    }
  }
  return events;
}

/** `value` as JSON reads it back, what a log file holds; undefined when it has no JSON form. */
function asJson(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

type Outcome = { ok: true; answers: DoerAnswers } | { ok: false; error: string };

/**
 * One doer call raced against the timeout and the cancel signal. Never rejects:
 * a rejection, a throw, a timeout, a cancel or an answer without answers is an
 * outcome with the error text to log. The provider gets the call's own signal
 * (R17): aborted at the timeout, or by the match's signal whenever that fires
 * (AbortSignal.any holds its sources weakly, so answered calls cost nothing).
 */
function ask(provider: DecisionProvider, ctx: Omit<DecisionContext, "signal">, timeoutMs: number, signal?: AbortSignal): Promise<Outcome> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, error: ABORTED });
    const call = new AbortController();
    const settle = (outcome: Outcome) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome); // the first settle wins; later ones change nothing
    };
    const onAbort = () => settle({ ok: false, error: ABORTED });
    const timer = setTimeout(() => {
      const error = `timeout: no answer within ${timeoutMs} ms`;
      settle({ ok: false, error });
      call.abort(new DOMException(error, "TimeoutError"));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const callSignal = signal ? AbortSignal.any([call.signal, signal]) : call.signal;
      Promise.resolve(provider.decide({ ...ctx, signal: callSignal })).then(
        (answer: unknown) => settle(answered(answer)),
        (error: unknown) => settle({ ok: false, error: errorText(error) }),
      );
    } catch (error) {
      settle({ ok: false, error: errorText(error) });
    }
  });
}

/**
 * An answer's answers object, its choices' probabilities and confidence rounded to 4 decimals
 * (ISSUES I-018), as DoerAnswersSchema reads it (unknown keys dropped, keys in the schema's order),
 * so the logged answers, the action and a replay all come from the same numbers (R16). A failure
 * when there is no answers object or the schema rejects it: its first issue's path and message.
 */
function answered(answer: unknown): Outcome {
  const answers = typeof answer === "object" && answer !== null ? (answer as { answers?: unknown }).answers : undefined;
  if (typeof answers !== "object" || answers === null) return { ok: false, error: "invalid answer: no answers object" };
  const parsed = DoerAnswersSchema.safeParse(rounded(answers));
  return parsed.success ? { ok: true, answers: parsed.data } : { ok: false, error: `invalid answer: ${issueText(parsed.error, "answers")}` };
}

/** A copy of `answers` with every number in an answer's `probabilities` and its `confidence` rounded to 4 decimals; anything else as it was, for the schema to judge. */
function rounded(answers: object): Record<string, unknown> {
  const round = (value: unknown) => (typeof value === "number" ? roundTo(value, 4) : value);
  return Object.fromEntries(
    Object.entries(answers).map(([question, answer]: [string, unknown]) => {
      if (typeof answer !== "object" || answer === null) return [question, answer];
      const { probabilities, confidence } = answer as { probabilities?: unknown; confidence?: unknown };
      const copy: Record<string, unknown> = { ...answer };
      if ("confidence" in copy) copy.confidence = round(confidence);
      if (typeof probabilities === "object" && probabilities !== null) {
        copy.probabilities = Object.fromEntries(Object.entries(probabilities).map(([option, p]: [string, unknown]) => [option, round(p)]));
      }
      return [question, copy];
    }),
  );
}

/** A zod error's first issue as "path: message", the path dotted, or `whole` when the issue is with the whole value. */
function issueText(error: z.ZodError, whole: string): string {
  const issue = error.issues[0];
  if (!issue) return "rejected";
  return `${issue.path.length > 0 ? issue.path.join(".") : whole}: ${issue.message}`;
}

/** What a Doer event says about a failed call: the Error's message (its name when empty), else String(error). */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text || "decide failed";
}

/**
 * Waits until performance.now() reaches `until`, or the signal aborts. Timers can
 * fire a little early against performance.now(), so it checks the clock again.
 */
async function waitUntil(until: number, signal?: AbortSignal): Promise<void> {
  for (let now = performance.now(); now < until && !signal?.aborted; now = performance.now()) {
    await pause(until - now, signal);
  }
}

/** Waits `ms` of wall time, or less if the signal aborts first. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
