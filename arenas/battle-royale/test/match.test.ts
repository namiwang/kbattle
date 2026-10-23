import {
  callsOf,
  eventsOfKind,
  modelError,
  parseMatchLogFor,
  QUESTION_TYPES,
  replayMatch,
  roundTo,
  runMatch,
  type AgentSpec,
  type Answers,
  type AskRequest,
  type CallEvent,
  type MatchLogFor,
  type Model,
  type Reply,
} from "@decision-arena/core";
import { getMap, normalizeDeg, type MoveChoice, type TurnChoice, type WorldState } from "@decision-arena/kit-shooter";
import { beforeAll, describe, expect, it } from "vitest";
import { battleRoyale, createBattleRoyale, rankAgents, type BattleRoyaleTypes } from "../src";
import { OPEN, SIXTEEN_BOTS } from "./helpers";

// The match loop over the battle royale (moved from the kit's version-1 loop
// tests, kits/shooter/test/sim/match.test.ts, in R0.4; DESIGN.md §5.2, §5.5;
// rulings R1, R8–R12, R22): spawn, then per tick the planner replies that landed,
// the actor calls when due (raced against their timeout), the step and its Tick;
// MatchEnd with the R11 ranking, or ranking [] when cancelled. The bots are the
// arena's Models; scripted minds are test Models on an open map.

type Log = MatchLogFor<BattleRoyaleTypes>;

/** v1.5 exit: 16 bots, 8 wanderers and 8 campers, on map-1, seed 7, the default 6,000 ticks. */
const SIXTEEN = { seed: 7, durationTicks: 6000, mapId: "map-1" };

/** The arena with an open map: nothing blocks a walk from a spawn toward the center. */
const arena = createBattleRoyale([OPEN]);
const openConfig = (durationTicks: number) => ({ seed: 3, durationTicks, mapId: "open" });

const USAGE = { inputTokens: 40, outputTokens: 12 };

/** Crisp answers to the actor's questions. */
function answers(move: MoveChoice, turn: TurnChoice = "none", fire = false): Answers {
  const crisp = (choice: string) => ({ type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 });
  return { move: crisp(move), turn: crisp(turn), fire: { type: "noul", noul: fire ? 1 : 0 } };
}
const reply = (a: Answers, model = "test"): Reply => ({ ok: true, answers: a, usage: USAGE, model });

/** A model whose n-th call (from 0) gets script(req, n). */
function scripted(id: string, script: (req: AskRequest, n: number) => Reply | Promise<Reply>): Model {
  let n = 0;
  return { id, supports: new Set(QUESTION_TYPES), ask: (req) => Promise.resolve(script(req, n++)) };
}
/** Always stands still. */
const still = () => scripted("dummy/still", () => reply(answers("stop")));
const player = (actor: string, planner?: string): AgentSpec => ({
  arena: "battle-royale",
  roles: planner === undefined ? { actor: { model: actor } } : { actor: { model: actor }, planner: { model: planner } },
  prompts: { planner: "", actor: {} },
});
/** deps.models over a list of models, by id. */
const resolver = (...models: Model[]) => (id: string) => models.find((model) => model.id === id);

/** a0 is played by `first`, a1 stands still. */
const firstIs = (first: Model) => ({ agents: [player(first.id), player("dummy/still")], models: resolver(first, still()) });

const actorCalls = (log: Log, agent: string) => callsOf(log, agent, "actor");

/** An agent's [x, y] in every Tick, by tick. */
const pathOf = (log: Log, agent: string) => eventsOfKind(log, "Tick").map((t) => t.data.agents.find(([id]) => id === agent)?.slice(1, 3));

const due = (tick: number) => (tick - 1) % 10 === 0;

describe("runMatch: 16 bots on map-1, seed 7, 6,000 ticks (v1.5 exit)", () => {
  let log: Log;
  let wallMs: number;
  let final: WorldState;

  beforeAll(async () => {
    const started = performance.now();
    log = await runMatch(battleRoyale, SIXTEEN, SIXTEEN_BOTS, {
      onTick: (_tick, state) => {
        final = state;
      },
    });
    wallMs = performance.now() - started;
  }, 30_000);

  it("completes, and its log is what parseMatchLogFor reads from its file", () => {
    expect(parseMatchLogFor(battleRoyale, JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(log).toMatchObject({ version: 2, arena: "battle-royale", mode: "solo", config: SIXTEEN, agents: SIXTEEN_BOTS });
  });

  it("runs faster than real time: under 10 s of wall time (DESIGN.md §8 P1)", () => {
    expect(wallMs).toBeLessThan(10_000);
  });

  it("is at most 5 MB as compact JSON (DESIGN.md §5.3 budget)", () => {
    expect(Buffer.byteLength(JSON.stringify(log))).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("starts with a Spawn per agent on map-1's spawns and Tick(0), then has one Tick per tick (R1)", () => {
    const spawns = log.events.slice(0, 16);
    expect(spawns.map((e) => [e.kind, e.tick, e.kind === "Spawn" && e.agent])).toEqual(Array.from({ length: 16 }, (_, i) => ["Spawn", 0, `a${i}`]));
    for (const e of eventsOfKind(log, "Spawn")) expect(getMap("map-1").spawns).toContainEqual(e.pos);
    expect(log.events[16]).toMatchObject({ kind: "Tick", tick: 0 });
    const end = log.events.at(-1)!;
    expect(eventsOfKind(log, "Tick").map((t) => t.tick)).toEqual(Array.from({ length: end.tick + 1 }, (_, t) => t));
  });

  it("keeps ticks in order and ends with one MatchEnd, right after the last Tick", () => {
    const ticks = log.events.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(eventsOfKind(log, "MatchEnd")).toHaveLength(1);
    const [lastTick, end] = log.events.slice(-2);
    expect([lastTick?.kind, end?.kind, end?.tick]).toEqual(["Tick", "MatchEnd", lastTick?.tick]);
  });

  it("ends when one agent is left or at durationTicks, whichever comes first (R11)", () => {
    const ticks = eventsOfKind(log, "Tick");
    const end = ticks.at(-1)!;
    expect(end.data.agents.length <= 1 || end.tick === SIXTEEN.durationTicks).toBe(true);
    for (const t of ticks.slice(0, -1)) expect(t.data.agents.length, `tick ${t.tick}`).toBeGreaterThanOrEqual(2);
  });

  it("logs an actor Call for every living agent on ticks 1, 11, 21, … and on no other tick, every one answered", () => {
    const deathTick = new Map(eventsOfKind(log, "Death").map((d) => [d.agent, d.tick]));
    const end = log.events.at(-1)!.tick;
    for (let slot = 0; slot < 16; slot++) {
      const id = `a${slot}`;
      const last = deathTick.get(id) ?? end; // it decides on its death tick: it was alive when the tick began
      const expected = Array.from({ length: last }, (_, i) => i + 1).filter(due);
      expect(actorCalls(log, id).map((e) => e.tick), id).toEqual(expected);
    }
    expect(eventsOfKind(log, "Call").every((e) => e.ok && e.role === "actor")).toBe(true);
  });

  it("puts a tick's Calls before its step events and its Tick, in slot order", () => {
    const byTick = new Map<number, { kind: string; agent?: unknown }[]>();
    for (const e of log.events) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
    for (const [tick, events] of byTick) {
      if (tick === 0) continue;
      const kinds = events.map((e) => e.kind);
      const firstStep = kinds.findIndex((k) => k === "Shot" || k === "Hit" || k === "Death" || k === "Tick");
      expect(kinds.slice(0, firstStep).every((k) => k === "Call"), `tick ${tick}`).toBe(true);
      expect(kinds.slice(firstStep).includes("Call"), `tick ${tick}`).toBe(false);
      const order = events.flatMap((e) => (e.kind === "Call" ? [Number(String(e.agent).slice(1))] : []));
      expect(order, `tick ${tick}`).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("drops each dead agent from Tick rows from its death tick on", () => {
    const deaths = eventsOfKind(log, "Death");
    expect(deaths.length).toBeGreaterThan(0);
    for (const tick of eventsOfKind(log, "Tick")) {
      for (const death of deaths) {
        const listed = tick.data.agents.some(([id]) => id === death.agent);
        expect(listed, `${death.agent} at tick ${tick.tick}`).toBe(tick.tick < death.tick);
      }
    }
  });

  it("rounds Tick numbers as R10 says: x, y to 2 decimals, facing to 1 in (-180, 180], hp whole", () => {
    const twoDecimals = (v: number) => roundTo(v, 2) === v;
    for (const tick of eventsOfKind(log, "Tick")) {
      for (const [id, x, y, facing, hp] of tick.data.agents) {
        const where = `${id} at tick ${tick.tick}`;
        expect(twoDecimals(x) && twoDecimals(y), where).toBe(true);
        expect(normalizeDeg(roundTo(facing, 1)), where).toBe(facing);
        expect(facing > -180 && facing <= 180, where).toBe(true);
        expect(Number.isInteger(hp), where).toBe(true);
      }
      for (const [id, x, y] of tick.data.bullets) expect(twoDecimals(x) && twoDecimals(y), id).toBe(true);
      for (const [id, x, y] of tick.data.near ?? []) expect(twoDecimals(x) && twoDecimals(y), id).toBe(true);
    }
  });

  it("writes near misses into Tick rows only when there are some (ISSUES I-016)", () => {
    const withNear = eventsOfKind(log, "Tick").filter((t) => t.data.near !== undefined);
    expect(withNear.length).toBeGreaterThan(0);
    for (const t of withNear) expect(t.data.near!.length, `tick ${t.tick}`).toBeGreaterThan(0);
  });

  it("ranks the survivors first, then the dead by how late they died (R11)", () => {
    const end = eventsOfKind(log, "MatchEnd")[0]!;
    const deaths = eventsOfKind(log, "Death");
    const survivors = eventsOfKind(log, "Tick").at(-1)!.data.agents.map(([id]) => id);
    expect([...end.ranking].sort()).toEqual(Array.from({ length: 16 }, (_, i) => `a${i}`).sort());
    expect(end.ranking.slice(0, survivors.length).sort()).toEqual([...survivors].sort());
    const deadOrder = end.ranking.slice(survivors.length).map((id) => deaths.find((d) => d.agent === id)!.tick);
    expect(deadOrder).toEqual([...deadOrder].sort((a, b) => b - a));
    expect(end.ranking).toEqual(rankAgents(final.agents));
    expect(end).not.toHaveProperty("results");
  });
});

describe("runMatch: faults (R12, principle 5)", () => {
  it("logs a model that rejects or throws as a failed Call with its message; the agent keeps its action", async () => {
    const flaky = scripted("dummy/flaky", (_req, n) => {
      if (n === 0) return reply(answers("forward"));
      if (n === 1) return Promise.reject(new Error("boom"));
      if (n === 2) throw "nope"; // a synchronous throw, and not an Error
      return Promise.reject(new Error("")); // no message: the error's name stands in
    });
    const { agents, models } = firstIs(flaky);
    const log = await runMatch(arena, openConfig(40), agents, { models });
    expect(parseMatchLogFor(arena, JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(actorCalls(log, "a0").map((call) => (call.ok ? "ok" : call.error))).toEqual([
      "ok",
      { kind: "invalid_output", fatal: false, message: "ask failed: boom" },
      { kind: "invalid_output", fatal: false, message: "ask failed: nope" },
      { kind: "invalid_output", fatal: false, message: "ask failed: Error" },
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 40, ranking: ["a0", "a1"] });
    const path = pathOf(log, "a0");
    for (let t = 1; t <= 40; t++) expect(path[t], `tick ${t}`).not.toEqual(path[t - 1]); // walked on through every fault
  });

  it("times out a call that never settles after deps.timeoutMs; the agent keeps its action and the match goes on", async () => {
    const hangs = scripted("dummy/hangs", (_req, n) => (n === 0 ? reply(answers("forward")) : new Promise<Reply>(() => {})));
    const { agents, models } = firstIs(hangs);
    const log = await runMatch(arena, openConfig(25), agents, { models, timeoutMs: () => 5 });
    expect(actorCalls(log, "a0").map((e) => [e.tick, e.ok, e.error?.message])).toEqual([
      [1, true, undefined],
      [11, false, "no answer within 5 ms"],
      [21, false, "no answer within 5 ms"],
    ]);
    expect(actorCalls(log, "a0")[1]?.error?.kind).toBe("timeout");
    expect(actorCalls(log, "a1").every((e) => e.ok)).toBe(true);
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: 25 });
    const path = pathOf(log, "a0");
    expect(path[25]).not.toEqual(path[11]);
  });

  it("gives each call its own signal and aborts it when the loop stops waiting for it, at the timeout (R17)", async () => {
    const calls: { signal: AbortSignal; told: boolean }[] = [];
    const hangs = scripted("dummy/hangs", (req, n) => {
      const call = { signal: req.signal, told: false };
      calls.push(call);
      req.signal.addEventListener("abort", () => (call.told = true), { once: true });
      return n === 0 ? reply(answers("forward")) : new Promise<Reply>(() => {});
    });
    const { agents, models } = firstIs(hangs);
    const log = await runMatch(arena, openConfig(12), agents, { models, timeoutMs: () => 5 });
    expect(actorCalls(log, "a0").map((e) => e.error?.message)).toEqual([undefined, "no answer within 5 ms"]);
    expect(calls.map((c) => [c.signal.aborted, c.told])).toEqual([
      [false, false], // answered in time: never aborted
      [true, true],
    ]);
    expect(calls[0]?.signal).not.toBe(calls[1]?.signal);
    expect(calls[1]?.signal.reason).toMatchObject({ name: "TimeoutError" });
  });

  it("logs a reply that is not a Reply, or has no answers, as invalid_output instead of applying it", async () => {
    const broken = scripted("dummy/broken", (_req, n) => (n === 0 ? ({ model: "x" } as unknown as Reply) : ({ ok: true, usage: USAGE, model: "x" } as Reply)));
    const { agents, models } = firstIs(broken);
    const log = await runMatch(arena, openConfig(12), agents, { models });
    expect(actorCalls(log, "a0").map((call) => [call.ok, call.error?.kind, call.error?.message.split(":")[0]])).toEqual([
      [false, "invalid_output", "invalid reply"],
      [false, "invalid_output", "invalid answer"],
    ]);
    expect(actorCalls(log, "a0")[1]?.error?.message).toBe("invalid answer: answers: Invalid input: expected record, received undefined");
    expect(new Set(pathOf(log, "a0").map((p) => JSON.stringify(p))).size).toBe(1); // never moved
  });

  it("logs answers the check rejects as 'invalid answer: <path>: <message>'; the agent keeps its action and the log parses (R16)", async () => {
    const provider = scripted("dummy/odd", (_req, n) => {
      if (n === 0) return reply(answers("forward"));
      if (n === 1) return reply({ ...answers("stop"), fire: { type: "noul", noul: 1.5 } });
      // A choice without its `type`.
      return { ok: true, answers: { ...answers("stop"), move: { choice: "stop", probabilities: { stop: 1 }, confidence: 1 } }, usage: USAGE, model: "test" } as unknown as Reply;
    });
    const { agents, models } = firstIs(provider);
    const log = await runMatch(arena, openConfig(25), agents, { models });
    expect(parseMatchLogFor(arena, JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(actorCalls(log, "a0").map((e) => [e.tick, e.ok, e.error?.message])).toEqual([
      [1, true, undefined],
      [11, false, "invalid answer: fire.noul: Too big: expected number to be <=1"],
      [21, false, 'invalid answer: move.type: Invalid input: expected "choice"'],
    ]);
    const path = pathOf(log, "a0");
    for (let t = 12; t <= 25; t++) expect(path[t], `tick ${t}`).not.toEqual(path[t - 1]); // the answers of tick 1 stand: still walking
  });

  it("rounds probabilities, confidence and P(yes) to 4 decimals and keeps only the questions' answers, in their order, before logging and acting (R16, ISSUES I-018, I-032)", async () => {
    const precise = scripted("dummy/precise", () => ({
      ok: true,
      usage: USAGE,
      model: "precise-v1",
      answers: {
        escalate: { type: "noul", noul: 0.1234567891 },
        move: {
          type: "choice",
          choice: "forward",
          probabilities: { forward: 0.6123456789, back: 0.0969135803, left: 0.0969135803, right: 0.0969135803, stop: 0.0969135802 },
          confidence: 0.6123456789,
          reasoning: "not part of an answer",
        },
        fire: { type: "noul", noul: 0.4999999999 },
        mood: { type: "noul", noul: 1 },
      } as unknown as Answers,
    }));
    const { agents, models } = firstIs(precise);
    const log = await runMatch(arena, openConfig(12), agents, { models });
    expect(actorCalls(log, "a0")[0]?.answers).toEqual({
      move: { type: "choice", choice: "forward", probabilities: { forward: 0.6123, back: 0.0969, left: 0.0969, right: 0.0969, stop: 0.0969 }, confidence: 0.6123 },
      fire: { type: "noul", noul: 0.5 }, // rounded to 0.5, FIRE_THRESHOLD: it fires (version 1 read P(yes) unrounded and held fire)
      escalate: { type: "noul", noul: 0.1235 },
    });
    expect(Object.keys(actorCalls(log, "a0")[0]?.answers ?? {})).toEqual(["move", "fire", "escalate"]); // the questions' order
    expect(eventsOfKind(log, "Shot").map((shot) => shot.agent)).toContain("a0");
    expect(JSON.stringify(await replayMatch(arena, log))).toBe(JSON.stringify(log));
  });
});

describe("runMatch: cancel (signal)", () => {
  it("an already aborted signal gives Spawn events, Tick(0) and MatchEnd(0) with ranking []", async () => {
    const log = await runMatch(arena, openConfig(100), [player("dummy/still"), player("dummy/still")], { models: resolver(still()), signal: AbortSignal.abort() });
    expect(log.events.map((e) => [e.kind, e.tick])).toEqual([
      ["Spawn", 0],
      ["Spawn", 0],
      ["Tick", 0],
      ["MatchEnd", 0],
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 0, ranking: [] });
    expect(parseMatchLogFor(arena, JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("aborting during a tick ends the match after that tick's Tick, with ranking []", async () => {
    const controller = new AbortController();
    const log = await runMatch(battleRoyale, SIXTEEN, SIXTEEN_BOTS, { signal: controller.signal, onTick: (tick) => tick === 40 && controller.abort() });
    expect(parseMatchLogFor(battleRoyale, JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(log.events.slice(-2).map((e) => [e.kind, e.tick])).toEqual([
      ["Tick", 40],
      ["MatchEnd", 40],
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 40, ranking: [] });
  });

  it("cuts a call in flight short: logged as aborted, the tick completes, the match ends at once", async () => {
    const controller = new AbortController();
    const hangs = scripted("dummy/hangs", (_req, n) => (n === 0 ? reply(answers("forward")) : new Promise<Reply>(() => {})));
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    const { agents, models } = firstIs(hangs);
    const log = await runMatch(arena, openConfig(100), agents, { models, timeoutMs: () => 60_000, signal: controller.signal });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(log.events.slice(-4)).toEqual([
      { kind: "Call", tick: 11, requestedTick: 11, agent: "a0", role: "actor", model: "dummy/hangs", ok: false, error: { kind: "aborted", fatal: false, message: "the match was cancelled" } },
      { kind: "Call", tick: 11, requestedTick: 11, agent: "a1", role: "actor", model: "test", ok: true, answers: answers("stop"), usage: USAGE },
      expect.objectContaining({ kind: "Tick", tick: 11 }),
      { kind: "MatchEnd", tick: 11, ranking: [] },
    ]);
  });

  it("aborts the signals of the match's calls when it is cancelled: the call in flight and those already answered (R17)", async () => {
    const controller = new AbortController();
    const signals = new Map<string, AbortSignal>();
    let tick = 1;
    const model = (agent: string, hangsAt11: boolean) =>
      scripted(`dummy/${agent}`, (req) => {
        signals.set(`${agent}@${tick}`, req.signal);
        if (!hangsAt11 || tick !== 11) return reply(answers("stop"));
        setTimeout(() => controller.abort(), 5);
        return new Promise<Reply>(() => {});
      });
    let before: boolean[] = [];
    const log = await runMatch(arena, openConfig(100), [player("dummy/a0"), player("dummy/a1")], {
      models: resolver(model("a0", true), model("a1", false)),
      timeoutMs: () => 60_000,
      signal: controller.signal,
      onTick: (t) => {
        tick = t + 1;
        if (t === 10) before = [...signals.values()].map((s) => s.aborted);
      },
    });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 11, ranking: [] });
    expect(before).toEqual([false, false]); // tick 1's calls, answered, while the match ran on
    expect([...signals].map(([call, signal]) => [call, signal.aborted])).toEqual([
      ["a0@1", true],
      ["a1@1", true],
      ["a0@11", true],
      ["a1@11", true],
    ]);
  });

  it("a cancel between due ticks reaches the models too, through their latest calls' signals (R17)", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const spy = scripted("dummy/spy", (req) => {
      signals.push(req.signal);
      return reply(answers("stop"));
    });
    await runMatch(arena, openConfig(100), [player("dummy/spy"), player("dummy/spy")], {
      models: resolver(spy),
      signal: controller.signal,
      onTick: (tick) => tick === 15 && controller.abort(),
    });
    expect(signals.map((s) => s.aborted)).toEqual([true, true, true, true]); // ticks 1 and 11, two agents each
  });

  it("does not wait out the wall floor once cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    const log = await runMatch(arena, openConfig(100), [player("dummy/still"), player("dummy/still")], {
      models: resolver(still()),
      minWallMsPerTick: 60_000,
      signal: controller.signal,
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(log.events.slice(-2).map((e) => [e.kind, e.tick])).toEqual([
      ["Tick", 1],
      ["MatchEnd", 1],
    ]);
  });
});

describe("runMatch: the planner (row 31, R22.f; the version-1 thinker events)", () => {
  /** A planner that answers `plan` once tick `after` is logged, then refuses. */
  function planner(after: number, plan: string, ticks: { at: number; go: () => void }[]) {
    return scripted("dummy/planner", (_req, n) =>
      n === 0
        ? new Promise<void>((go) => ticks.push({ at: after, go })).then(() => ({
            ok: true as const,
            answers: { plan: { type: "text" as const, text: plan }, scratchpad: { type: "text" as const, text: "" } },
            usage: USAGE,
            model: "planner-v1",
          }))
        : { ok: false, error: modelError("refusal", "I would rather not") },
    );
  }

  it("lands a planner reply at the start of a tick, slot by slot, before that tick's actor calls", async () => {
    const ticks: { at: number; go: () => void }[] = [];
    const p0 = planner(10, "Go north.", ticks);
    const p1 = { ...planner(4, "Hold.", ticks), id: "dummy/planner1" };
    const log = await runMatch(arena, openConfig(21), [player("dummy/still", "dummy/planner"), player("dummy/still", "dummy/planner1")], {
      models: resolver(still(), p0, p1),
      onTick: (tick) => ticks.filter((t) => t.at === tick).forEach((t) => t.go()),
    });
    const atTick = (t: number) => log.events.filter((e) => e.tick === t).map((e) => [e.kind, "agent" in e ? e.agent : "-", "role" in e ? e.role : "-"]);
    expect(atTick(5)).toEqual([
      ["Call", "a1", "planner"],
      ["Tick", "-", "-"],
    ]);
    expect(atTick(11)).toEqual([
      ["Call", "a0", "planner"],
      ["Call", "a0", "actor"],
      ["Call", "a1", "actor"],
      ["Tick", "-", "-"],
    ]);
    expect(parseMatchLogFor(arena, JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("gives the actor the agent's latest plan; a failed planner call keeps the old one", async () => {
    const ticks: { at: number; go: () => void }[] = [];
    const states: { plan: string }[] = [];
    const spy = scripted("dummy/spy", (req) => {
      states.push(req.state as { plan: string });
      return reply({ ...answers("stop"), escalate: { type: "noul", noul: 1 } }); // escalates: the planner is asked again at 101
    });
    const log = await runMatch(arena, openConfig(125), [player("dummy/spy", "dummy/planner"), player("dummy/still")], {
      models: resolver(spy, still(), planner(3, "Go north.", ticks)),
      onTick: (tick) => ticks.filter((t) => t.at === tick).forEach((t) => t.go()),
    });
    expect(callsOf(log, "a0", "planner").map((call) => [call.requestedTick, call.tick, call.ok])).toEqual([
      [1, 4, true],
      [101, 102, false],
    ]);
    expect(states.map((state) => state.plan)).toEqual(["", ...Array.from({ length: 12 }, () => "Go north.")]); // ticks 1, 11, …, 121
  });

  it("logs a planner reply as the schemas read it: unknown keys dropped, numbers of no question left out", async () => {
    const sloppy = scripted("dummy/sloppy", () => ({
      ok: true,
      usage: { inputTokens: 5, outputTokens: 1, cached: 3 },
      model: "sloppy",
      answers: { scratchpad: { type: "text", text: "s", tone: "dry" }, plan: { text: "p", type: "text" }, mood: { type: "noul", noul: 1 } },
    }) as unknown as Reply);
    const log = await runMatch(arena, openConfig(5), [player("dummy/still", "dummy/sloppy"), player("dummy/still")], { models: resolver(still(), sloppy) });
    expect(callsOf(log, "a0", "planner")[0]).toMatchObject({
      ok: true,
      answers: { plan: { type: "text", text: "p" }, scratchpad: { type: "text", text: "s" } },
      usage: { inputTokens: 5, outputTokens: 1 },
    });
    expect(JSON.stringify(callsOf(log, "a0", "planner")[0])).not.toMatch(/tone|cached|mood/);
  });
});

describe("runMatch: cadence, models and the clock", () => {
  it("resolves one model per role per agent, once per match, in slot order; bots through the arena", async () => {
    const made: [string, object][] = [];
    await runMatch(arena, openConfig(30), [player("dummy/a", "dummy/p"), player("dummy/b"), { ...SIXTEEN_BOTS[1]! }], {
      models: (id, ctx) => {
        made.push([id, ctx]);
        return still();
      },
    });
    expect(made).toEqual([
      ["dummy/a", { slot: 0, role: "actor", seed: 3 }],
      ["dummy/p", { slot: 0, role: "planner", seed: 3 }],
      ["dummy/b", { slot: 1, role: "actor", seed: 3 }],
    ]);
  });

  it("asks each living agent once per due tick, with its view of the world before that tick's step", async () => {
    const asked: { tick: number; agent: string; req: AskRequest }[] = [];
    let tick = 1;
    const spy = (agent: string) =>
      scripted(`dummy/${agent}`, (req) => {
        asked.push({ tick, agent, req });
        return reply(answers("forward"));
      });
    const states: WorldState[] = [];
    await runMatch(arena, openConfig(30), [player("dummy/a0"), player("dummy/a1")], {
      models: resolver(spy("a0"), spy("a1")),
      onTick: (t, s) => {
        tick = t + 1;
        states.push(s);
      },
    });
    expect(asked.map((c) => [c.tick, c.agent])).toEqual([
      [1, "a0"],
      [1, "a1"],
      [11, "a0"],
      [11, "a1"],
      [21, "a0"],
      [21, "a1"],
    ]);
    for (const { tick: t, agent, req } of asked) {
      const before = states[t - 1]!.agents.find((a) => a.id === agent)!;
      const observation = (req.state as { observation: { self: { pos: unknown } } }).observation;
      expect(observation.self.pos, `${agent} at ${t}`).toEqual({ x: roundTo(before.pos.x, 2), y: roundTo(before.pos.y, 2) });
    }
  });

  it("calls onTick after every Tick event, tick 0 included, with that tick's world", async () => {
    const seen: [number, number][] = [];
    const log = await runMatch(arena, openConfig(12), [player("dummy/still"), player("dummy/still")], { models: resolver(still()), onTick: (t, s) => seen.push([t, s.tick]) });
    expect(seen).toEqual(eventsOfKind(log, "Tick").map((t) => [t.tick, t.tick]));
    expect(seen).toHaveLength(13);
  });

  it("steps at least minWallMsPerTick apart in wall time, and the log does not depend on it (row 31)", async () => {
    const agents = [player("dummy/still"), player("dummy/still")];
    const plain = await runMatch(arena, openConfig(8), agents, { models: resolver(still()) });
    const at: number[] = [];
    const floored = await runMatch(arena, openConfig(8), agents, { models: resolver(still()), minWallMsPerTick: 15, onTick: () => at.push(performance.now()) });
    expect(at).toHaveLength(9);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `tick ${i - 1} to ${i}`).toBeGreaterThanOrEqual(14.5);
    expect(JSON.stringify(floored)).toBe(JSON.stringify(plain));
  });

  it("rejects a config or agents that do not validate before anything runs", async () => {
    const agents = [player("dummy/still"), player("dummy/still")];
    const models = resolver(still());
    await expect(runMatch(arena, { ...openConfig(10), durationTicks: 0 }, agents, { models })).rejects.toThrow(/durationTicks/);
    await expect(runMatch(battleRoyale, openConfig(10), agents, { models })).rejects.toThrow(/mapId/);
    await expect(runMatch(arena, openConfig(10), [player("dummy/still"), { ...player("dummy/still"), arena: "racing" }], { models })).rejects.toThrow(/"racing"/);
    await expect(runMatch(arena, openConfig(10), [player("dummy/still"), player("dummy/still")], { models, mode: "duo" })).rejects.toThrow(/duo/);
  });

  it("logs actor Calls with their answers or error and usage, never their questions or input (ISSUES I-018)", async () => {
    const log = await runMatch(battleRoyale, { ...SIXTEEN, durationTicks: 30 }, SIXTEEN_BOTS);
    for (const call of eventsOfKind(log, "Call") as CallEvent[]) {
      expect(Object.keys(call)).toEqual(["kind", "tick", "requestedTick", "agent", "role", "model", "ok", "answers", "usage"]);
    }
  });
});
