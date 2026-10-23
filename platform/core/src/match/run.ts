// The match loop over any arena (DESIGN.md §5.2, §5.5, rows 29, 31 and 39–40;
// ruling R22). It generalizes the version-1 loop (kits/shooter/src/legacy/match.ts)
// and keeps its behaviour: the battle royale arena's log equals the version-1
// one apart from the envelope (the parity test, R25).
//
// Before anything runs, runMatch refuses (rejects) a match that cannot be
// played: 2 to 16 agents, each spec valid and written for this arena, a mode the
// arena has, a config that BaseConfigSchema and arena.config both accept, and
// every role's model resolved: `bot/<name>` through arena.bots, anything else
// through deps.models.
//
// Agents are `a<slot>`. spawn(config, ids, createRng(seed)) gives the world and
// its events, logged before Tick 0. Then, for each tick t = 1, 2, …:
//   1. the planner (agents whose spec has one, R22.f). Replies that settled since
//      the last tick land now, in slot order, as Call { tick: t, requestedTick }
//      (the loop first lets pending promise callbacks run, so a reply that settled
//      just before is seen); an ok reply becomes the agent's memory, a failure
//      leaves it. Then each active agent with no call in flight is asked: first at
//      tick 1, later when its latest actor reply escalated (≥ ESCALATE_THRESHOLD)
//      and PLANNER_MIN_GAP_TICKS have passed since its last request, or when
//      PLANNER_MAX_GAP_TICKS have. A planner call never holds a tick: it runs
//      while the match plays on, until its own timeout (PLANNER_TIMEOUT_MS);
//   2. on actor-due ticks, (t − 1) % interval === 0 with the arena's
//      actorIntervalTicks or ACTOR_INTERVAL_TICKS, one call per active agent,
//      all at once, each raced against its timeout and the cancel signal (v1
//      rulings R12, R17), and their Calls in slot order. An answer checkAnswers
//      accepts becomes the agent's action through arena.actionFrom; a failure of
//      any kind leaves the action as it was (principle 5);
//   3. with minWallMsPerTick > 0, wait until that much wall time has passed
//      since the previous step;
//   4. step(state, every active agent's current action), its events, then Tick(t);
//   5. the end: ended(state) not null gives MatchEnd with its ranking and results;
//      still null at durationTicks, the arena has a bug and runMatch rejects; a
//      fatal reply during the tick (R22.g) or a cancel (deps.signal) gives
//      MatchEnd { ranking: [] }, in that order of precedence.
// When the match ends, planner calls still in flight are cut short (their signal
// aborted) and logged as aborted after the last Tick, before MatchEnd, in slot
// order ("the match was cancelled" after a cancel, "the match ended" otherwise),
// so every call is in the log (principle 4). Cancelling also logs the actor's
// calls in flight as aborted and skips the wall floor. A fatal reply calls
// deps.onFatal with its Call (the first one only), and no planner is asked after it.
//
// The Call events (R22.e): the actor's hold its answers and usage, or its error,
// never its questions or input, which the envelope and Tick.data rebuild (log
// size, ISSUES I-018); the planner's also hold its input (static text,
// observation text, memory, tick). `model` is what the model calls itself when it
// answered, the agent's model id when the call failed. The log only ever holds
// what the loop built or a schema read, never an object a model or an arena
// still holds.
//
// Determinism (the v1 contract, R22.h): the arena is pure and draws only from
// its seeded RNG; calls are asked and logged in slot order whatever order they
// settle in; wall time never reaches the log: what a clock decided (a timeout, the
// tick a planner reply landed on) is in the log, and replayMatch (replay.ts) plays
// it back. Nothing here reads Math.random or Date, and performance.now only times
// the wall floor.

import * as z from "zod";
import { ESCALATE_THRESHOLD, TICK_MS } from "../constants";
import {
  ACTOR_INTERVAL_TICKS,
  ACTOR_TIMEOUT_MS,
  AgentSpecSchema,
  BaseConfigSchema,
  checkAnswers,
  ESCALATE_QUESTION,
  MAX_AGENTS,
  MIN_AGENTS,
  modelError,
  ModelErrorSchema,
  PLAN_QUESTIONS,
  PLANNER_MAX_GAP_TICKS,
  PLANNER_MIN_GAP_TICKS,
  PLANNER_TIMEOUT_MS,
  PLATFORM_EVENT_KINDS,
  UsageSchema,
  type AgentId,
  type AgentSpec,
  type Answers,
  type Arena,
  type ArenaTypes,
  type AskRequest,
  type CallEvent,
  type EventFor,
  type MatchEndEvent,
  type MatchLogFor,
  type MatchOutcome,
  type Memory,
  type Model,
  type ModelErrorKind,
  type Questions,
  type Reply,
  type Role,
} from "../contracts";
import { createRng } from "../rng";

export interface RunMatchDeps<State = unknown> {
  /** The match's mode; the arena's first when absent. */
  mode?: string;
  /** Resolves a model id that is not `bot/<name>`; undefined means unknown, and the match is refused. */
  models?: (id: string, ctx: { slot: number; role: Role; seed: number }) => Model | undefined;
  /**
   * Wall time a call gets before it is a timeout (the catalog's timeoutMs, R2);
   * ACTOR_TIMEOUT_MS for the actor and PLANNER_TIMEOUT_MS for the planner when
   * absent. Infinity: no timeout.
   */
  timeoutMs?: (model: Model, role: Role) => number;
  /** Least wall time between two steps. Default 0, no floor (headless, R22.l); a runner that plays in real time passes tickMsOf(arena). */
  minWallMsPerTick?: number;
  /** Cancels the match: it ends after the tick in progress with ranking []. */
  signal?: AbortSignal;
  /** Called after each Tick event, tick 0 included, with that tick and the state after it. */
  onTick?: (tick: number, state: State) => void;
  /** Called with the Call of the first fatal model error (R22.g), before the match ends. */
  onFatal?: (call: CallEvent) => void;
}

/** The model of `id` in one role of one slot, or a throw that refuses the match. */
export type ResolveModel = (id: string, ctx: { slot: number; role: Role; seed: number }) => Model;

/** What the planner is given (R22.f), logged as its Call's input. */
interface PlannerInput {
  static: string;
  observation: string;
  memory: Memory;
  tick: number;
}

/** A planner call between its request and its landing. */
interface PlannerCall {
  requestedTick: number;
  input: PlannerInput;
  asked: Asked;
}

/** One agent of the match, as the loop keeps it. */
interface Seat<Action> {
  id: AgentId;
  slot: number;
  spec: AgentSpec;
  actor: Model;
  planner: Model | undefined;
  /** Its actor is a `bot/<name>`: asked only the arena's questions, and it has no plan. */
  bot: boolean;
  /** What the actor reads as its plan, and what the planner rewrites (principle 6). */
  memory: Memory;
  /** What it does every tick until its next answer; undefined before its first. */
  action: Action | undefined;
  /** The answers of its latest actor call, undefined after a failed one: where its escalate is read. */
  latest: Answers | undefined;
  /** The tick of its latest planner request; undefined before the first. */
  lastRequest: number | undefined;
  /** Its planner call in flight (or settled and not yet landed). */
  pending: PlannerCall | undefined;
}

const BOT = "bot/";
const CANCELLED = "the match was cancelled";
const ENDED = "the match ended";
/**
 * Promise turns the loop lets pass at the start of a tick while a planner call is
 * open, so a reply that settled during the previous tick is seen now. A model
 * that answers at once (a dummy, a replaying model) settles within a few turns;
 * a reply that needs more lands a tick later, which the log records.
 */
const SETTLE_TURNS = 8;

/** Ticks between an arena's actor decisions: its actorIntervalTicks, else the platform's ACTOR_INTERVAL_TICKS. */
export function actorIntervalOf(arena: Pick<Arena, "actorIntervalTicks">): number {
  return arena.actorIntervalTicks ?? ACTOR_INTERVAL_TICKS;
}

/** Wall time of one of an arena's ticks, for a runner that plays it in real time: its tickMs, else the platform's TICK_MS. */
export function tickMsOf(arena: Pick<Arena, "tickMs">): number {
  return arena.tickMs ?? TICK_MS;
}

/** Plays one match to its end, or until cancelled, and returns its log. */
export function runMatch<T extends ArenaTypes>(
  arena: Arena<T>,
  config: T["Config"],
  agents: readonly AgentSpec[],
  deps: RunMatchDeps<T["State"]> = {},
): Promise<MatchLogFor<T>> {
  return playMatch(arena, config, agents, deps, (id, ctx) => modelFor(arena.bots, deps.models, id, ctx));
}

/** runMatch with every role's model from `resolve` (replayMatch's replaying models); deps.models is not read. */
export async function playMatch<T extends ArenaTypes>(
  arena: Arena<T>,
  config: unknown,
  agents: readonly unknown[],
  deps: RunMatchDeps<T["State"]>,
  resolve: ResolveModel,
): Promise<MatchLogFor<T>> {
  const { signal, onTick } = deps;

  // (a) Refuse a match that cannot be played, before anything runs.
  if (agents.length < MIN_AGENTS || agents.length > MAX_AGENTS) {
    throw new RangeError(`a match takes ${MIN_AGENTS} to ${MAX_AGENTS} agents, not ${agents.length}`);
  }
  const specs = Array.from(agents, (agent, slot) => specFor(agent, slot, arena.id));
  const mode = deps.mode ?? arena.modes[0] ?? "";
  if (!arena.modes.includes(mode)) throw new Error(`mode "${mode}" is not one of ${arena.id}'s modes (${arena.modes.join(", ")})`);
  const { seed, durationTicks } = configFor(BaseConfigSchema, config);
  const settings = configFor(arena.config, config);
  const seats = Array.from(specs, (spec, slot): Seat<T["Action"]> => {
    const { actor, planner } = spec.roles;
    const bot = actor.model.startsWith(BOT);
    return {
      id: `a${slot}`,
      slot,
      spec,
      actor: resolve(actor.model, { slot, role: "actor", seed }),
      planner: planner ? resolve(planner.model, { slot, role: "planner", seed }) : undefined,
      bot,
      memory: { plan: bot || planner ? "" : arena.defaults.fixedPlan, scratchpad: "" },
      action: undefined,
      latest: undefined,
      lastRequest: undefined,
      pending: undefined,
    };
  });

  const events: EventFor<T>[] = [];
  const logArenaEvents = (batch: readonly T["Event"][]) => {
    for (const event of batch) {
      if (typeof event.kind !== "string" || event.kind === "" || (PLATFORM_EVENT_KINDS as readonly string[]).includes(event.kind)) {
        throw new RangeError(`${arena.id} emitted an event of kind ${JSON.stringify(event.kind)}: not an arena kind`);
      }
      if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick > durationTicks) {
        throw new RangeError(`${arena.id} emitted a ${event.kind} event at tick ${event.tick}: a log's ticks are integers in 0..${durationTicks}`);
      }
      events.push(event);
    }
  };
  let fatal: CallEvent | undefined;
  const logCall = (call: CallEvent) => {
    events.push(call);
    if (call.error?.fatal && fatal === undefined) {
      fatal = call;
      deps.onFatal?.(call);
    }
  };
  /** MatchEnd, after the planner calls still in flight, cut short and logged (principle 4). */
  const end = (tick: number, outcome: MatchOutcome, cancelled: boolean) => {
    const message = cancelled ? CANCELLED : ENDED;
    for (const seat of seats) {
      const pending = seat.pending;
      if (!pending) continue;
      seat.pending = undefined;
      pending.asked.stop(message);
      logCall(plannerCall(tick, seat, pending, failure("aborted", message)));
    }
    events.push(matchEnd(tick, outcome));
  };

  let staticText: string | undefined; // the arena's text for this config, made at the first planner request
  const askPlanner = (seat: Seat<T["Action"]>, planner: Model, t: number, world: T["State"]): PlannerCall => {
    staticText ??= arena.staticText(settings);
    const input: PlannerInput = {
      static: staticText,
      observation: arena.observationText(arena.perceive(world, seat.id)),
      memory: { ...seat.memory },
      tick: t,
    };
    const prompt = seat.spec.prompts.planner;
    const system = prompt.trim() === "" ? arena.defaults.planner : prompt;
    const timeoutMs = deps.timeoutMs?.(planner, "planner") ?? PLANNER_TIMEOUT_MS;
    seat.lastRequest = t;
    // The model gets its own copy of the input: what it does with it never reaches the log.
    const state = { ...input, memory: { ...input.memory } };
    return { requestedTick: t, input, asked: ask(planner, { system, state, questions: PLAN_QUESTIONS }, timeoutMs, signal) };
  };

  try {
    // (b) The world at tick 0.
    const spawned = arena.spawn(settings, Array.from(seats, (seat) => seat.id), createRng(seed));
    let state = spawned.state;
    logArenaEvents(spawned.events);
    events.push({ kind: "Tick", tick: 0, data: arena.tick(state) });
    onTick?.(0, state);

    const interval = actorIntervalOf(arena);
    const minWallMs = deps.minWallMsPerTick ?? 0;
    let steppedAt = minWallMs > 0 ? performance.now() : 0; // wall clock of the last step (spawn, for tick 1)
    let tick = 0;
    for (;;) {
      if (signal?.aborted) {
        end(tick, { ranking: [] }, true);
        break;
      }
      const t = tick + 1;

      // (1) The planner: replies that settled land, in slot order; then new requests.
      for (let turn = 0; turn < SETTLE_TURNS && seats.some(waitingOnPlanner); turn++) await Promise.resolve();
      for (const seat of seats) {
        const pending = seat.pending;
        const reply = pending?.asked.settled;
        if (!pending || !reply) continue;
        seat.pending = undefined;
        logCall(plannerCall(t, seat, pending, reply));
        if (reply.ok) seat.memory = memoryFrom(reply.answers, seat.memory);
      }
      const active = arena.active(state);
      const live = seats.filter((seat) => active.includes(seat.id));
      if (fatal === undefined) {
        // After a cancel, a request settles at once as aborted, as the actor's calls do: the log says so, and a replay asks the same.
        for (const seat of live) {
          if (seat.planner && plannerDue(seat, t)) seat.pending = askPlanner(seat, seat.planner, t, state);
        }
      }

      // (2) The actor, on due ticks: everyone at once, logged in slot order.
      if ((t - 1) % interval === 0) {
        const world = state;
        const asked = Array.from(live, (seat) => {
          const obs = arena.perceive(world, seat.id);
          const questions = actorQuestions(arena.questions(obs, seat.memory), seat);
          const timeoutMs = deps.timeoutMs?.(seat.actor, "actor") ?? ACTOR_TIMEOUT_MS;
          const request = { state: { observation: obs, plan: seat.memory.plan }, questions };
          return { seat, obs, reply: ask(seat.actor, request, timeoutMs, signal).reply };
        });
        const replies = await Promise.all(Array.from(asked, (entry) => entry.reply));
        asked.forEach(({ seat, obs }, i) => {
          const reply = replies[i]!;
          logCall(actorCall(t, seat, reply));
          seat.latest = reply.ok ? reply.answers : undefined;
          if (reply.ok) seat.action = arena.actionFrom(reply.answers, obs, seat.action);
        });
      }

      // (3) The wall floor.
      if (minWallMs > 0) {
        await waitUntil(steppedAt + minWallMs, signal);
        steppedAt = performance.now();
      }

      // (4) The step, with every active agent's current action.
      const actions: Record<AgentId, T["Action"]> = {};
      for (const seat of live) if (seat.action !== undefined) actions[seat.id] = seat.action;
      const next = arena.step(state, actions);
      state = next.state;
      tick = t;
      logArenaEvents(next.events);
      events.push({ kind: "Tick", tick, data: arena.tick(state) });
      onTick?.(tick, state);

      // (5) The end.
      const outcome = arena.ended(state);
      if (outcome) {
        end(tick, outcome, false);
        break;
      }
      if (tick >= durationTicks) throw new Error(`${arena.id}: ended() is still null at durationTicks (${durationTicks})`);
      if (fatal !== undefined) {
        end(tick, { ranking: [] }, false);
        break;
      }
      if (signal?.aborted) {
        end(tick, { ranking: [] }, true);
        break;
      }
    }
  } finally {
    // A match that rejects leaves no call running: their timers and requests stop here.
    for (const seat of seats) seat.pending?.asked.stop(ENDED);
  }
  return { version: 2, arena: arena.id, mode, config: settings, agents: specs, events };
}

/** A spec as AgentSpecSchema reads it, refused when it does not parse or names another arena. */
function specFor(agent: unknown, slot: number, arenaId: string): AgentSpec {
  const parsed = AgentSpecSchema.safeParse(agent);
  if (!parsed.success) throw new Error(`agents[${slot}] is not an agent spec: ${issueText(parsed.error, "spec")}`);
  if (parsed.data.arena !== arenaId) throw new Error(`agents[${slot}] is written for "${parsed.data.arena}", not "${arenaId}"`);
  return parsed.data;
}

/** The config as `schema` reads it, refused when it does not parse. */
function configFor<C>(schema: z.ZodType<C>, config: unknown): C {
  const parsed = schema.safeParse(config);
  if (!parsed.success) throw new Error(`config: ${issueText(parsed.error, "config")}`);
  return parsed.data;
}

/** The model behind an id (R22.j): `bot/<name>` from the arena's bots, others from the caller's resolver; refused when there is none. */
function modelFor(bots: Arena["bots"], models: RunMatchDeps["models"], id: string, ctx: { slot: number; role: Role; seed: number }): Model {
  let model: Model | undefined;
  if (id.startsWith(BOT)) {
    const name = id.slice(BOT.length);
    const make = Object.hasOwn(bots, name) ? bots[name] : undefined;
    model = make?.(ctx.seed, ctx.slot);
  } else {
    model = models?.(id, ctx);
  }
  if (!model) throw new Error(`agents[${ctx.slot}] ${ctx.role}: unknown model "${id}"`);
  return model;
}

/**
 * The arena's questions with the agent's own instruction where it wrote one that
 * is not blank, and, for anyone but a bot, the platform's escalate question
 * (bots never escalate: a ruling for parity with v1).
 */
function actorQuestions(questions: Questions, seat: Seat<unknown>): Questions {
  const own = seat.spec.prompts.actor;
  const asked: Questions = {};
  for (const [id, question] of Object.entries(questions)) {
    const instructions = Object.hasOwn(own, id) ? own[id] : undefined;
    asked[id] = instructions !== undefined && instructions.trim() !== "" ? { ...question, instructions } : question;
  }
  if (!seat.bot) asked.escalate = ESCALATE_QUESTION;
  return asked;
}

/** Whether the seat's planner call is still out: asked, not settled. */
function waitingOnPlanner(seat: Seat<unknown>): boolean {
  return seat.pending !== undefined && seat.pending.asked.settled === undefined;
}

/**
 * Whether an active seat's planner is asked at the start of tick t (R22.f): never
 * while one call is in flight; first whenever it has never been asked (tick 1);
 * then when its latest actor reply escalated and PLANNER_MIN_GAP_TICKS have passed
 * since the last request, or when PLANNER_MAX_GAP_TICKS have.
 */
function plannerDue(seat: Seat<unknown>, t: number): boolean {
  if (seat.pending) return false;
  if (seat.lastRequest === undefined) return true;
  const gap = t - seat.lastRequest;
  const escalate = seat.latest?.escalate;
  const escalated = escalate?.type === "noul" && escalate.noul >= ESCALATE_THRESHOLD;
  return (escalated && gap >= PLANNER_MIN_GAP_TICKS) || gap >= PLANNER_MAX_GAP_TICKS;
}

/** The memory after an ok planner reply: its plan and scratchpad; a part it did not answer stays as it was. */
function memoryFrom(answers: Answers, memory: Memory): Memory {
  const { plan, scratchpad } = answers;
  return {
    plan: plan?.type === "text" ? plan.text : memory.plan,
    scratchpad: scratchpad?.type === "text" ? scratchpad.text : memory.scratchpad,
  };
}

/** The Call event of an actor call at `tick` (R22.e). */
function actorCall(tick: number, seat: Seat<unknown>, reply: Reply): CallEvent {
  const head = { kind: "Call", tick, requestedTick: tick, agent: seat.id, role: "actor" } as const;
  return reply.ok
    ? { ...head, model: reply.model, ok: true, answers: reply.answers, usage: reply.usage }
    : { ...head, model: seat.spec.roles.actor.model, ok: false, error: reply.error };
}

/** The Call event of a planner call landing at `tick` (R22.e): its input as well. */
function plannerCall(tick: number, seat: Seat<unknown>, call: PlannerCall, reply: Reply): CallEvent {
  const head = { kind: "Call", tick, requestedTick: call.requestedTick, agent: seat.id, role: "planner" } as const;
  return reply.ok
    ? { ...head, model: reply.model, ok: true, answers: reply.answers, usage: reply.usage, input: call.input }
    : { ...head, model: seat.spec.roles.planner?.model ?? seat.spec.roles.actor.model, ok: false, error: reply.error, input: call.input };
}

function matchEnd(tick: number, outcome: MatchOutcome): MatchEndEvent {
  const ranking = [...outcome.ranking];
  return outcome.results === undefined ? { kind: "MatchEnd", tick, ranking } : { kind: "MatchEnd", tick, ranking, results: { ...outcome.results } };
}

/** One call in flight: its reply once it settles, readable at once through `settled`. */
interface Asked {
  readonly reply: Promise<Reply>;
  /** The reply, from the moment it settles. */
  settled: Reply | undefined;
  /** Settles the call as aborted with `message` (unless it already settled) and aborts its signal. */
  stop(message: string): void;
}

/**
 * One call raced against its timeout and the match's cancel signal. Never
 * rejects: a timeout, a cancel, a stop, a rejection, a throw or a reply that does
 * not hold up is a failed Reply; the first to come settles it. The model gets the
 * call's own signal (R17), aborted at the timeout, by stop() and whenever the
 * match is cancelled (AbortSignal.any holds its sources weakly, so answered calls
 * cost nothing).
 */
function ask(model: Model, request: Omit<AskRequest, "signal">, timeoutMs: number, signal: AbortSignal | undefined): Asked {
  const own = new AbortController();
  let resolve: (reply: Reply) => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (reply: Reply) => {
    if (asked.settled) return; // the first settle wins; later ones change nothing
    asked.settled = reply;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCancel);
    resolve(reply);
  };
  const onCancel = () => settle(failure("aborted", CANCELLED));
  const asked: Asked = {
    reply: new Promise<Reply>((settled) => (resolve = settled)),
    settled: undefined,
    stop(message) {
      settle(failure("aborted", message));
      own.abort(new DOMException(message, "AbortError"));
    },
  };
  if (signal?.aborted) {
    settle(failure("aborted", CANCELLED));
    return asked;
  }
  if (Number.isFinite(timeoutMs)) {
    timer = setTimeout(() => {
      const message = `no answer within ${timeoutMs} ms`;
      settle(failure("timeout", message));
      own.abort(new DOMException(message, "TimeoutError"));
    }, timeoutMs);
  }
  signal?.addEventListener("abort", onCancel, { once: true });
  try {
    const callSignal = signal ? AbortSignal.any([own.signal, signal]) : own.signal;
    Promise.resolve(model.ask({ ...request, signal: callSignal })).then(
      (reply: unknown) => settle(checkedReply(reply, request.questions)),
      (error: unknown) => settle(failure("invalid_output", `ask failed: ${errorText(error)}`)),
    );
  } catch (error) {
    settle(failure("invalid_output", `ask failed: ${errorText(error)}`));
  }
  return asked;
}

/** What a model may send back: answers with usage and its name, or an error (R21.b). Answers are checkAnswers' business. */
const ReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), answers: z.unknown().optional(), usage: UsageSchema, model: z.string().min(1) }),
  z.object({ ok: z.literal(false), error: ModelErrorSchema }),
]);

/** A reply as the schemas read it, its answers checked against the questions; anything that does not hold up is invalid_output. */
function checkedReply(reply: unknown, questions: Questions): Reply {
  const parsed = ReplySchema.safeParse(reply);
  if (!parsed.success) return failure("invalid_output", `invalid reply: ${issueText(parsed.error, "reply")}`);
  if (!parsed.data.ok) return parsed.data;
  const checked = checkAnswers(questions, parsed.data.answers);
  if (!checked.ok) return failure("invalid_output", checked.error);
  return { ok: true, answers: checked.answers, usage: parsed.data.usage, model: parsed.data.model };
}

function failure(kind: ModelErrorKind, message: string): Reply {
  return { ok: false, error: modelError(kind, message) };
}

/** A zod error's first issue as "path: message", the path dotted, or `whole` for the whole value. */
function issueText(error: z.ZodError, whole: string): string {
  const issue = error.issues[0];
  if (!issue) return "rejected";
  return `${issue.path.length > 0 ? issue.path.join(".") : whole}: ${issue.message}`;
}

/** What a rejection or a throw says: the Error's message (its name when empty), else String(value). */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text || "no reason given";
}

/** Waits until performance.now() reaches `until`, or the signal aborts. Timers can fire a little early, so it checks the clock again. */
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
