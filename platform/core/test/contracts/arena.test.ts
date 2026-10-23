import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BaseConfigSchema,
  type AgentDefaults,
  type Answers,
  type Arena,
  type BaseConfig,
  type MatchOutcome,
  type Memory,
  type Model,
  type Questions,
} from "../../src/contracts";
import { createRng, type RngState } from "../../src/rng";
import { counterConfig, fakeArena, stepAnswer, type CounterState, type CounterTypes } from "../fake-arena";
import { issuePaths, roundTrip, without } from "./helpers";

// The arena contract (DESIGN.md §5.2, rows 42 and 46; ruling R21.c) and the
// minimal arena the platform tests run: two counters instead of a shooter.

const memory: Memory = { plan: "", scratchpad: "" };

describe("BaseConfig: what every arena config has (R21.c)", () => {
  it("parses the bounds of seed and durationTicks and round-trips", () => {
    expect(roundTrip(BaseConfigSchema, { seed: 0, durationTicks: 1 })).toEqual({ seed: 0, durationTicks: 1 });
    expect(issuePaths(BaseConfigSchema, { seed: 2 ** 32 - 1, durationTicks: 60_000 })).toEqual([]);
  });

  it.each([
    ["a negative seed", { seed: -1, durationTicks: 10 }, ["seed"]],
    ["a seed above 2^32 - 1", { seed: 2 ** 32, durationTicks: 10 }, ["seed"]],
    ["a fractional seed", { seed: 1.5, durationTicks: 10 }, ["seed"]],
    ["zero ticks", { seed: 1, durationTicks: 0 }, ["durationTicks"]],
    ["more than 60000 ticks", { seed: 1, durationTicks: 60_001 }, ["durationTicks"]],
    ["a fractional duration", { seed: 1, durationTicks: 2.5 }, ["durationTicks"]],
    ["a missing seed", { durationTicks: 10 }, ["seed"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(BaseConfigSchema, value)).toContainEqual(path);
  });

  it("is what an arena's own config extends: the fake arena adds `start`", () => {
    expect(fakeArena.config.parse(counterConfig({ seed: 7 }))).toEqual({ seed: 7, durationTicks: 40, start: 0 });
    expect(issuePaths(fakeArena.config, { ...counterConfig(), seed: -1 })).toContainEqual(["seed"]);
    expect(issuePaths(fakeArena.config, { ...counterConfig(), start: 9 })).toContainEqual(["start"]);
    expect(issuePaths(fakeArena.config, without(counterConfig(), "start"))).toContainEqual(["start"]);
  });
});

describe("Arena: the contract's shape (R21.c refinements of DESIGN.md §5.2)", () => {
  it("the fake arena satisfies Arena for its own types and as a plain Arena, as a registry holds it", () => {
    expectTypeOf(fakeArena).toExtend<Arena<CounterTypes>>();
    expectTypeOf(fakeArena).toExtend<Arena>();
  });

  it("spawn takes the platform's agent list and the RNG, and returns the state with its events", () => {
    expectTypeOf<Arena["spawn"]>().parameters.toEqualTypeOf<[BaseConfig, readonly string[], RngState]>();
    expectTypeOf<ReturnType<Arena<CounterTypes>["spawn"]>>().toEqualTypeOf<{ state: CounterState; events: CounterTypes["Event"][] }>();
  });

  it("actionFrom gets the checked answers, the observation and the previous action, none before the first", () => {
    expectTypeOf<Arena<CounterTypes>["actionFrom"]>().parameters.toEqualTypeOf<
      [Answers, CounterTypes["Obs"], CounterTypes["Action"] | undefined]
    >();
  });

  it("ended returns a ranking with optional per-agent results, or null while the match runs", () => {
    expectTypeOf<ReturnType<Arena["ended"]>>().toEqualTypeOf<MatchOutcome | null>();
    expectTypeOf<MatchOutcome>().toEqualTypeOf<{ ranking: string[]; results?: Record<string, unknown> }>();
  });

  it("types Tick.data with tickData and bots as model factories; no renderer in core", () => {
    expectTypeOf<Arena<CounterTypes>["tick"]>().returns.toEqualTypeOf<CounterTypes["TickData"]>();
    expectTypeOf<Arena["bots"]>().toEqualTypeOf<Record<string, (seed: number, slot: number) => Model>>();
    expectTypeOf<Arena["questions"]>().toEqualTypeOf<(obs: unknown, memory: Memory) => Questions>();
    expectTypeOf<Arena["defaults"]>().toEqualTypeOf<AgentDefaults>();
    expectTypeOf<AgentDefaults>().toEqualTypeOf<{ planner: string; actor: Record<string, string>; fixedPlan: string }>();
    expectTypeOf<"renderer" extends keyof Arena ? true : false>().toEqualTypeOf<false>();
  });
});

describe("the fake arena's rules, which the loop tests rely on", () => {
  const spawned = () => fakeArena.spawn(fakeArena.config.parse(counterConfig()), ["a0", "a1"], createRng(1));

  it("is a two-agent counter game with its own tick length and actor interval", () => {
    expect(fakeArena).toMatchObject({ id: "counters", modes: ["solo"], tickMs: 100, actorIntervalTicks: 2 });
  });

  it("spawns a counter per agent at config.start, announcing nothing", () => {
    const { state, events } = fakeArena.spawn(fakeArena.config.parse(counterConfig({ start: -2 })), ["a0", "a1"], createRng(1));
    expect(fakeArena.tick(state)).toEqual({ a0: -2, a1: -2 });
    expect(events).toEqual([]);
    expect(fakeArena.active(state)).toEqual(["a0", "a1"]);
  });

  it("steps each agent by its action, +1 up and -1 down, with a Step event; an agent without an action stays", () => {
    const one = fakeArena.step(spawned().state, { a0: "up" });
    expect(one.events).toEqual([{ kind: "Step", tick: 1, agent: "a0", delta: 1 }]);
    expect(fakeArena.tick(one.state)).toEqual({ a0: 1, a1: 0 });
    const two = fakeArena.step(one.state, { a0: "down", a1: "down" });
    expect(two.events).toEqual([
      { kind: "Step", tick: 2, agent: "a0", delta: -1 },
      { kind: "Step", tick: 2, agent: "a1", delta: -1 },
    ]);
    expect(fakeArena.tick(two.state)).toEqual({ a0: 0, a1: -1 });
  });

  it("lets an agent that reaches +5 leave: it is no longer active and no longer steps", () => {
    let state = spawned().state;
    for (let i = 0; i < 5; i++) state = fakeArena.step(state, { a0: "up", a1: "down" }).state;
    expect(fakeArena.active(state)).toEqual(["a1"]);
    const after = fakeArena.step(state, { a0: "up", a1: "down" });
    expect(after.events).toEqual([{ kind: "Step", tick: 6, agent: "a1", delta: -1 }]);
    expect(fakeArena.tick(after.state)).toEqual({ a0: 5, a1: -6 });
  });

  it("ends when every agent has left or at durationTicks, ranking by counter then slot, with the counters as results", () => {
    let state = spawned().state;
    expect(fakeArena.ended(state)).toBeNull();
    for (let i = 0; i < 5; i++) state = fakeArena.step(state, { a0: "up", a1: "up" }).state;
    expect(fakeArena.ended(state)).toEqual({ ranking: ["a0", "a1"], results: { a0: 5, a1: 5 } });

    let late = fakeArena.spawn(fakeArena.config.parse(counterConfig({ durationTicks: 3 })), ["a0", "a1"], createRng(1)).state;
    for (let i = 0; i < 2; i++) late = fakeArena.step(late, { a0: "down", a1: "up" }).state;
    expect(fakeArena.ended(late)).toBeNull();
    late = fakeArena.step(late, { a0: "down", a1: "up" }).state;
    expect(fakeArena.ended(late)).toEqual({ ranking: ["a1", "a0"], results: { a0: -3, a1: 3 } });
  });

  it("perceives an agent's counter and the ticks left, and asks one choice question, step: up or down", () => {
    const { state } = spawned();
    const obs = fakeArena.perceive(state, "a1");
    expect(obs).toEqual({ counter: 0, ticksLeft: 40 });
    expect(fakeArena.questions(obs, memory)).toEqual({
      step: { type: "choice", instructions: fakeArena.defaults.actor.step, criteria: { up: expect.any(String), down: expect.any(String) } },
    });
  });

  it("turns a step answer into an action; a missing answer keeps the previous action, or goes down without one", () => {
    const obs = { counter: 0, ticksLeft: 10 };
    expect(fakeArena.actionFrom(stepAnswer("up"), obs, "down")).toBe("up");
    expect(fakeArena.actionFrom(stepAnswer("down"), obs, "up")).toBe("down");
    expect(fakeArena.actionFrom({}, obs, "up")).toBe("up");
    expect(fakeArena.actionFrom({}, obs, undefined)).toBe("down");
  });

  it("has one bot, upper, that always answers up", async () => {
    const bot = fakeArena.bots.upper?.(1, 0);
    const reply = await bot?.ask({ state: {}, questions: fakeArena.questions({ counter: 0, ticksLeft: 1 }, memory), signal: new AbortController().signal });
    expect(bot?.id).toBe("bot/upper");
    expect(reply).toMatchObject({ ok: true, answers: stepAnswer("up") });
  });

  it("validates its own Tick payload and events with tickData and events", () => {
    const { state } = spawned();
    const { state: next, events } = fakeArena.step(state, { a0: "up", a1: "down" });
    expect(fakeArena.tickData.parse(fakeArena.tick(next))).toEqual({ a0: 1, a1: -1 });
    for (const event of events) expect(fakeArena.events.parse(event)).toEqual(event);
    expect(issuePaths(fakeArena.events, { kind: "Step", tick: 1, agent: "a0", delta: 2 })).toEqual([["delta"]]);
    expect(issuePaths(fakeArena.tickData, { a0: 1.5 })).toEqual([["a0"]]);
  });

  it("describes the match and an observation in a line of text each", () => {
    expect(fakeArena.staticText(fakeArena.config.parse(counterConfig()))).toMatch(/\S/);
    expect(fakeArena.observationText({ counter: 3, ticksLeft: 7 })).toContain("3");
  });
});
