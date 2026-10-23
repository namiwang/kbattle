import { describe, expect, it, vi } from "vitest";
import {
  ACTOR_TIMEOUT_MS,
  botSpec,
  callsOf,
  ESCALATE_QUESTION,
  eventsOfKind,
  modelError,
  parseMatchLogFor,
  QUESTION_TYPES,
  type AgentSpec,
  type Arena,
  type AskRequest,
  type Model,
  type Reply,
} from "../../src/contracts";
import { runMatch } from "../../src/match";
import { createRng } from "../../src/sim/rng";
import { counterConfig, fakeArena, stepAnswer, type CounterTypes, type Direction, type StepEvent } from "../fake-arena";

// The generic match loop, skeleton (DESIGN.md §5.2, §5.5, rows 39–40; rulings
// R22.a–e, i, j): validation, spawn and Tick 0, actor calls on due ticks raced
// against their timeout and the cancel signal, checked answers, actions, the
// Call logging policy, step, Tick, the arena's ending, cancel. The planner role
// and replay come in R0.4.

const USAGE = { inputTokens: 10, outputTokens: 2 };
const SUPPORTS = new Set(QUESTION_TYPES);

/** A test model whose n-th call (from 0) gets script(req, n); every request lands in `seen`. */
function scripted(id: string, script: (req: AskRequest, n: number) => Reply | Promise<Reply>, seen: AskRequest[] = []): Model {
  let n = 0;
  return {
    id,
    supports: SUPPORTS,
    ask: async (req) => {
      seen.push(req);
      return script(req, n++);
    },
  };
}

/** A reply choosing `choice`, from a model that calls itself `name`. */
const answered = (name: string, choice: Direction): Reply => ({ ok: true, answers: stepAnswer(choice), usage: USAGE, model: name });
/** A model that always answers `choice`. */
const always = (id: string, choice: Direction) => scripted(id, () => answered(id, choice));
/** A reply that never comes. */
const never = () => new Promise<Reply>(() => {});

/** An agent of the counters arena whose actor is `model`. */
const player = (model: string, over: Partial<AgentSpec> = {}): AgentSpec => ({
  arena: "counters",
  roles: { actor: { model } },
  prompts: { planner: "", actor: {} },
  ...over,
});
const upper = botSpec("counters", "upper");

/** deps.models over a list of models, by id. */
const resolver = (...models: Model[]) => (id: string) => models.find((model) => model.id === id);

const okCall = (tick: number, agent: string, model: string, choice: Direction) => ({
  kind: "Call",
  tick,
  requestedTick: tick,
  agent,
  role: "actor",
  model,
  ok: true,
  answers: stepAnswer(choice),
  usage: USAGE,
});
const failedCall = (tick: number, agent: string, model: string, error: object) => ({
  kind: "Call",
  tick,
  requestedTick: tick,
  agent,
  role: "actor",
  model,
  ok: false,
  error,
});
const step = (tick: number, agent: string, delta: 1 | -1) => ({ kind: "Step", tick, agent, delta });
const tickOf = (tick: number, a0: number, a1: number) => ({ kind: "Tick", tick, data: { a0, a1 } });

/** [kind, tick] per event, with the agent when it has one. */
const outline = (events: readonly { kind: string; tick: number; agent?: unknown }[]) =>
  events.map((event) => (event.agent === undefined ? [event.kind, event.tick] : [event.kind, event.tick, event.agent]));

describe("runMatch: a match to its end (R22.b, c)", () => {
  it("plays two bots up to +5: Tick 0, actor calls on due ticks, steps and Ticks, then MatchEnd with the results", async () => {
    const log = await runMatch(fakeArena, counterConfig(), [upper, upper]);
    expect(outline(log.events)).toEqual([
      ["Tick", 0],
      ["Call", 1, "a0"],
      ["Call", 1, "a1"],
      ["Step", 1, "a0"],
      ["Step", 1, "a1"],
      ["Tick", 1],
      ["Step", 2, "a0"],
      ["Step", 2, "a1"],
      ["Tick", 2],
      ["Call", 3, "a0"],
      ["Call", 3, "a1"],
      ["Step", 3, "a0"],
      ["Step", 3, "a1"],
      ["Tick", 3],
      ["Step", 4, "a0"],
      ["Step", 4, "a1"],
      ["Tick", 4],
      ["Call", 5, "a0"],
      ["Call", 5, "a1"],
      ["Step", 5, "a0"],
      ["Step", 5, "a1"],
      ["Tick", 5],
      ["MatchEnd", 5],
    ]);
    expect(log.events.at(-2)).toEqual(tickOf(5, 5, 5));
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 5, ranking: ["a0", "a1"], results: { a0: 5, a1: 5 } });
  });

  it("stops asking an agent that left, and ends at durationTicks ranked by counter with the counters as results", async () => {
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 12 }), [upper, player("dummy/down")], {
      models: resolver(always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0").map((call) => call.tick)).toEqual([1, 3, 5]);
    expect(callsOf(log, "a1").map((call) => call.tick)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(eventsOfKind(log, "Step").filter((event) => event.agent === "a0").map((event) => event.tick)).toEqual([1, 2, 3, 4, 5]);
    expect(log.events.at(-2)).toEqual(tickOf(12, 5, -12));
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 12, ranking: ["a0", "a1"], results: { a0: 5, a1: -12 } });
  });

  it("writes a log its arena parses as it is, faults included (parseMatchLogFor)", async () => {
    const hang = scripted("dummy/hang", (_req, n) => (n === 0 ? answered("dummy/hang", "up") : never()));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 12 }), [player("dummy/hang"), upper], {
      models: resolver(hang),
      timeoutMs: () => 5,
    });
    expect(eventsOfKind(log, "Call").some((call) => !call.ok)).toBe(true);
    expect(parseMatchLogFor(fakeArena, JSON.parse(JSON.stringify(log)))).toEqual(log);
  });
});

describe("runMatch: the actor's cadence (R22.c)", () => {
  it("asks every active agent on ticks 1, 3, 5, … under actorIntervalTicks 2, and on no other tick", async () => {
    const down = always("dummy/down", "down");
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 8 }), [player("dummy/down"), player("dummy/down")], {
      models: resolver(down),
    });
    expect(outline(eventsOfKind(log, "Call"))).toEqual([
      ["Call", 1, "a0"],
      ["Call", 1, "a1"],
      ["Call", 3, "a0"],
      ["Call", 3, "a1"],
      ["Call", 5, "a0"],
      ["Call", 5, "a1"],
      ["Call", 7, "a0"],
      ["Call", 7, "a1"],
    ]);
  });

  it("asks on ticks 1, 11, 21, … when the arena sets no interval (ACTOR_INTERVAL_TICKS)", async () => {
    const arena: Arena<CounterTypes> = { ...fakeArena, actorIntervalTicks: undefined };
    const log = await runMatch(arena, counterConfig({ durationTicks: 25 }), [player("dummy/down"), player("dummy/down")], {
      models: resolver(always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0").map((call) => call.tick)).toEqual([1, 11, 21]);
  });

  it("asks all agents at once and logs their calls in slot order, whatever order the answers come in", async () => {
    const order: string[] = [];
    const slow = scripted("dummy/slow", async () => {
      order.push("a0 asked");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("a0 answered");
      return answered("dummy/slow", "up");
    });
    const quick = scripted("dummy/quick", () => {
      order.push("a1 asked");
      return answered("dummy/quick", "down");
    });
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [player("dummy/slow"), player("dummy/quick")], {
      models: resolver(slow, quick),
    });
    expect(order).toEqual(["a0 asked", "a1 asked", "a0 answered"]);
    expect(outline(eventsOfKind(log, "Call"))).toEqual([
      ["Call", 1, "a0"],
      ["Call", 1, "a1"],
    ]);
  });
});

describe("runMatch: what the actor is asked (R22.d)", () => {
  it("asks the arena's questions with the player's instruction where it is not blank, plus the platform's escalate", async () => {
    const seen: AskRequest[] = [];
    const spy = scripted("dummy/spy", () => answered("dummy/spy", "up"), seen);
    const own = player("dummy/spy", { prompts: { planner: "", actor: { step: "Climb now." } } });
    const blank = player("dummy/spy", { prompts: { planner: "", actor: { step: "   " } } });
    await runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [own, blank], { models: resolver(spy) });
    const criteria = { up: "Add one to your counter.", down: "Take one from your counter." };
    expect(seen[0]?.questions).toEqual({ step: { type: "choice", instructions: "Climb now.", criteria }, escalate: ESCALATE_QUESTION });
    expect(seen[1]?.questions).toEqual({
      step: { type: "choice", instructions: "Go up unless the plan says otherwise.", criteria },
      escalate: ESCALATE_QUESTION,
    });
    expect(Object.keys(seen[0]?.questions ?? {})).toEqual(["step", "escalate"]);
  });

  it("asks a bot only the arena's questions, and drops the escalate answer it gives anyway", async () => {
    const seen: AskRequest[] = [];
    const bot = scripted("bot/upper", () => ({ ...answered("bot/upper", "up"), answers: { ...stepAnswer("up"), escalate: { type: "noul", noul: 0 } } }), seen);
    const arena: Arena<CounterTypes> = { ...fakeArena, bots: { upper: () => bot } };
    const log = await runMatch(arena, counterConfig({ durationTicks: 1 }), [upper, upper]);
    expect(Object.keys(seen[0]?.questions ?? {})).toEqual(["step"]);
    expect(callsOf(log, "a0")[0]?.answers).toEqual(stepAnswer("up"));
  });

  it("gives the actor its observation and plan: the arena's fixed plan without a planner, none for a bot or an agent with a planner", async () => {
    const seen: AskRequest[] = [];
    const spy = scripted("dummy/spy", () => answered("dummy/spy", "up"), seen);
    const bot = scripted("bot/upper", () => answered("bot/upper", "up"), seen);
    const arena: Arena<CounterTypes> = { ...fakeArena, bots: { upper: () => bot } };
    const planned = player("dummy/spy", { roles: { actor: { model: "dummy/spy" }, planner: { model: "dummy/spy" } } });
    await runMatch(arena, counterConfig({ durationTicks: 1 }), [player("dummy/spy"), upper, planned], { models: resolver(spy) });
    const observation = { counter: 0, ticksLeft: 1 };
    expect(seen.map((req) => req.state)).toEqual([
      { observation, plan: "Go up." },
      { observation, plan: "" },
      { observation, plan: "" },
    ]);
  });
});

describe("runMatch: answers become actions (R22.d)", () => {
  it("logs and acts on the answers as checkAnswers reads them: rounded, unasked ones dropped", async () => {
    const precise = scripted("dummy/precise", () => ({
      ok: true,
      answers: {
        step: { type: "choice", choice: "up", probabilities: { up: 0.123456, down: 0.876544 }, confidence: 0.123456 },
        escalate: { type: "noul", noul: 0.70004 },
        mood: { type: "noul", noul: 1 },
      },
      usage: USAGE,
      model: "dummy/precise",
    }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [player("dummy/precise"), upper], { models: resolver(precise) });
    expect(callsOf(log, "a0")[0]?.answers).toEqual({
      step: { type: "choice", choice: "up", probabilities: { up: 0.1235, down: 0.8765 }, confidence: 0.1235 },
      escalate: { type: "noul", noul: 0.7 },
    });
    expect(eventsOfKind(log, "Step")[0]).toEqual(step(1, "a0", 1));
  });

  it("hands step every active agent's current action every tick; one without an action yet is left out", async () => {
    const actions: Record<string, Direction>[] = [];
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      step(state, given) {
        actions.push({ ...given });
        return fakeArena.step(state, given);
      },
    };
    const late = scripted("dummy/late", (_req, n) => (n === 0 ? { ok: false, error: modelError("server", "busy", 503) } : answered("dummy/late", "down")));
    const log = await runMatch(arena, counterConfig({ durationTicks: 8 }), [player("dummy/late"), upper], { models: resolver(late) });
    expect(actions).toEqual([
      { a1: "up" },
      { a1: "up" },
      { a0: "down", a1: "up" },
      { a0: "down", a1: "up" },
      { a0: "down", a1: "up" },
      { a0: "down" },
      { a0: "down" },
      { a0: "down" },
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 8, ranking: ["a1", "a0"], results: { a0: -6, a1: 5 } });
  });

  it("passes actionFrom the agent's current action as previous, undefined before its first", async () => {
    const previous: (Direction | undefined)[] = [];
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      actionFrom(answers, obs, prior) {
        previous.push(prior);
        return fakeArena.actionFrom(answers, obs, prior);
      },
    };
    await runMatch(arena, counterConfig({ durationTicks: 4 }), [player("dummy/down"), upper], { models: resolver(always("dummy/down", "down")) });
    expect(previous).toEqual([undefined, undefined, "down", "up"]);
  });
});

describe("runMatch: a failed call keeps the action (R12, R22.d, e)", () => {
  it("times out a call after deps.timeoutMs: logged as a timeout, and the agent goes on as before", async () => {
    const hang = scripted("dummy/hang", (_req, n) => (n === 0 ? answered("dummy/hang", "up") : never()));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/hang"), player("dummy/down")], {
      models: resolver(hang, always("dummy/down", "down")),
      timeoutMs: () => 5,
    });
    expect(log.events).toEqual([
      tickOf(0, 0, 0),
      okCall(1, "a0", "dummy/hang", "up"),
      okCall(1, "a1", "dummy/down", "down"),
      step(1, "a0", 1),
      step(1, "a1", -1),
      tickOf(1, 1, -1),
      step(2, "a0", 1),
      step(2, "a1", -1),
      tickOf(2, 2, -2),
      failedCall(3, "a0", "dummy/hang", { kind: "timeout", fatal: false, message: "no answer within 5 ms" }),
      okCall(3, "a1", "dummy/down", "down"),
      step(3, "a0", 1),
      step(3, "a1", -1),
      tickOf(3, 3, -3),
      step(4, "a0", 1),
      step(4, "a1", -1),
      tickOf(4, 4, -4),
      { kind: "MatchEnd", tick: 4, ranking: ["a0", "a1"], results: { a0: 4, a1: -4 } },
    ]);
  });

  it("refuses an invalid answer as invalid_output, naming the agent's model id; the action stands", async () => {
    const odd = scripted("dummy/odd", (_req, n) =>
      n === 0
        ? answered("odd-v2", "up")
        : { ok: true, answers: { step: { type: "choice", choice: "sideways", probabilities: { sideways: 1 }, confidence: 1 } }, usage: USAGE, model: "odd-v2" },
    );
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/odd"), player("dummy/down")], {
      models: resolver(odd, always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0")).toEqual([
      okCall(1, "a0", "odd-v2", "up"),
      failedCall(3, "a0", "dummy/odd", {
        kind: "invalid_output",
        fatal: false,
        message: 'invalid answer: step.choice: Invalid option: "sideways" is not one of the question\'s criteria',
      }),
    ]);
    expect(log.events.at(-2)).toEqual(tickOf(4, 4, -4));
  });

  it("logs an error reply as the schema reads it; the action stands", async () => {
    const error = { ...modelError("server", "bad gateway", 502), retryAfter: 3 }; // a field the schema does not know
    const flaky = scripted("dummy/flaky", (_req, n) => (n === 0 ? answered("dummy/flaky", "up") : { ok: false, error }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/flaky"), player("dummy/down")], {
      models: resolver(flaky, always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0")[1]).toEqual(failedCall(3, "a0", "dummy/flaky", { kind: "server", fatal: false, message: "bad gateway", status: 502 }));
    expect(log.events.at(-2)).toEqual(tickOf(4, 4, -4));
  });

  it("logs a model that rejects or throws as invalid_output, 'ask failed: <message>'", async () => {
    let n = 0;
    const thrower: Model = {
      id: "dummy/thrower",
      supports: SUPPORTS,
      ask() {
        n += 1;
        if (n === 1) return Promise.resolve(answered("dummy/thrower", "down"));
        if (n === 2) return Promise.reject(new Error("boom"));
        if (n === 3) throw "nope"; // synchronously, and not an Error
        return Promise.reject(new Error("")); // no message: the error's name stands in
      },
    };
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 7 }), [player("dummy/thrower"), player("dummy/down")], {
      models: resolver(thrower, always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0").map((call) => call.error ?? "ok")).toEqual([
      "ok",
      { kind: "invalid_output", fatal: false, message: "ask failed: boom" },
      { kind: "invalid_output", fatal: false, message: "ask failed: nope" },
      { kind: "invalid_output", fatal: false, message: "ask failed: Error" },
    ]);
    expect(log.events.at(-2)).toEqual(tickOf(7, -7, -7));
  });

  it("logs a reply that is not a Reply as invalid_output, and never acts on it", async () => {
    const replies: unknown[] = [{ ok: true, answers: stepAnswer("up") }, null, { ok: false, error: "boom" }, { ok: true, usage: USAGE, model: "x" }];
    const junk: Model = { id: "dummy/junk", supports: SUPPORTS, ask: async () => replies.shift() as Reply };
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 7 }), [player("dummy/junk"), player("dummy/down")], {
      models: resolver(junk, always("dummy/down", "down")),
    });
    expect(callsOf(log, "a0").map((call) => call.error?.message)).toEqual([
      "invalid reply: usage: Invalid input: expected object, received undefined",
      "invalid reply: reply: Invalid input: expected object, received null",
      "invalid reply: error: Invalid input: expected object, received string",
      "invalid answer: answers: Invalid input: expected record, received undefined",
    ]);
    expect(callsOf(log, "a0").every((call) => call.error?.kind === "invalid_output")).toBe(true);
    expect(eventsOfKind(log, "Step").some((event) => event.agent === "a0")).toBe(false);
  });

  it("logs the actor's answers or error with usage, never its questions or input (log size, ISSUES I-018)", async () => {
    const hang = scripted("dummy/hang", (_req, n) => (n === 0 ? answered("dummy/hang", "up") : never()));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/hang"), upper], { models: resolver(hang), timeoutMs: () => 5 });
    for (const call of eventsOfKind(log, "Call")) {
      expect(call).not.toHaveProperty("questions");
      expect(call).not.toHaveProperty("input");
      expect(call.ok ? call.usage : call.error).toBeDefined();
    }
  });

  it("gives each call its own signal and aborts it when the loop stops waiting, at the timeout (R17)", async () => {
    const calls: { signal: AbortSignal; told: boolean }[] = [];
    const hang = scripted("dummy/hang", (req, n) => {
      const call = { signal: req.signal, told: false };
      calls.push(call);
      req.signal.addEventListener("abort", () => (call.told = true), { once: true });
      return n === 0 ? answered("dummy/hang", "up") : never();
    });
    await runMatch(fakeArena, counterConfig({ durationTicks: 3 }), [player("dummy/hang"), player("dummy/down")], {
      models: resolver(hang, always("dummy/down", "down")),
      timeoutMs: () => 5,
    });
    expect(calls.map((call) => [call.signal.aborted, call.told])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(calls[1]?.signal.reason).toMatchObject({ name: "TimeoutError" });
  });

  it("asks deps.timeoutMs for every call's model and role", async () => {
    const asked: [string, string][] = [];
    await runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [player("dummy/down"), upper], {
      models: resolver(always("dummy/down", "down")),
      timeoutMs: (model, role) => {
        asked.push([model.id, role]);
        return 1000;
      },
    });
    expect(asked).toEqual([
      ["dummy/down", "actor"],
      ["bot/upper", "actor"],
    ]);
  });

  it("waits ACTOR_TIMEOUT_MS when deps.timeoutMs is absent", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const running = runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [player("dummy/hang"), upper], {
        models: resolver(scripted("dummy/hang", never)),
      }).then((log) => {
        done = true;
        return log;
      });
      await vi.advanceTimersByTimeAsync(ACTOR_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const log = await running;
      expect(callsOf(log, "a0")[0]?.error).toEqual({ kind: "timeout", fatal: false, message: `no answer within ${ACTOR_TIMEOUT_MS} ms` });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runMatch: cancel (deps.signal, R22.c)", () => {
  it("an already aborted signal gives Tick 0 and MatchEnd 0 with ranking []", async () => {
    const log = await runMatch(fakeArena, counterConfig(), [upper, upper], { signal: AbortSignal.abort() });
    expect(log.events).toEqual([tickOf(0, 0, 0), { kind: "MatchEnd", tick: 0, ranking: [] }]);
  });

  it("aborting during a tick ends the match after that tick's Tick, with ranking [] and no results", async () => {
    const controller = new AbortController();
    const log = await runMatch(fakeArena, counterConfig(), [player("dummy/down"), player("dummy/down")], {
      models: resolver(always("dummy/down", "down")),
      signal: controller.signal,
      onTick: (tick) => {
        if (tick === 3) controller.abort();
      },
    });
    expect(log.events.slice(-2)).toEqual([tickOf(3, -3, -3), { kind: "MatchEnd", tick: 3, ranking: [] }]);
  });

  it("keeps the arena's ending when the match ends on the tick it is cancelled", async () => {
    const controller = new AbortController();
    const log = await runMatch(fakeArena, counterConfig(), [upper, upper], {
      signal: controller.signal,
      onTick: (tick) => {
        if (tick === 5) controller.abort();
      },
    });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 5, ranking: ["a0", "a1"], results: { a0: 5, a1: 5 } });
  });

  it("cuts a call in flight short: logged as aborted, the tick completes, the match ends at once", async () => {
    const controller = new AbortController();
    const hang = scripted("dummy/hang", (_req, n) => {
      if (n === 0) return answered("dummy/hang", "up");
      setTimeout(() => controller.abort(), 5);
      return never();
    });
    const started = performance.now();
    const log = await runMatch(fakeArena, counterConfig(), [player("dummy/hang"), player("dummy/down")], {
      models: resolver(hang, always("dummy/down", "down")),
      timeoutMs: () => 60_000,
      signal: controller.signal,
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(log.events.slice(-6)).toEqual([
      failedCall(3, "a0", "dummy/hang", { kind: "aborted", fatal: false, message: "the match was cancelled" }),
      okCall(3, "a1", "dummy/down", "down"),
      step(3, "a0", 1),
      step(3, "a1", -1),
      tickOf(3, 3, -3),
      { kind: "MatchEnd", tick: 3, ranking: [] },
    ]);
  });

  it("aborts the signals of the match's calls when it is cancelled, those already answered too (R17)", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const spy = scripted("dummy/spy", (req) => {
      signals.push(req.signal);
      return answered("dummy/spy", "down");
    });
    let before: boolean[] = [];
    await runMatch(fakeArena, counterConfig(), [player("dummy/spy"), player("dummy/spy")], {
      models: resolver(spy),
      signal: controller.signal,
      onTick: (tick) => {
        if (tick === 2) before = signals.map((signal) => signal.aborted);
        if (tick === 4) controller.abort();
      },
    });
    expect(before).toEqual([false, false]);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, true, true]);
  });

  it("does not wait out the wall floor once cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    const log = await runMatch(fakeArena, counterConfig(), [upper, upper], { minWallMsPerTick: 60_000, signal: controller.signal });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(log.events.slice(-2)).toEqual([tickOf(1, 1, 1), { kind: "MatchEnd", tick: 1, ranking: [] }]);
  });
});

describe("runMatch: refused before anything runs (R22.a, j)", () => {
  /** The fake arena with a spawn that notes it ran. */
  function watched() {
    const seen = { spawned: false };
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      spawn(config, agents, rng) {
        seen.spawned = true;
        return fakeArena.spawn(config, agents, rng);
      },
    };
    return { arena, seen };
  }

  it.each([
    ["one agent", [upper], /2 to 16 agents/],
    ["17 agents", Array.from({ length: 17 }, () => upper), /2 to 16 agents/],
    ["a spec that does not parse", [upper, { arena: "counters", roles: {}, prompts: { planner: "", actor: {} } }], /agents\[1\].*roles\.actor/],
    ["a spec written for another arena", [upper, botSpec("racing", "upper")], /agents\[1\].*"racing"/],
    ["an unknown model with no resolver", [upper, player("dummy/nope")], /agents\[1\] actor: unknown model "dummy\/nope"/],
    ["a bot the arena does not have", [upper, botSpec("counters", "sniper")], /unknown model "bot\/sniper"/],
    ["a bot name from the object prototype", [upper, botSpec("counters", "toString")], /unknown model "bot\/toString"/],
  ])("refuses %s", async (_name, agents, message) => {
    const { arena, seen } = watched();
    await expect(runMatch(arena, counterConfig(), agents as AgentSpec[])).rejects.toThrow(message);
    expect(seen.spawned).toBe(false);
  });

  it("refuses a model id the resolver does not know, for the actor and for the planner", async () => {
    const { arena, seen } = watched();
    const models = resolver(always("dummy/up", "up"));
    await expect(runMatch(arena, counterConfig(), [upper, player("dummy/nope")], { models })).rejects.toThrow(/unknown model "dummy\/nope"/);
    const planned = player("dummy/up", { roles: { actor: { model: "dummy/up" }, planner: { model: "dummy/planner" } } });
    await expect(runMatch(arena, counterConfig(), [upper, planned], { models })).rejects.toThrow(/agents\[1\] planner: unknown model "dummy\/planner"/);
    expect(seen.spawned).toBe(false);
  });

  it("refuses a mode the arena does not have", async () => {
    const { arena, seen } = watched();
    await expect(runMatch(arena, counterConfig(), [upper, upper], { mode: "duo" })).rejects.toThrow(/mode "duo"/);
    expect(seen.spawned).toBe(false);
  });

  it("refuses a config the platform or the arena refuses", async () => {
    const { arena, seen } = watched();
    await expect(runMatch(arena, counterConfig({ durationTicks: 0 }), [upper, upper])).rejects.toThrow(/config: durationTicks/);
    await expect(runMatch(arena, counterConfig({ start: 9 }), [upper, upper])).rejects.toThrow(/config: start/);
    expect(seen.spawned).toBe(false);
  });

  it("resolves bot/<name> through arena.bots with the match's seed and the agent's slot", async () => {
    const made: [number, number][] = [];
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      bots: {
        upper: (seed, slot) => {
          made.push([seed, slot]);
          return always("bot/upper", "up");
        },
      },
    };
    const log = await runMatch(arena, counterConfig({ seed: 9, durationTicks: 3 }), [player("dummy/down"), upper, upper], {
      models: resolver(always("dummy/down", "down")),
    });
    expect(made).toEqual([
      [9, 1],
      [9, 2],
    ]);
    expect(callsOf(log, "a2").map((call) => call.model)).toEqual(["bot/upper", "bot/upper"]);
  });

  it("resolves other ids through deps.models with the slot, the role and the seed", async () => {
    const asked: [string, object][] = [];
    const planned = player("dummy/up", { roles: { actor: { model: "dummy/up" }, planner: { model: "dummy/plan" } } });
    await runMatch(fakeArena, counterConfig({ seed: 9, durationTicks: 1 }), [player("dummy/down"), planned], {
      models: (id, ctx) => {
        asked.push([id, ctx]);
        return always(id, "down");
      },
    });
    expect(asked).toEqual([
      ["dummy/down", { slot: 0, role: "actor", seed: 9 }],
      ["dummy/up", { slot: 1, role: "actor", seed: 9 }],
      ["dummy/plan", { slot: 1, role: "planner", seed: 9 }],
    ]);
  });
});

describe("runMatch: the envelope, the RNG and the clock (R22.b, i)", () => {
  it("logs the arena, the mode (its first unless deps.mode picks another), the config as the arena reads it, the agents as their specs parse", async () => {
    const arena: Arena<CounterTypes> = { ...fakeArena, modes: ["solo", "duo"] };
    const config = { ...counterConfig({ durationTicks: 1 }), theme: "dark" };
    const spec = { ...player("dummy/down"), name: "Faller" };
    const log = await runMatch(arena, config, [spec, upper], { models: resolver(always("dummy/down", "down")) });
    expect(log).toMatchObject({ version: 2, arena: "counters", mode: "solo" });
    expect(log.config).toEqual({ seed: 1, durationTicks: 1, start: 0 });
    expect(log.agents).toEqual([player("dummy/down"), upper]);
    expect((await runMatch(arena, counterConfig({ durationTicks: 1 }), [upper, upper], { mode: "duo" })).mode).toBe("duo");
  });

  it("seeds the arena's RNG with config.seed and hands spawn the agents' ids in slot order", async () => {
    const seen: unknown[] = [];
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      spawn(config, agents, rng) {
        seen.push([agents, rng]);
        return fakeArena.spawn(config, agents, rng);
      },
    };
    await runMatch(arena, counterConfig({ seed: 12345, durationTicks: 1 }), [upper, upper, upper]);
    expect(seen).toEqual([[["a0", "a1", "a2"], createRng(12345)]]);
  });

  it("logs spawn's events before Tick 0", async () => {
    const announced: StepEvent = { kind: "Step", tick: 0, agent: "a0", delta: 1 };
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      spawn: (config, agents, rng) => ({ ...fakeArena.spawn(config, agents, rng), events: [announced] }),
    };
    const log = await runMatch(arena, counterConfig({ durationTicks: 1 }), [upper, upper]);
    expect(log.events.slice(0, 2)).toEqual([announced, tickOf(0, 0, 0)]);
  });

  it("calls onTick after every Tick event, tick 0 included, with the state after it", async () => {
    const seen: [number, Record<string, number>][] = [];
    await runMatch(fakeArena, counterConfig({ durationTicks: 3 }), [upper, player("dummy/down")], {
      models: resolver(always("dummy/down", "down")),
      onTick: (tick, state) => seen.push([tick, { ...state.counters }]),
    });
    expect(seen).toEqual([
      [0, { a0: 0, a1: 0 }],
      [1, { a0: 1, a1: -1 }],
      [2, { a0: 2, a1: -2 }],
      [3, { a0: 3, a1: -3 }],
    ]);
  });

  it("steps at least minWallMsPerTick apart, and the log does not depend on it", async () => {
    const deps = { models: resolver(always("dummy/down", "down")) };
    const agents = [player("dummy/down"), player("dummy/down")];
    const plain = await runMatch(fakeArena, counterConfig({ durationTicks: 6 }), agents, deps);
    const at: number[] = [];
    const floored = await runMatch(fakeArena, counterConfig({ durationTicks: 6 }), agents, {
      ...deps,
      minWallMsPerTick: 15,
      onTick: () => at.push(performance.now()),
    });
    expect(at).toHaveLength(7);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `tick ${i - 1} to ${i}`).toBeGreaterThanOrEqual(14.5);
    expect(JSON.stringify(floored)).toBe(JSON.stringify(plain));
  });

  it("plays the same match to the same bytes", async () => {
    const run = () => runMatch(fakeArena, counterConfig({ durationTicks: 30 }), [upper, player("dummy/down")], { models: () => always("dummy/down", "down") });
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });
});

describe("runMatch: an arena bug rejects (R22.c)", () => {
  it("rejects when ended() is still null at durationTicks", async () => {
    const arena: Arena<CounterTypes> = { ...fakeArena, ended: () => null };
    await expect(runMatch(arena, counterConfig({ durationTicks: 3 }), [upper, upper])).rejects.toThrow(/durationTicks/);
  });

  it.each([
    ["a tick after durationTicks", { kind: "Step", tick: 99, agent: "a0", delta: 1 }],
    ["a negative tick", { kind: "Step", tick: -1, agent: "a0", delta: 1 }],
    ["a platform kind", { kind: "Tick", tick: 1, agent: "a0", delta: 1 }],
  ])("rejects an arena event with %s", async (_name, event) => {
    const arena: Arena<CounterTypes> = {
      ...fakeArena,
      step: (state, actions) => ({ ...fakeArena.step(state, actions), events: [event as StepEvent] }),
    };
    await expect(runMatch(arena, counterConfig({ durationTicks: 3 }), [upper, upper])).rejects.toThrow(RangeError);
  });
});
