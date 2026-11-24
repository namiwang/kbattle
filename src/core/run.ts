// The match loop. It asks the models, hands the arena the answers that have arrived, and logs every tick and
// every call. It holds no action and never looks inside the arena's state.

import { roundTo } from "./numbers.ts";
import type { Agent, Arena, Config, Event, MatchLog, Model, Question, Reply } from "./types.ts";

const REPLAN_AFTER_MS = 5_000; // match time since the planner's last request before a `replan: yes` asks it again
const PLAN_EVERY_MS = 20_000; // match time after which the planner is asked in any case
const GIVE_UP_MS = 30_000; // wall time a call may stay out
const PLAN_CHARS = 600; // the longest prompt and plan: an actor reads one of them at every decision
const HISTORY = 40; // the newest decisions a planner is shown

const GAVE_UP = `no answer in ${GIVE_UP_MS / 1000} s`;
const ENDED = "the match ended";

const PLAN_QUESTIONS: Record<string, Question> = {
  plan: {
    type: "text",
    instructions:
      "Write the new plan for your actor, which reads it at every decision and follows it word for word: a few short orders " +
      "that serve `prompt` under `rules`, given the current `plan` and what the actor saw and answered (`history`, `observation`).",
    maxChars: PLAN_CHARS,
  },
};

/** Asked of an actor beside the arena's questions when its agent has a planner. */
const REPLAN: Question = {
  type: "choice",
  instructions: "Does the situation call for a new plan?",
  criteria: { yes: "something happened that the plan did not foresee, or the plan is done", no: "the plan still fits" },
};

export type MatchOptions = {
  models?: (id: string) => Model; // every id that is not bot/<name>
  realTime?: boolean; // keep the clock: a tick takes tickMs, and nothing waits for a model
  signal?: AbortSignal; // Stop: the match ends after the tick in progress
  onEvent?: (event: Event) => void; // each event as it is logged
};

type Job = "actor" | "planner";
type Outcome = { reply?: Reply; usage?: Reply["usage"]; error?: string }; // usage alone: a reply the check refused

/** A call that is out: asked, not yet landed. */
type Call = {
  askedTick: number;
  askedAt: number; // wall clock, real time only
  observation: unknown; // what the arena showed the agent
  outcome?: Outcome; // from the moment it settles
  ms?: number; // from asking to settling, real time only
  done: Promise<void>; // resolves when it settles, never rejects
  fail(error: string): void; // aborts it, and settles it as failed unless it has settled
};

/** One agent of the match. */
type Seat = {
  id: string;
  models: { actor: Model; planner?: Model };
  prompt: string;
  plan: string; // what its actor reads: the prompt, until its planner writes
  replan: boolean; // its actor's latest answer to `replan`
  plannedTick?: number; // when its planner was last asked
  history: { tick: number; observation: unknown; answers: Record<string, string> }[]; // since that request
  out: { actor?: Call; planner?: Call };
};

/** Plays one match and returns its log. Rejects only before tick 0; after it, whatever goes wrong ends the match. */
export async function runMatch<State, Obs>(
  arena: Arena<State, Obs>,
  config: Config,
  agents: Agent[],
  options: MatchOptions = {},
): Promise<MatchLog> {
  const realTime = options.realTime ?? false;
  if (agents.length < 2 || agents.length > 16) throw new Error(`a match takes 2 to 16 agents, not ${agents.length}`);
  const model = (id: string): Model => {
    if (!options.models) throw new Error(`no model "${id}": options.models is missing`);
    return options.models(id);
  };
  const seats = agents.map((agent, i): Seat => {
    const prompt = agent.prompt ?? "";
    if (prompt.length > PLAN_CHARS) throw new Error(`agent ${i}: a prompt is at most ${PLAN_CHARS} characters, not ${prompt.length}`);
    const bot = agent.actor.startsWith("bot/") ? agent.actor.slice(4) : undefined;
    if (bot !== undefined && !Object.hasOwn(arena.bots, bot)) throw new Error(`agent ${i}: ${arena.id} has no bot "${bot}"`);
    if (bot !== undefined && agent.planner !== undefined) throw new Error(`agent ${i}: a bot has no planner`);
    const actor = bot !== undefined ? arena.bots[bot]!(config.seed, i) : model(agent.actor);
    const planner = agent.planner !== undefined ? model(agent.planner) : undefined;
    return { id: `a${i}`, models: { actor, planner }, prompt, plan: prompt, replan: false, history: [], out: {} };
  });

  const log: MatchLog = { version: 1, arena: arena.id, config, agents, events: [] };
  let tick = 0;
  let failure: string | undefined; // why the match must end after the tick in progress
  let onEvent = options.onEvent;
  const emit = (event: Event): void => {
    log.events.push(event);
    try {
      onEvent?.(event);
    } catch (error) {
      onEvent = undefined;
      failure ??= errorText(error);
    }
  };
  // Keys in the order of the Event type, absent rather than undefined, so the log's JSON is stable.
  const emitCall = (seat: Seat, job: Job, call: Call, outcome: Outcome): void =>
    emit({
      kind: "Call",
      tick,
      agent: seat.id,
      job,
      ...(call.askedTick < tick && { askedTick: call.askedTick }),
      observation: call.observation,
      ...outcome.reply,
      ...(outcome.usage !== undefined && { usage: outcome.usage }),
      ...(call.ms !== undefined && { ms: call.ms }),
      ...(outcome.error !== undefined && { error: outcome.error }),
    });
  const firstLanded = new Set<string>(); // "<agent> <job>" once that job's first call has landed
  /** Takes a settled call off its seat and logs it; its reply, if it has one. */
  const land = (seat: Seat, job: Job): Reply | undefined => {
    const call = seat.out[job];
    if (!call?.outcome) return undefined;
    seat.out[job] = undefined;
    emitCall(seat, job, call, call.outcome);
    const name = `${seat.id} ${job}`;
    if (call.outcome.error !== undefined && !firstLanded.has(name)) failure ??= `${name}: ${call.outcome.error}`;
    firstLanded.add(name);
    return call.outcome.reply;
  };
  const end = (ranking: string[], error?: string): MatchLog => {
    for (const seat of seats) {
      for (const job of ["planner", "actor"] as const) {
        const call = seat.out[job];
        if (!call) continue;
        call.fail(ENDED);
        // With a clock, an answer that arrived and had not landed is logged as it is; without one, calls still
        // out are always logged as failed, so the log never depends on timing.
        emitCall(seat, job, call, realTime ? call.outcome! : { error: ENDED });
      }
    }
    emit({ kind: "End", tick, ranking, ...(error !== undefined && { error }) });
    return log;
  };
  const settled = (job: Job) => Promise.all(seats.map((seat) => seat.out[job]?.done));
  const withReplan = { ...arena.questions, replan: REPLAN };

  let state = arena.spawn(config, seats.map((seat) => seat.id));
  emit({ kind: "Tick", tick, snapshot: arena.snapshot(state) });

  try {
    let due = realTime ? performance.now() : 0; // when the step in progress is due
    for (;;) {
      if (tick % arena.actEvery === 0) {
        // A decision. Without a clock every call is waited for: a plan lands at the decision after it was
        // asked, an actor's answers on the tick they were asked.
        if (!realTime) await settled("planner");
        for (const seat of seats) seat.plan = land(seat, "planner")?.answers.plan ?? seat.plan;
        const active = arena.active(state);
        for (const seat of seats) {
          if (failure !== undefined || !active.includes(seat.id)) continue; // a match already lost asks nobody
          const observation = arena.perceive(state, seat.id);
          const planner = seat.out.planner ? undefined : seat.models.planner;
          const since = seat.plannedTick === undefined ? Infinity : (tick - seat.plannedTick) * arena.tickMs; // match time
          if (planner && (since >= PLAN_EVERY_MS || (seat.replan && since >= REPLAN_AFTER_MS))) {
            const { prompt, plan, history } = seat;
            const state = { rules: arena.rules(config), prompt, plan, history, observation };
            seat.out.planner = ask(planner, state, PLAN_QUESTIONS, tick, realTime, observation);
            seat.plannedTick = tick;
            seat.history = [];
          }
          if (!seat.out.actor) {
            const questions = seat.models.planner ? withReplan : arena.questions;
            seat.out.actor = ask(seat.models.actor, { plan: seat.plan, observation }, questions, tick, realTime, observation);
          }
        }
        if (!realTime) await settled("actor");
      }

      if (realTime) {
        // The step waits for its time and for nothing else. A late loop does not catch up, and it yields to
        // the event loop on every tick even when it is late.
        const before = performance.now();
        due = Math.max(due + arena.tickMs, before);
        await new Promise((resolve) => setTimeout(resolve, due - before));
        const now = performance.now();
        for (const seat of seats) {
          for (const call of [seat.out.actor, seat.out.planner]) if (call && !call.outcome && now - call.askedAt > GIVE_UP_MS) call.fail(GAVE_UP);
        }
      }

      const answers: Record<string, Record<string, string>> = {};
      for (const seat of seats) {
        const call = seat.out.actor;
        const reply = land(seat, "actor");
        if (!call || !reply) continue; // a failed call changes nothing: the agent keeps doing what it was doing
        const { replan, ...given } = reply.answers; // `replan` is the match's question, not the arena's
        answers[seat.id] = given;
        seat.replan = replan === "yes";
        seat.history.push({ tick: call.askedTick, observation: call.observation, answers: given });
        if (seat.history.length > HISTORY) seat.history.shift();
      }
      state = arena.step(state, answers);
      tick += 1;
      emit({ kind: "Tick", tick, snapshot: arena.snapshot(state) });

      const ranking = arena.ended(state);
      if (ranking) return end(ranking);
      if (failure !== undefined) return end([], failure);
      if (options.signal?.aborted) return end([], "stopped");
    }
  } catch (error) {
    return end([], errorText(error));
  }
}

/**
 * What of a model's reply holds up against the questions it was asked: a pick that is one of the options, a
 * text that is not blank, cut to maxChars, probabilities of kept picks, well-formed usage.
 */
function checkReply(questions: Record<string, Question>, raw: unknown): Reply {
  if (!isRecord(raw)) return { answers: {} };
  const given = isRecord(raw.answers) ? raw.answers : {};
  const odds = isRecord(raw.probabilities) ? raw.probabilities : {};
  const answers: Record<string, string> = {};
  const probabilities: Record<string, Record<string, number>> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = Object.hasOwn(given, id) ? given[id] : undefined;
    if (typeof answer !== "string") continue;
    if (question.type === "text") {
      const cut = answer.slice(0, question.maxChars);
      const text = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut; // never half of a surrogate pair
      if (text.trim() !== "") answers[id] = text;
      continue;
    }
    if (!Object.hasOwn(question.criteria, answer)) continue;
    answers[id] = answer;
    const perOption = Object.hasOwn(odds, id) ? odds[id] : undefined;
    if (!isRecord(perOption)) continue;
    const kept: Record<string, number> = {};
    for (const option of Object.keys(question.criteria)) {
      const p = Object.hasOwn(perOption, option) ? perOption[option] : undefined;
      if (typeof p === "number" && Number.isFinite(p)) kept[option] = roundTo(p, 2);
    }
    if (Object.keys(kept).length > 0) probabilities[id] = kept;
  }
  const reply: Reply = { answers };
  if (Object.keys(probabilities).length > 0) reply.probabilities = probabilities;
  if (isRecord(raw.usage)) {
    const { input_tokens, output_tokens, cost } = raw.usage;
    if (isAmount(input_tokens) && isAmount(output_tokens)) reply.usage = { input_tokens, output_tokens, ...(isAmount(cost) && { cost }) };
  }
  return reply;
}

/** Asks a model. The call never rejects: a throw, a rejection and a reply the check refuses are failed calls. */
function ask(model: Model, state: unknown, questions: Record<string, Question>, askedTick: number, realTime: boolean, observation: unknown): Call {
  const abort = new AbortController();
  const settle = (outcome: Outcome): void => {
    if (call.outcome) return; // the first to settle wins: a give-up, the end of the match, or the model
    call.outcome = outcome;
    if (realTime) call.ms = Math.round(performance.now() - call.askedAt);
  };
  const call: Call = {
    askedTick,
    askedAt: realTime ? performance.now() : 0,
    observation,
    done: Promise.resolve(),
    fail(error) {
      abort.abort();
      settle({ error });
    },
  };
  call.done = (async () => {
    try {
      const reply = checkReply(questions, await model.ask({ state, questions, signal: abort.signal }));
      settle(Object.keys(reply.answers).length > 0 ? { reply } : { usage: reply.usage, error: "no valid answer" });
    } catch (error) {
      settle({ error: errorText(error) });
    }
  })();
  return call;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** What a throw says, cut to 200 characters. */
function errorText(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error).slice(0, 200) || "error";
  } catch {
    return "error";
  }
}
