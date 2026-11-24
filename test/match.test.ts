// The match loop: the two reference bot matches on the battle royale, then scripted matches on a counter arena.

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { battleRoyale, type Snapshot } from "../src/arenas/battle-royale/arena.ts";
import { runMatch, type MatchOptions } from "../src/core/run.ts";
import type { Agent, Arena, Event, MatchLog, Model } from "../src/core/types.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("the reference bot matches", () => {
  /** [tick, agents, bullets] of every Tick event, one per line. */
  const tickLines = (log: MatchLog) => {
    const line = (tick: number, { agents, bullets }: Snapshot) => JSON.stringify([tick, agents, bullets]);
    return log.events.flatMap((e) => (e.kind === "Tick" ? [line(e.tick, e.snapshot as Snapshot)] : [])).join("\n");
  };
  const bots = (names: string[]): Agent[] => names.map((name) => ({ actor: `bot/${name}` }));

  it("A: map-1, seed 7, 16 bots, wanderer and camper alternating", async () => {
    let last = battleRoyale.spawn({ seed: 7, map: "map-1" }, []);
    const arena = { ...battleRoyale, step: (...args: Parameters<typeof battleRoyale.step>) => (last = battleRoyale.step(...args)) };
    const log = await runMatch(arena, { seed: 7, map: "map-1" }, bots(Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? "wanderer" : "camper"))));
    expect(sha256(tickLines(log))).toBe("b741e8f1fb4ff19ab447623f9339853fa5739d3318169c65be02187cd9d25735");
    expect(log.events.filter((e) => e.kind === "Tick")).toHaveLength(1169);
    expect(log.events.at(-1)).toEqual({ kind: "End", tick: 1168, ranking: "a9 a1 a4 a15 a12 a3 a14 a13 a10 a8 a0 a6 a2 a11 a5 a7".split(" ") });
    // The whole log, every call included.
    expect(sha256(JSON.stringify(log))).toBe("dae0999c6c4a6baeebe7c2b1c0edb8a6e2720323517a97525d7067513fda6bc2");
    // The last world at full precision: snapshots round to 2 decimals, this sees a last-bit change in the arithmetic.
    expect(sha256(JSON.stringify(last.agents.map((a) => [a.pos, a.facing])))).toBe("acd0bc88acf7a874668760c5aa45d8b3ec3e038714657bec4b65c67103522e77");
  });

  it("B: map-2, seed 3, 8 wanderers", async () => {
    const log = await runMatch(battleRoyale, { seed: 3, map: "map-2" }, bots(Array.from({ length: 8 }, () => "wanderer")));
    expect(sha256(tickLines(log))).toBe("bbf68a71c18d8c7d910fccf852c9b967509a7d3d5d621e0439fc32f8b9a353ea");
    expect(log.events.filter((e) => e.kind === "Tick")).toHaveLength(539);
    expect(log.events.at(-1)).toEqual({ kind: "End", tick: 538, ranking: "a5 a6 a3 a2 a0 a1 a4 a7".split(" ") });
  });
});

// ---- A tiny arena and scripted models ----

type Counters = { tick: number; agents: string[]; count: Record<string, number>; pace: Record<string, number> };
type Req = Parameters<Model["ask"]>[0];
const GOAL = 3;
const config = { seed: 9, map: "flat" };

/**
 * A counter per agent, moved on every tick by the agent's latest pick: up +1, down -1. Whoever reaches GOAL
 * leaves and is no longer asked; the match ends when all have left or after `limit` ticks, highest counter first.
 */
function counters(limit: number, tickMs = 500, actEvery = 2): Arena<Counters, { count: number }> {
  return {
    id: "counters",
    maps: ["flat"],
    tickMs,
    actEvery,
    questions: { step: { type: "choice", instructions: "Follow `plan`.", criteria: { up: "count up", down: "count down" } } },
    defaultPrompt: "Go up.",
    bots: { upper: () => scripted(() => picks("up")) },
    rules: () => `Reach ${GOAL}.`,
    spawn: (_config, agents) => ({ tick: 0, agents, count: Object.fromEntries(agents.map((a) => [a, 0])), pace: {} }),
    perceive: (state, agent) => ({ count: state.count[agent]! }),
    step(state, answers) {
      const count = { ...state.count };
      const pace = { ...state.pace };
      for (const a of state.agents) {
        const pick = answers[a]?.step;
        if (pick !== undefined) pace[a] = pick === "up" ? 1 : -1;
        if (count[a]! < GOAL) count[a] = count[a]! + (pace[a] ?? 0);
      }
      return { ...state, tick: state.tick + 1, count, pace };
    },
    snapshot: (state) => ({ ...state.count }),
    active: (state) => state.agents.filter((a) => state.count[a]! < GOAL),
    ended(state) {
      if (state.tick < limit && state.agents.some((a) => state.count[a]! < GOAL)) return null;
      return [...state.agents].sort((a, b) => state.count[b]! - state.count[a]!);
    },
  };
}

/** A model whose n-th call answers script(req, n), or fails with what it throws; `asked` keeps every request. */
function scripted(script: (req: Req, n: number) => unknown): Model & { asked: Req[] } {
  const asked: Req[] = [];
  return { asked, ask: async (req) => (asked.push(req), script(req, asked.length - 1)) as ReturnType<Model["ask"]> };
}

const picks = (step: string, replan?: string) => ({ answers: replan === undefined ? { step } : { step, replan } });
const plans = (req: Req) => (req.state as { plan: string }).plan;

/** options.models over these models; any other id throws. */
function from(models: Record<string, Model>): MatchOptions["models"] {
  return (id) => {
    if (!Object.hasOwn(models, id)) throw new Error(`no model "${id}"`);
    return models[id]!;
  };
}

/** A log in short: "tick 3", "a0 actor 2" (landed at tick 2), "a0 planner 4<0" (asked at 0), "… !why" (failed), "end 7 a1 a0". */
function outline(log: MatchLog): string[] {
  return log.events.map((e) => {
    if (e.kind === "Tick") return `tick ${e.tick}`;
    if (e.kind === "End") return `end ${e.tick} ${e.error === undefined ? e.ranking.join(" ") : `!${e.error}`}`;
    return `${e.agent} ${e.job} ${e.tick}${e.askedTick === undefined ? "" : `<${e.askedTick}`}${e.error === undefined ? "" : ` !${e.error}`}`;
  });
}

const calls = (log: MatchLog, agent: string, job = "actor") => log.events.flatMap((e) => (e.kind === "Call" && e.agent === agent && e.job === job ? [e] : []));
const counts = (log: MatchLog, agent: string) => log.events.flatMap((e) => (e.kind === "Tick" ? [(e.snapshot as Record<string, number>)[agent]] : []));

describe("a scripted match", () => {
  it("asks every active agent at each decision, from tick 0, and logs the calls in agent order", async () => {
    const down = scripted(() => picks("down"));
    const upper = scripted(() => picks("up"));
    const made: number[][] = [];
    const arena = { ...counters(5), bots: { upper: (seed: number, index: number) => (made.push([seed, index]), upper) } };
    const seen: Event[] = [];
    const agents = [{ actor: "bot/upper" }, { actor: "down", prompt: "Go down." }, { actor: "bot/upper" }];
    const log = await runMatch(arena, config, agents, { models: from({ down }), onEvent: (event) => seen.push(event) });

    // a0 and a2 reach the goal at tick 3 and are not asked at tick 4.
    expect(outline(log)).toEqual([
      "tick 0", "a0 actor 0", "a1 actor 0", "a2 actor 0", "tick 1", "tick 2", "a0 actor 2", "a1 actor 2", "a2 actor 2",
      "tick 3", "tick 4", "a1 actor 4", "tick 5", "end 5 a0 a2 a1",
    ]);
    expect({ ...log, events: [] }).toEqual({ version: 1, arena: "counters", config, agents, events: [] });
    expect(JSON.stringify(log.events.slice(1, 5))).toBe(
      '[{"kind":"Call","tick":0,"agent":"a0","job":"actor","observation":{"count":0},"answers":{"step":"up"}},' +
        '{"kind":"Call","tick":0,"agent":"a1","job":"actor","observation":{"count":0},"answers":{"step":"down"}},' +
        '{"kind":"Call","tick":0,"agent":"a2","job":"actor","observation":{"count":0},"answers":{"step":"up"}},' +
        '{"kind":"Tick","tick":1,"snapshot":{"a0":1,"a1":-1,"a2":1}}]',
    );
    expect(seen).toEqual(log.events);
    // An actor reads its plan, the prompt until a planner writes, and its observation. Without a planner, no `replan`.
    expect(down.asked.map((req) => req.state)).toEqual([0, -2, -4].map((count) => ({ plan: "Go down.", observation: { count } })));
    expect(down.asked[0]!.questions).toEqual(arena.questions);
    expect(upper.asked[0]).toMatchObject({ state: { plan: "" }, questions: arena.questions });
    expect(made).toEqual([[9, 0], [9, 2]]);
  });

  it("a plan asked at one decision lands at the next and the actor reads it; what a reply may not hold is dropped or cut", async () => {
    const planner = scripted(() => ({
      answers: { plan: "P".repeat(700), more: "x" },
      usage: { input_tokens: 90, output_tokens: 150, cost: 0.002, more: 1 },
      key: "secret",
    }));
    const reply = (step: string) => ({
      answers: { step, replan: "no", more: "x" },
      probabilities: { step: { up: 0.666, down: 0.334, sideways: 1 }, replan: { no: 1 }, more: { x: 1 } },
      usage: { input_tokens: -1, output_tokens: 2 },
    });
    const actor = scripted((_req, n) => reply(n === 0 ? "up" : "sideways"));
    const agents = [{ actor: "actor", planner: "planner", prompt: "Hold." }, { actor: "bot/upper" }];
    const log = await runMatch(counters(3), config, agents, { models: from({ actor, planner }) });

    expect(outline(log)).toEqual([
      "tick 0", "a0 actor 0", "a1 actor 0", "tick 1", "tick 2", "a0 planner 2<0", "a0 actor 2", "a1 actor 2", "tick 3", "end 3 a0 a1",
    ]);
    expect(planner.asked[0]).toMatchObject({
      state: { rules: "Reach 3.", prompt: "Hold.", plan: "Hold.", history: [], observation: { count: 0 } },
      questions: { plan: { type: "text", maxChars: 600 } },
    });
    expect(Object.keys(actor.asked[0]!.questions)).toEqual(["step", "replan"]);
    expect(actor.asked.map(plans)).toEqual(["Hold.", "P".repeat(600)]);
    const head = { kind: "Call", agent: "a0" };
    const usage = { input_tokens: 90, output_tokens: 150, cost: 0.002 };
    expect(calls(log, "a0", "planner")).toEqual([{ ...head, tick: 2, job: "planner", askedTick: 0, observation: { count: 0 }, answers: { plan: "P".repeat(600) }, usage }]);
    const odds = { step: { up: 0.67, down: 0.33 }, replan: { no: 1 } };
    expect(calls(log, "a0")).toEqual([
      { ...head, tick: 0, job: "actor", observation: { count: 0 }, answers: { step: "up", replan: "no" }, probabilities: odds },
      { ...head, tick: 2, job: "actor", observation: { count: 2 }, answers: { replan: "no" }, probabilities: { replan: { no: 1 } } },
    ]);
    expect(counts(log, "a0")).toEqual([0, 1, 2, 3]); // "sideways" is no option: the agent kept going up
  });

  it("asks the planner again 5 s after a `replan: yes`, and after 20 s anyway, with the history since its last request", async () => {
    // A decision on every tick of 250 ms: 5 s are 20 ticks, 20 s are 80.
    const eager = scripted((_req, n) => {
      if (n === 1) throw new Error("busy");
      return { answers: { plan: `plan ${n}` } };
    });
    const calm = scripted(() => ({ answers: { plan: "calm" } }));
    const yes = scripted((_req, n) => {
      if (n === 19) throw new Error("late");
      return picks("down", "yes");
    });
    const no = scripted(() => picks("down", "no"));
    const agents = [{ actor: "yes", planner: "eager", prompt: "Stay." }, { actor: "no", planner: "calm" }];
    const log = await runMatch(counters(85, 250, 1), config, agents, { models: from({ eager, calm, yes, no }) });

    const landed = log.events.flatMap((e) => (e.kind === "Call" && e.job === "planner" ? [[e.agent, e.askedTick, e.tick, e.error ?? e.answers?.plan]] : []));
    expect(landed).toEqual([
      ["a0", 0, 1, "plan 0"], ["a1", 0, 1, "calm"], ["a0", 20, 21, "busy"], ["a0", 40, 41, "plan 2"], ["a0", 60, 61, "plan 3"],
      ["a0", 80, 81, "plan 4"], ["a1", 80, 81, "calm"],
    ]);
    // A failed call changes nothing. The planner's at tick 20: the plan of tick 21 is still the one of tick 1.
    // The actor's at tick 19: its `replan: yes` of tick 18 stands, and the planner is asked at tick 20.
    expect([0, 1, 21, 40, 41].map((tick) => plans(yes.asked[tick]!))).toEqual(["Stay.", "plan 0", "plan 0", "plan 0", "plan 2"]);
    const decision = (tick: number) => ({ tick, observation: { count: 0 - tick }, answers: { step: "down" } });
    expect(eager.asked.map((req) => req.state)).toMatchObject([
      { prompt: "Stay.", plan: "Stay.", history: [] },
      { prompt: "Stay.", plan: "plan 0", history: Array.from({ length: 19 }, (_, i) => decision(i)), observation: { count: -20 } },
      { plan: "plan 0", history: Array.from({ length: 20 }, (_, i) => decision(20 + i)) },
      { plan: "plan 2" },
      { plan: "plan 3" },
    ]);
    expect((calm.asked[1]!.state as { history: unknown[] }).history).toEqual(Array.from({ length: 40 }, (_, i) => decision(40 + i))); // the newest 40
  });

  it("a failed call changes nothing and is logged", async () => {
    const flaky = scripted((_req, n) => {
      if (n === 1) throw new Error("boom ".repeat(60));
      return n === 2 ? { answers: { step: "sideways" }, usage: { input_tokens: 8, output_tokens: 1 } } : picks("down");
    });
    const log = await runMatch(counters(6), config, [{ actor: "flaky" }, { actor: "bot/upper" }], { models: from({ flaky }) });
    expect(calls(log, "a0")).toEqual([
      { kind: "Call", tick: 0, agent: "a0", job: "actor", observation: { count: 0 }, answers: { step: "down" } },
      { kind: "Call", tick: 2, agent: "a0", job: "actor", observation: { count: -2 }, error: "boom ".repeat(40) }, // cut to 200 characters
      { kind: "Call", tick: 4, agent: "a0", job: "actor", observation: { count: -4 }, usage: { input_tokens: 8, output_tokens: 1 }, error: "no valid answer" },
    ]);
    expect(counts(log, "a0")).toEqual([0, -1, -2, -3, -4, -5, -6]); // it kept doing what it was doing
    expect(log.events.at(-1)).toEqual({ kind: "End", tick: 6, ranking: ["a1", "a0"] });
  });

  it("a blank plan is no answer: the plan stays", async () => {
    // A decision on every tick of 2.5 s: the planner is asked at ticks 0, 2 and 4.
    const planner = scripted((_req, n) => ({ answers: { plan: n === 0 ? "Up." : "  " } }));
    const actor = scripted(() => picks("down", "yes"));
    const agents = [{ actor: "actor", planner: "planner" }, { actor: "bot/upper" }];
    const log = await runMatch(counters(5, 2500, 1), config, agents, { models: from({ actor, planner }) });
    expect(calls(log, "a0", "planner").map((c) => c.error ?? c.answers?.plan)).toEqual(["Up.", "no valid answer", "the match ended"]);
    expect(actor.asked.map(plans)).toEqual(["", "Up.", "Up.", "Up.", "Up."]);
  });

  it("a job's first call failing ends the match with the error", async () => {
    const broken = () => scripted(() => Promise.reject(new Error("401 no such key")));
    const first = await runMatch(counters(9), config, [{ actor: "bot/upper" }, { actor: "broken" }], { models: from({ broken: broken() }) });
    expect(outline(first)).toEqual(["tick 0", "a0 actor 0", "a1 actor 0 !401 no such key", "tick 1", "end 1 !a1 actor: 401 no such key"]);
    expect(first.events.at(-1)).toEqual({ kind: "End", tick: 1, ranking: [], error: "a1 actor: 401 no such key" });

    const models = from({ ok: scripted(() => picks("down", "no")), broken: broken() });
    const second = await runMatch(counters(9), config, [{ actor: "ok", planner: "broken" }, { actor: "bot/upper" }], { models });
    expect(outline(second).slice(4)).toEqual([
      "tick 2", "a0 planner 2<0 !401 no such key", "tick 3", "end 3 !a0 planner: 401 no such key",
    ]);
  });

  it("Stop ends the match after the tick in progress; calls still out at the end are logged as failed", async () => {
    // A decision on every tick of 2.5 s: the planner is asked at tick 0 and, after 5 s, at tick 2.
    const stop = new AbortController();
    const actor = scripted((_req, n) => (n === 2 && stop.abort(), picks("down", "yes")));
    const planner = scripted(() => ({ answers: { plan: "Down." } }));
    const agents = [{ actor: "actor", planner: "planner" }, { actor: "bot/upper" }];
    const log = await runMatch(counters(9, 2500, 1), config, agents, { models: from({ actor, planner }), signal: stop.signal });
    expect(outline(log)).toEqual([
      "tick 0", "a0 actor 0", "a1 actor 0", "tick 1", "a0 planner 1<0", "a0 actor 1", "a1 actor 1", "tick 2", "a0 actor 2", "a1 actor 2",
      "tick 3", "a0 planner 3<2 !the match ended", "end 3 !stopped",
    ]);
    expect(planner.asked.map((req) => req.signal.aborted)).toEqual([false, true]);
  });

  it("when several endings fall on one tick, the arena's comes first, then the failed first call, then Stop", async () => {
    const stop = new AbortController();
    stop.abort();
    const play = (limit: number) => {
      const models = from({ broken: scripted(() => Promise.reject(new Error("401"))) });
      return runMatch(counters(limit), config, [{ actor: "bot/upper" }, { actor: "broken" }], { models, signal: stop.signal });
    };
    expect(outline(await play(1))).toEqual(["tick 0", "a0 actor 0", "a1 actor 0 !401", "tick 1", "end 1 a0 a1"]);
    expect(outline(await play(9)).at(-1)).toBe("end 1 !a1 actor: 401");
  });

  it("rejects before tick 0 a match that cannot be played", async () => {
    const ok = scripted(() => picks("up"));
    const play = (agents: Agent[], options: MatchOptions = { models: from({ ok }) }) => runMatch(counters(3), config, agents, options);
    await expect(play([{ actor: "ok" }])).rejects.toThrow("2 to 16 agents");
    await expect(play(Array.from({ length: 17 }, () => ({ actor: "ok" })))).rejects.toThrow("2 to 16 agents");
    await expect(play([{ actor: "ok" }, { actor: "bot/toString" }])).rejects.toThrow('no bot "toString"');
    await expect(play([{ actor: "ok" }, { actor: "bot/upper", planner: "ok" }])).rejects.toThrow("a bot has no planner");
    await expect(play([{ actor: "ok" }, { actor: "other" }])).rejects.toThrow('no model "other"');
    await expect(play([{ actor: "ok" }, { actor: "ok" }], {})).rejects.toThrow("options.models is missing");
    await expect(play([{ actor: "ok" }, { actor: "ok", prompt: "x".repeat(601) }])).rejects.toThrow("at most 600 characters");
    expect(ok.asked).toEqual([]);
  });

  it("after tick 0 an exception from the arena or from onEvent ends the match with the error", async () => {
    const bots = [{ actor: "bot/upper" }, { actor: "bot/upper" }];
    const breaks: Arena<Counters, { count: number }> = {
      ...counters(9),
      step(state, answers) {
        if (state.tick === 2) throw new Error("the arena broke");
        return counters(9).step(state, answers);
      },
    };
    expect(outline(await runMatch(breaks, config, bots)).slice(-4)).toEqual(["tick 2", "a0 actor 2", "a1 actor 2", "end 2 !the arena broke"]);

    const seen: string[] = [];
    const onEvent = (event: Event) => {
      seen.push(event.kind);
      if (event.kind === "Tick" && event.tick === 1) throw new Error("the page broke");
    };
    expect(outline(await runMatch(counters(9), config, bots, { onEvent })).slice(-2)).toEqual(["tick 1", "end 1 !the page broke"]);
    expect(seen).toEqual(["Tick", "Call", "Call", "Tick"]);
  });
});

describe("under fake timers", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** `value`, `ms` later. */
  const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const quick = () => scripted(() => picks("down"));

  it("the same scripted match gives the same log twice, the second time with models that answer on a timer", async () => {
    // A decision on every tick of 2.5 s. a0 has a planner and asks for a new plan; a1's third call fails.
    const play = (wait: (ms: number) => Promise<void>) => {
      const actor = scripted(async (req) => (await wait(2), picks(plans(req) === "plan 0" ? "up" : "down", "yes")));
      const planner = scripted(async (_req, n) => (await wait(7), { answers: { plan: `plan ${n}` } }));
      const flaky = scripted(async (_req, n) => {
        if (n === 2) throw new Error("boom");
        return picks("down");
      });
      const agents = [{ actor: "actor", planner: "planner", prompt: "Wait." }, { actor: "flaky" }, { actor: "bot/upper" }];
      return runMatch(counters(6, 2500, 1), config, agents, { models: from({ actor, planner, flaky }) });
    };
    const first = await play(async () => {});
    const again = play((ms) => after(ms, undefined));
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.stringify(await again)).toBe(JSON.stringify(first));
    expect(outline(first).filter((line) => /planner|!/.test(line))).toEqual(["a0 planner 1<0", "a1 actor 2 !boom", "a0 planner 3<2", "a0 planner 5<4"]);
  });

  it("in real time N ticks take N × tickMs, and Stop ends the match within a tick", async () => {
    const stop = new AbortController();
    const at: number[] = []; // when each Tick was logged
    const onEvent = (event: Event) => void (event.kind === "Tick" && at.push(performance.now()));
    const agents = [{ actor: "quick" }, { actor: "quick" }];
    const done = runMatch(counters(1000, 100), config, agents, { realTime: true, models: from({ quick: quick() }), signal: stop.signal, onEvent });
    await vi.advanceTimersByTimeAsync(1000);
    expect(at.map((t) => t - at[0]!)).toEqual(Array.from({ length: 11 }, (_, tick) => tick * 100));
    await vi.advanceTimersByTimeAsync(50);
    stop.abort();
    await vi.advanceTimersByTimeAsync(50);
    const log = await done;
    expect(log.events.at(-1)).toEqual({ kind: "End", tick: 11, ranking: [], error: "stopped" });
    expect(log.events[1]).toEqual({ kind: "Call", tick: 0, agent: "a0", job: "actor", observation: { count: 0 }, answers: { step: "down" }, ms: 0 });
  });

  it("in real time a late loop does not catch up, and still yields to the event loop on every tick", async () => {
    // The step from tick 3 blocks for 170 ms: the wall clock jumps while no timer runs.
    let lag = 0;
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => clock() + lag);
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    const arena = counters(8, 50);
    const blocks: typeof arena = { ...arena, step: (state, answers) => (state.tick === 3 && (lag = 170), arena.step(state, answers)) };
    const at: number[] = []; // when each Tick was logged
    const onEvent = (event: Event) => void (event.kind === "Tick" && at.push(performance.now()));
    const done = runMatch(blocks, config, [{ actor: "quick" }, { actor: "quick" }], { realTime: true, models: from({ quick: quick() }), onEvent });
    await vi.advanceTimersByTimeAsync(350);
    await done;
    expect(at.map((t) => t - at[0]!)).toEqual([0, 50, 100, 150, 370, 371, 420, 470, 520]); // a timeout of 0 takes 1 ms
    expect(timeouts).toHaveBeenCalledTimes(8); // one per tick, the late one included
  });

  it("in real time an actor that takes 180 ms lands late while its agent keeps acting, and is not asked again until it has landed", async () => {
    // Ticks of 50 ms, a decision every 2: the slow actor is asked at ticks 0, 4 and 8, and the match ends at tick 9.
    const slow = scripted((_req, n) => after(180, picks(n === 0 ? "down" : "up")));
    const done = runMatch(counters(9, 50), config, [{ actor: "slow" }, { actor: "quick" }], { realTime: true, models: from({ slow, quick: quick() }) });
    await vi.advanceTimersByTimeAsync(450);
    const log = await done;
    expect(calls(log, "a0")).toEqual([
      { kind: "Call", tick: 3, agent: "a0", job: "actor", askedTick: 0, observation: { count: 0 }, answers: { step: "down" }, ms: 180 },
      { kind: "Call", tick: 7, agent: "a0", job: "actor", askedTick: 4, observation: { count: -1 }, answers: { step: "up" }, ms: 180 },
      { kind: "Call", tick: 9, agent: "a0", job: "actor", askedTick: 8, observation: { count: -3 }, ms: 50, error: "the match ended" },
    ]);
    expect(counts(log, "a0")).toEqual([0, 0, 0, 0, -1, -2, -3, -4, -3, -2]);
    expect(slow.asked.map((req) => req.signal.aborted)).toEqual([false, false, true]);
    expect(calls(log, "a1").map((call) => [call.tick, call.askedTick, call.ms])).toEqual([0, 2, 4, 6, 8].map((tick) => [tick, undefined, 0]));
  });

  it("in real time a slow planner lands at the first decision after it answers, and is not asked again while it is out", async () => {
    // A decision on every tick of 2.5 s. The actor takes 3 s: it is asked at ticks 0, 2, 4 and 6. The planner takes
    // 12 s: it is due again from tick 2 on, lands at tick 5 and only then is asked again.
    const planner = scripted(() => after(12_000, { answers: { plan: "Go up." } }));
    const actor = scripted(() => after(3_000, picks("down", "yes")));
    const agents = [{ actor: "actor", planner: "planner", prompt: "Go down." }, { actor: "quick" }];
    const done = runMatch(counters(7, 2500, 1), config, agents, { realTime: true, models: from({ actor, planner, quick: quick() }) });
    await vi.advanceTimersByTimeAsync(17_500);
    const log = await done;
    expect(calls(log, "a0", "planner")).toEqual([
      { kind: "Call", tick: 5, agent: "a0", job: "planner", askedTick: 0, observation: { count: 0 }, answers: { plan: "Go up." }, ms: 12_000 },
      { kind: "Call", tick: 7, agent: "a0", job: "planner", askedTick: 5, observation: { count: -4 }, ms: 5_000, error: "the match ended" },
    ]);
    expect(actor.asked.map(plans)).toEqual(["Go down.", "Go down.", "Go down.", "Go up."]);
    // The history holds the tick at which each observation was shown, not the tick its answer landed.
    expect((planner.asked[1]!.state as { history: unknown[] }).history).toEqual([
      { tick: 0, observation: { count: 0 }, answers: { step: "down" } },
      { tick: 2, observation: { count: -1 }, answers: { step: "down" } },
    ]);
  });

  it("in real time an answer that arrived before the end is logged with it", async () => {
    // Ticks of 50 ms, a decision every 10: the plan arrives after 120 ms and the match ends at tick 7, before it lands.
    const planner = scripted(() => after(120, { answers: { plan: "Go up." } }));
    const agents = [{ actor: "quick", planner: "planner" }, { actor: "quick" }];
    const done = runMatch(counters(7, 50, 10), config, agents, { realTime: true, models: from({ planner, quick: quick() }) });
    await vi.advanceTimersByTimeAsync(400);
    expect(calls(await done, "a0", "planner")).toEqual([
      { kind: "Call", tick: 7, agent: "a0", job: "planner", askedTick: 0, observation: { count: 0 }, answers: { plan: "Go up." }, ms: 120 },
    ]);
  });

  it("in real time a call out for 30 s is given up", async () => {
    const silent = scripted(() => new Promise(() => {}));
    const agents = [{ actor: "silent" }, { actor: "quick" }];
    const done = runMatch(counters(99, 1000, 1), config, agents, { realTime: true, models: from({ silent, quick: quick() }) });
    await vi.advanceTimersByTimeAsync(31_000);
    const log = await done;
    expect(calls(log, "a0")).toEqual([
      { kind: "Call", tick: 30, agent: "a0", job: "actor", askedTick: 0, observation: { count: 0 }, ms: 31_000, error: "no answer in 30 s" },
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "End", tick: 31, ranking: [], error: "a0 actor: no answer in 30 s" });
    expect(silent.asked[0]!.signal.aborted).toBe(true);
  });
});
