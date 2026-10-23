// The match loop over any arena (DESIGN.md §5.2, §5.5, rows 31 and 39–40;
// rulings R22.a–e, i, j). R0.2 builds the skeleton; R0.4 adds the planner role,
// fatal errors and replay at the seams marked below. It generalizes the version-1
// loop (platform/core/src/sim/match.ts) and keeps its behaviour.
//
// Before anything runs, runMatch refuses (rejects) a match that cannot be
// played: 2 to 16 agents, each spec valid and written for this arena, a mode the
// arena has, a config that BaseConfigSchema and arena.config both accept, and
// every role's model resolved: `bot/<name>` through arena.bots, anything else
// through deps.models.
//
// Agents are `a<slot>`. spawn(config, ids, createRng(seed)) gives the world and
// its events, logged before Tick 0. Then, for each tick t = 1, 2, …:
//   1. (R0.4) planner replies that landed since the last tick, in slot order;
//   2. on actor-due ticks, (t − 1) % interval === 0 with the arena's
//      actorIntervalTicks or ACTOR_INTERVAL_TICKS, one call per active agent,
//      all at once, each raced against its timeout and the cancel signal (v1
//      rulings R12, R17), and their Calls in slot order. An answer checkAnswers
//      accepts becomes the agent's action through arena.actionFrom; a failure of
//      any kind leaves the action as it was (principle 5);
//   3. with minWallMsPerTick > 0, wait until that much wall time has passed
//      since the previous step;
//   4. step(state, every active agent's current action), its events, then Tick(t);
//   5. ended(state) not null: MatchEnd with its ranking and results, the end.
//      Still null at durationTicks: the arena has a bug, and runMatch rejects.
// Cancelling (deps.signal) ends the match after the tick in progress with
// MatchEnd { ranking: [] }: calls in flight are logged as aborted, the floor is
// not waited out.
//
// An actor's Call (R22.e) holds its answers and usage, or its error; never its
// questions or input, which the envelope and Tick.data rebuild (log size,
// ISSUES I-018). Its `model` is what the model calls itself when it answered,
// the agent's model id when the call failed. The log only ever holds what the
// loop built or a schema read, never an object a model or an arena still holds.
//
// Determinism (the v1 contract): the arena is pure and draws only from its
// seeded RNG; calls are asked and logged in slot order whatever order they
// settle in; wall time never reaches the log. Nothing here reads Math.random or
// Date, and performance.now only times the wall floor.

import * as z from "zod";
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
  /** Wall time a call gets before it is a timeout; ACTOR_TIMEOUT_MS for the actor when absent (the catalog's timeoutMs, R2). */
  timeoutMs?: (model: Model, role: Role) => number;
  /** Least wall time between two steps. Default 0, no floor (headless, R22.l); a browser runner passes TICK_MIN_WALL_MS. */
  minWallMsPerTick?: number;
  /** Cancels the match: it ends after the tick in progress with ranking []. */
  signal?: AbortSignal;
  /** Called after each Tick event, tick 0 included, with that tick and the state after it. */
  onTick?: (tick: number, state: State) => void;
  /** R0.4 (R22.g): called with the Call of a fatal model error before the match ends. Not called yet. */
  onFatal?: (call: CallEvent) => void;
}

/** One agent of the match, as the loop keeps it. */
interface Seat<Action> {
  id: AgentId;
  slot: number;
  spec: AgentSpec;
  actor: Model;
  /** Resolved with the others so an unknown id is refused up front; asked from R0.4. */
  planner: Model | undefined;
  /** Its actor is a `bot/<name>`: asked only the arena's questions, and it has no plan. */
  bot: boolean;
  /** What the actor reads as its plan; the planner rewrites it from R0.4. */
  memory: Memory;
  /** What it does every tick until its next answer; undefined before its first. */
  action: Action | undefined;
  /** The answers of its latest actor call, undefined after a failed one (R0.4 reads escalate here). */
  latest: Answers | undefined;
}

const BOT = "bot/";
const CANCELLED = "the match was cancelled";

/** Plays one match to its end, or until cancelled, and returns its log. */
export async function runMatch<T extends ArenaTypes>(
  arena: Arena<T>,
  config: T["Config"],
  agents: readonly AgentSpec[],
  deps: RunMatchDeps<T["State"]> = {},
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
  const resolve = (id: string, slot: number, role: Role) => modelFor(arena.bots, deps.models, id, slot, role, seed);
  const seats = Array.from(specs, (spec, slot): Seat<T["Action"]> => {
    const { actor, planner } = spec.roles;
    const bot = actor.model.startsWith(BOT);
    return {
      id: `a${slot}`,
      slot,
      spec,
      actor: resolve(actor.model, slot, "actor"),
      planner: planner ? resolve(planner.model, slot, "planner") : undefined,
      bot,
      memory: { plan: bot || planner ? "" : arena.defaults.fixedPlan, scratchpad: "" },
      action: undefined,
      latest: undefined,
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

  // (b) The world at tick 0.
  const spawned = arena.spawn(settings, Array.from(seats, (seat) => seat.id), createRng(seed));
  let state = spawned.state;
  logArenaEvents(spawned.events);
  events.push({ kind: "Tick", tick: 0, data: arena.tick(state) });
  onTick?.(0, state);

  const interval = arena.actorIntervalTicks ?? ACTOR_INTERVAL_TICKS;
  const minWallMs = deps.minWallMsPerTick ?? 0;
  let steppedAt = minWallMs > 0 ? performance.now() : 0; // wall clock of the last step (spawn, for tick 1)
  let tick = 0;
  for (;;) {
    if (signal?.aborted) {
      events.push(matchEnd(tick, { ranking: [] }));
      break;
    }
    const t = tick + 1;
    const active = arena.active(state);
    const live = seats.filter((seat) => active.includes(seat.id));

    // (1) Planner replies that landed since the last tick, in slot order: R0.4.

    // (2) The actor, on due ticks: everyone at once, logged in slot order.
    if ((t - 1) % interval === 0) {
      const world = state;
      const asked = Array.from(live, (seat) => {
        const obs = arena.perceive(world, seat.id);
        const questions = actorQuestions(arena.questions(obs, seat.memory), seat);
        const timeoutMs = deps.timeoutMs?.(seat.actor, "actor") ?? ACTOR_TIMEOUT_MS;
        const request = { state: { observation: obs, plan: seat.memory.plan }, questions };
        return { seat, obs, reply: call(seat.actor, request, timeoutMs, signal) };
      });
      const replies = await Promise.all(Array.from(asked, (entry) => entry.reply));
      asked.forEach(({ seat, obs }, i) => {
        const reply = replies[i]!;
        events.push(actorCall(t, seat, reply));
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
      events.push(matchEnd(tick, outcome));
      break;
    }
    if (tick >= durationTicks) throw new Error(`${arena.id}: ended() is still null at durationTicks (${durationTicks})`);
    if (signal?.aborted) {
      events.push(matchEnd(tick, { ranking: [] }));
      break;
    }
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

/** The model behind an id: `bot/<name>` from the arena's bots, others from the caller's resolver; refused when there is none. */
function modelFor(bots: Arena["bots"], models: RunMatchDeps["models"], id: string, slot: number, role: Role, seed: number): Model {
  let model: Model | undefined;
  if (id.startsWith(BOT)) {
    const name = id.slice(BOT.length);
    const make = Object.hasOwn(bots, name) ? bots[name] : undefined;
    model = make?.(seed, slot);
  } else {
    model = models?.(id, { slot, role, seed });
  }
  if (!model) throw new Error(`agents[${slot}] ${role}: unknown model "${id}"`);
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

/** The Call event of an actor call at `tick` (R22.e). */
function actorCall(tick: number, seat: Seat<unknown>, reply: Reply): CallEvent {
  const head = { kind: "Call", tick, requestedTick: tick, agent: seat.id, role: "actor" } as const;
  return reply.ok
    ? { ...head, model: reply.model, ok: true, answers: reply.answers, usage: reply.usage }
    : { ...head, model: seat.spec.roles.actor.model, ok: false, error: reply.error };
}

function matchEnd(tick: number, outcome: MatchOutcome): MatchEndEvent {
  const ranking = [...outcome.ranking];
  return outcome.results === undefined ? { kind: "MatchEnd", tick, ranking } : { kind: "MatchEnd", tick, ranking, results: { ...outcome.results } };
}

/**
 * One call raced against its timeout and the match's cancel signal. Never
 * rejects: a timeout, a cancel, a rejection, a throw or a reply that does not
 * hold up is a failed Reply. The model gets the call's own signal (R17), aborted
 * at the timeout or whenever the match is cancelled (AbortSignal.any holds its
 * sources weakly, so answered calls cost nothing).
 */
function call(model: Model, request: Omit<AskRequest, "signal">, timeoutMs: number, signal: AbortSignal | undefined): Promise<Reply> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(failure("aborted", CANCELLED));
    const own = new AbortController();
    const settle = (reply: Reply) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCancel);
      resolve(reply); // the first settle wins; later ones change nothing
    };
    const onCancel = () => settle(failure("aborted", CANCELLED));
    const timer = setTimeout(() => {
      const message = `no answer within ${timeoutMs} ms`;
      settle(failure("timeout", message));
      own.abort(new DOMException(message, "TimeoutError"));
    }, timeoutMs);
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
  });
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
