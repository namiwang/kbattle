import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import {
  ArenaEventSchema,
  botSpec,
  CallEventSchema,
  callsOf,
  EventSchema,
  eventsOfKind,
  lastTick,
  MatchEndEventSchema,
  MatchLogSchema,
  parseMatchLog,
  parseMatchLogFor,
  TickEventSchema,
  type ArenaEvent,
  type CallEvent,
  type Event,
  type EventOf,
  type MatchLog,
  type MatchLogFor,
  type TickEvent,
} from "../../src/contracts";
import { fakeArena, stepAnswer, type CounterTypes, type StepEvent } from "../fake-arena";
import { issuePaths, roundTrip, without } from "./helpers";

// The version-2 log (DESIGN.md §5.5, rows 43 and 47; ruling R21.f): the
// platform's envelope and events (Call, Tick, MatchEnd) around the arena's own.

const player = {
  arena: "counters",
  roles: { actor: { model: "dummy/up" }, planner: { model: "dummy/planner" } },
  prompts: { planner: "Climb.", actor: { step: "Go up." } },
};

const events = {
  tick0: { kind: "Tick", tick: 0, data: { a0: 0, a1: 0 } },
  actor: {
    kind: "Call",
    tick: 1,
    requestedTick: 1,
    agent: "a0",
    role: "actor",
    model: "dummy/up",
    ok: true,
    answers: stepAnswer("up"),
    usage: { inputTokens: 30, outputTokens: 20 },
  },
  step: { kind: "Step", tick: 1, agent: "a0", delta: 1 },
  tick1: { kind: "Tick", tick: 1, data: { a0: 1, a1: 0 } },
  fault: {
    kind: "Call",
    tick: 3,
    requestedTick: 3,
    agent: "a1",
    role: "actor",
    model: "bot/upper",
    ok: false,
    error: { kind: "timeout", fatal: false, message: "no answer within 2000 ms" },
  },
  planner: {
    kind: "Call",
    tick: 9,
    requestedTick: 1,
    agent: "a0",
    role: "planner",
    model: "dummy/planner",
    ok: true,
    answers: { plan: { type: "text", text: "Climb." }, scratchpad: { type: "text", text: "" } },
    usage: { inputTokens: 300, outputTokens: 12 },
    input: { static: "Counters.", observation: "counter 0", memory: { plan: "", scratchpad: "" }, tick: 1 },
  },
  end: { kind: "MatchEnd", tick: 9, ranking: ["a0", "a1"], results: { a0: 5, a1: 3 } },
} as const;

const log = {
  version: 2,
  arena: "counters",
  mode: "solo",
  config: { seed: 7, durationTicks: 40, start: 0 },
  agents: [player, botSpec("counters", "upper")],
  events: Object.values(events),
};
const indexOf = (event: object) => log.events.indexOf(event as (typeof log.events)[number]);

/** The issue paths of a parse that throws; [] when it does not. */
function thrownPaths(parse: () => unknown): PropertyKey[][] {
  try {
    parse();
    return [];
  } catch (error) {
    if (error instanceof z.ZodError) return error.issues.map((issue) => issue.path);
    throw error;
  }
}

describe("Call: one model call (replaces v1's Doer and Thinker)", () => {
  it.each([
    ["an actor call that answered", events.actor],
    ["an actor call that failed", events.fault],
    ["a planner call with its input, landing after it was asked", events.planner],
  ])("parses %s and round-trips", (_name, event) => {
    expect(roundTrip(CallEventSchema, event)).toEqual(event);
  });

  it("accepts any input and the call's questions", () => {
    expect(issuePaths(CallEventSchema, { ...events.planner, input: "free text" })).toEqual([]);
    expect(issuePaths(CallEventSchema, { ...events.planner, input: null })).toEqual([]);
    const questions = fakeArena.questions({ counter: 0, ticksLeft: 1 }, { plan: "", scratchpad: "" });
    expect(issuePaths(CallEventSchema, { ...events.actor, questions })).toEqual([]);
  });

  it.each([
    ["ok without answers", without(events.actor, "answers"), ["answers"]],
    ["a failure without an error", { ...without(events.fault, "error") }, ["error"]],
    ["a failure whose error is plain text", { ...events.fault, error: "timeout" }, ["error"]],
    ["requested after it landed", { ...events.planner, requestedTick: 10 }, ["requestedTick"]],
    ["a role that is not actor or planner", { ...events.actor, role: "thinker" }, ["role"]],
    ["an empty model", { ...events.actor, model: "" }, ["model"]],
    ["an empty agent", { ...events.actor, agent: "" }, ["agent"]],
    ["no requestedTick", without(events.actor, "requestedTick"), ["requestedTick"]],
    ["a fractional tick", { ...events.actor, tick: 1.5 }, ["tick"]],
    ["negative usage", { ...events.actor, usage: { inputTokens: -1, outputTokens: 0 } }, ["usage", "inputTokens"]],
    ["an unknown error kind", { ...events.fault, error: { ...events.fault.error, kind: "teapot" } }, ["error", "kind"]],
    ["an answer above 1", { ...events.actor, answers: { ready: { type: "noul", noul: 2 } } }, ["answers", "ready", "noul"]],
    ["a bad question", { ...events.actor, questions: { step: { type: "choice", instructions: "?", criteria: {} } } }, ["questions", "step", "criteria"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(CallEventSchema, value)).toContainEqual(path);
  });
});

describe("Tick: the arena's payload after each step", () => {
  it("parses a payload of any shape and round-trips", () => {
    expect(roundTrip(TickEventSchema, events.tick1)).toEqual(events.tick1);
    expect(issuePaths(TickEventSchema, { kind: "Tick", tick: 2, data: [["a0", 1, 2]] })).toEqual([]);
  });

  it.each([
    ["no payload", { kind: "Tick", tick: 2 }, ["data"]],
    ["a negative tick", { ...events.tick1, tick: -1 }, ["tick"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(TickEventSchema, value)).toContainEqual(path);
  });
});

describe("MatchEnd: the ranking, and the arena's results when it has them", () => {
  it("parses with results, without them, and with the empty ranking of a cancelled match", () => {
    expect(roundTrip(MatchEndEventSchema, events.end)).toEqual(events.end);
    expect(issuePaths(MatchEndEventSchema, without(events.end, "results"))).toEqual([]);
    expect(issuePaths(MatchEndEventSchema, { kind: "MatchEnd", tick: 4, ranking: [] })).toEqual([]);
  });

  it.each([
    ["an empty agent id in the ranking", { ...events.end, ranking: ["a0", ""] }, ["ranking", 1]],
    ["results under an empty agent id", { ...events.end, results: { "": 1 } }, ["results", ""]],
    ["no ranking", without(events.end, "ranking"), ["ranking"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(MatchEndEventSchema, value)).toContainEqual(path);
  });
});

describe("arena events: any other kind, passed through for the arena to check", () => {
  it("keeps every field of an arena event", () => {
    expect(roundTrip(ArenaEventSchema, events.step)).toEqual(events.step);
    expect(EventSchema.parse(events.step)).toEqual(events.step);
  });

  it("takes no kind from the object prototype for a platform kind", () => {
    for (const kind of ["toString", "constructor", "__proto__"]) {
      expect(EventSchema.parse({ kind, tick: 2, x: 1 })).toEqual({ kind, tick: 2, x: 1 });
    }
  });

  it("refuses a platform kind when read as an arena event", () => {
    expect(issuePaths(ArenaEventSchema, { kind: "Call", tick: 1 })).toEqual([["kind"]]);
  });

  it.each([
    ["no kind", { tick: 1, agent: "a0" }, ["kind"]],
    ["an empty kind", { kind: "", tick: 1 }, ["kind"]],
    ["no tick", { kind: "Step", agent: "a0" }, ["tick"]],
    ["a negative tick", { ...events.step, tick: -1 }, ["tick"]],
    ["a fractional tick", { ...events.step, tick: 0.5 }, ["tick"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(EventSchema, value)).toContainEqual(path);
  });
});

describe("Event: a platform kind is read by its own schema, any other kind passes through", () => {
  it("parses one event of each platform kind and an arena event", () => {
    for (const event of Object.values(events)) expect(EventSchema.parse(event)).toEqual(event);
  });

  it("drops unknown fields of a platform event (a newer file in an older viewer), but not of an arena event", () => {
    expect(EventSchema.parse({ ...events.actor, latencyMs: 30 })).toEqual(events.actor);
    expect(EventSchema.parse({ ...events.step, note: "x" })).toEqual({ ...events.step, note: "x" });
  });

  it("points an error into the event: an arena event cannot borrow a platform kind", () => {
    expect(issuePaths(EventSchema, { kind: "Tick", tick: 1, agents: [] })).toEqual([["data"]]);
    expect(issuePaths(EventSchema, without(events.actor, "agent"))).toEqual([["agent"]]);
    expect(issuePaths(EventSchema, { ...events.fault, ok: true })).toEqual([["answers"]]);
  });

  it("rejects what is not an event object", () => {
    expect(issuePaths(EventSchema, 3)).toEqual([[]]);
    expect(issuePaths(EventSchema, null)).toEqual([[]]);
  });
});

describe("MatchLog: the version-2 envelope", () => {
  it("parses a log and round-trips, keeping the arena's own config fields", () => {
    expect(roundTrip(MatchLogSchema, log)).toEqual(log);
    expect(MatchLogSchema.parse(log).config).toEqual({ seed: 7, durationTicks: 40, start: 0 });
  });

  it("accepts 2 to 16 agents", () => {
    const agents = (n: number) => Array.from({ length: n }, () => botSpec("counters", "upper"));
    expect(issuePaths(MatchLogSchema, { ...log, agents: agents(2) })).toEqual([]);
    expect(issuePaths(MatchLogSchema, { ...log, agents: agents(16) })).toEqual([]);
    expect(issuePaths(MatchLogSchema, { ...log, agents: agents(1) })).toContainEqual(["agents"]);
    expect(issuePaths(MatchLogSchema, { ...log, agents: agents(17) })).toContainEqual(["agents"]);
  });

  it.each([
    ["version 1 (row 47: no migration)", { ...log, version: 1 }, ["version"]],
    ["an empty arena id", { ...log, arena: "" }, ["arena"]],
    ["an empty mode", { ...log, mode: "" }, ["mode"]],
    ["a seed out of range", { ...log, config: { ...log.config, seed: -1 } }, ["config", "seed"]],
    ["a config without durationTicks", { ...log, config: without(log.config, "durationTicks") }, ["config", "durationTicks"]],
    ["an agent written for another arena", { ...log, agents: [player, botSpec("racing", "follower")] }, ["agents", 1, "arena"]],
    ["a bad agent spec", { ...log, agents: [player, { ...player, roles: {} }] }, ["agents", 1, "roles", "actor"]],
    ["a bad event", { ...log, events: [events.tick0, without(events.actor, "answers")] }, ["events", 1, "answers"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(MatchLogSchema, value)).toContainEqual(path);
  });

  // ISSUES I-014: a viewer indexes ticks 0..last, so a crafted tick of 1e8 would hang the tab.
  it("accepts event ticks up to config.durationTicks and rejects each later one at its own path", () => {
    const at = (tick: number) => ({ ...events.step, tick });
    expect(issuePaths(MatchLogSchema, { ...log, events: [...log.events, at(40)] })).toEqual([]);
    expect(issuePaths(MatchLogSchema, { ...log, events: [at(41), ...log.events, at(1e8)] })).toEqual([
      ["events", 0, "tick"],
      ["events", log.events.length + 1, "tick"],
    ]);
  });

  it("drops an unknown top-level field", () => {
    expect(MatchLogSchema.parse({ ...log, producer: "decision-arena 0.5" })).toEqual(log);
  });
});

describe("parseMatchLog: the platform's part of a log", () => {
  it("returns the log as the schema reads it", () => {
    const parsed: MatchLog = parseMatchLog(JSON.parse(JSON.stringify(log)));
    expect(parsed).toEqual(log);
  });

  it("throws a ZodError whose issues name the paths", () => {
    expect(thrownPaths(() => parseMatchLog({ ...log, events: [{ ...events.step, tick: 41 }] }))).toEqual([["events", 0, "tick"]]);
  });
});

describe("parseMatchLogFor: a log checked by its arena too (R21.f)", () => {
  it("returns the log, typed for the arena", () => {
    const parsed = parseMatchLogFor(fakeArena, JSON.parse(JSON.stringify(log)));
    expect(parsed).toEqual(log);
    expectTypeOf(parsed).toEqualTypeOf<MatchLogFor<CounterTypes>>();
    expectTypeOf(parsed.config.start).toEqualTypeOf<number>();
    expectTypeOf(eventsOfKind(parsed, "Tick")).toEqualTypeOf<TickEvent<Record<string, number>>[]>();
    expectTypeOf(eventsOfKind(parsed, "Step")).toEqualTypeOf<StepEvent[]>();
  });

  it("reads the config, the Tick payloads and the arena events as the arena's schemas read them", () => {
    const extra = { ...log, config: { ...log.config, theme: "dark" }, events: [{ ...events.step, note: "x" }] };
    expect(parseMatchLog(extra).config).toHaveProperty("theme");
    const parsed = parseMatchLogFor(fakeArena, extra);
    expect(parsed.config).toEqual(log.config);
    expect(parsed.events).toEqual([events.step]);
  });

  it.each([
    ["a log of another arena", { ...log, arena: "racing", agents: [botSpec("racing", "a"), botSpec("racing", "b")] }, [["arena"]]],
    ["a mode the arena does not have", { ...log, mode: "duo" }, [["mode"]]],
    ["a config the arena refuses", { ...log, config: { ...log.config, start: 9 } }, [["config", "start"]]],
    ["a config without the arena's own field", { ...log, config: without(log.config, "start") }, [["config", "start"]]],
    ["a Tick payload the arena refuses", { ...log, events: [events.tick0, { ...events.tick1, data: { a0: 0.5 } }] }, [["events", 1, "data", "a0"]]],
    ["an arena event the arena refuses", { ...log, events: [events.tick0, { ...events.step, delta: 3 }] }, [["events", 1, "delta"]]],
    ["an event kind the arena does not have", { ...log, events: [events.tick0, { kind: "Teleport", tick: 1 }] }, [["events", 1, "kind"]]],
  ])("rejects %s, naming where", (_name, value, paths) => {
    expect(thrownPaths(() => parseMatchLogFor(fakeArena, value))).toEqual(paths);
  });

  it("reports every arena problem, each at its event's index", () => {
    const bad = { ...log, events: [events.tick0, { ...events.step, delta: 3 }, events.actor, { ...events.tick1, data: null }] };
    expect(thrownPaths(() => parseMatchLogFor(fakeArena, bad))).toEqual([
      ["events", 1, "delta"],
      ["events", 3, "data"],
    ]);
  });

  it("checks the platform's part first: a log the platform refuses is not shown to the arena", () => {
    expect(thrownPaths(() => parseMatchLogFor(fakeArena, { ...log, version: 1, mode: "duo" }))).toEqual([["version"]]);
  });
});

describe("read helpers", () => {
  const parsed = parseMatchLog(log);

  it("eventsOfKind returns the events of one kind in log order, typed to that kind", () => {
    const calls = eventsOfKind(parsed, "Call");
    expect(calls).toEqual([events.actor, events.fault, events.planner]);
    expectTypeOf(calls).toEqualTypeOf<CallEvent[]>();
    expect(eventsOfKind(parsed, "Tick").map((e) => e.tick)).toEqual([0, 1]);
    expect(eventsOfKind(parsed, "Death")).toEqual([]);
  });

  it("an arena kind read from a plain log is an arena event of that kind", () => {
    const steps = eventsOfKind(parsed, "Step");
    expect(steps).toEqual([events.step]);
    expectTypeOf(steps).toEqualTypeOf<(ArenaEvent & { kind: "Step" })[]>();
    expectTypeOf<EventOf<"MatchEnd">>().toEqualTypeOf<Extract<Event, { kind: "MatchEnd" }>>();
  });

  it("lastTick is the highest tick of any event, wherever it sits; 0 without events", () => {
    expect(lastTick(parsed)).toBe(9);
    expect(lastTick({ ...parsed, events: [events.end, events.tick0] })).toBe(9);
    expect(lastTick({ ...parsed, events: [] })).toBe(0);
  });

  it("callsOf returns one agent's calls in log order, of one role when asked", () => {
    expect(callsOf(parsed, "a0")).toEqual([events.actor, events.planner]);
    expect(callsOf(parsed, "a0", "planner")).toEqual([events.planner]);
    expect(callsOf(parsed, "a1", "actor")).toEqual([events.fault]);
    expect(callsOf(parsed, "a7")).toEqual([]);
  });

  it("works on a log typed for its arena too", () => {
    const typed = parseMatchLogFor(fakeArena, log);
    expect(callsOf(typed, "a1")).toEqual([events.fault]);
    expect(lastTick(typed)).toBe(9);
    expect(indexOf(events.end)).toBe(log.events.length - 1);
  });
});
