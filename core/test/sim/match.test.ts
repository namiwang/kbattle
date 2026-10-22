import { beforeAll, describe, expect, it } from "vitest";
import { normalizeDeg } from "../../src/angles";
import { botProviders } from "../../src/bots";
import { DOER_INTERVAL_TICKS, MATCH_DURATION_TICKS } from "../../src/constants";
import { eventsOfKind } from "../../src/log";
import { getMap } from "../../src/maps";
import {
  MatchLogSchema,
  type DoerAnswer,
  type Event,
  type MapSpec,
  type MatchConfig,
  type MatchLog,
  type Prompts,
  type Slot,
} from "../../src/schemas";
import { rankAgents, runMatch } from "../../src/sim/match";
import { replayMatch } from "../../src/sim/replay-provider";
import type { DecisionContext, DecisionProvider } from "../../src/sim/providers";
import { roundTo } from "../../src/sim/round";
import type { MoveChoice, TurnChoice, WorldState } from "../../src/types";
import { makeAgent } from "./helpers";

// The match loop (v1.5; DESIGN.md §5.1, §5.2, §5.3; sim rulings R1, R8–R12):
// spawn, then per tick: thinker events, doer calls when due (raced against the
// timeout), step, Tick; MatchEnd with the R11 ranking, or ranking [] when cancelled.

const PROMPTS: Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };

/** v1.5 exit: 16 bots, 8 wanderers and 8 campers, on arena-1, seed 7, the default 6,000 ticks. */
const SIXTEEN: MatchConfig = {
  mapId: "arena-1",
  seed: 7,
  durationTicks: MATCH_DURATION_TICKS,
  slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
};

/** An open arena: nothing blocks a walk from a spawn toward the center. */
const OPEN: MapSpec = {
  id: "open",
  width: 100,
  height: 100,
  obstacles: [],
  spawns: [
    { x: 20, y: 50 },
    { x: 80, y: 50 },
    { x: 50, y: 20 },
  ],
};

/** Two scripted minds on the open arena. */
const openConfig = (durationTicks: number): MatchConfig => ({
  mapId: "open",
  seed: 3,
  durationTicks,
  slots: [{ kind: "doer" }, { kind: "doer" }],
});

/** A crisp Clef-shaped answer. */
function answer(move: MoveChoice, turn: TurnChoice = "none", fire = false): DoerAnswer {
  const crisp = <T extends string>(choice: T) => ({ type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 });
  return {
    model: "test",
    answers: { move: crisp(move), turn: crisp(turn), fire: { type: "noul", noul: fire ? 1 : 0 }, escalate: { type: "noul", noul: 0 } },
  };
}

/** Always stands still. */
const still: DecisionProvider = { decide: () => Promise.resolve(answer("stop")) };

/** a0 gets `first`, everyone else stands still. */
const firstIs = (first: DecisionProvider) => (_slot: Slot, slotIndex: number) => (slotIndex === 0 ? first : still);

const doerOf = (log: MatchLog, agent: string) => eventsOfKind(log, "Doer").filter((e) => e.agent === agent);

/** An agent's [x, y] in every Tick, by tick. */
const pathOf = (log: MatchLog, agent: string) =>
  eventsOfKind(log, "Tick").map((t) => t.agents.find(([id]) => id === agent)?.slice(1, 3));

const due = (tick: number) => (tick - 1) % DOER_INTERVAL_TICKS === 0;

describe("runMatch: 16 bots on arena-1, seed 7, 6,000 ticks (v1.5 exit)", () => {
  let log: MatchLog;
  let wallMs: number;
  let final: WorldState;

  beforeAll(async () => {
    const started = performance.now();
    log = await runMatch(SIXTEEN, {
      providers: botProviders(SIXTEEN.seed),
      prompts: PROMPTS,
      onTick: (_tick, state) => {
        final = state;
      },
    });
    wallMs = performance.now() - started;
  }, 30_000);

  it("completes, and its log passes MatchLogSchema unchanged", () => {
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(log).toMatchObject({ version: 1, config: SIXTEEN, seed: 7, prompts: PROMPTS });
  });

  it("runs faster than real time: under 10 s of wall time (DESIGN.md §8 P1)", () => {
    expect(wallMs).toBeLessThan(10_000);
  });

  it("is at most 5 MB as compact JSON (DESIGN.md §5.3 budget)", () => {
    expect(Buffer.byteLength(JSON.stringify(log))).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("starts with a Spawn per agent on arena-1's spawns and Tick(0), then has one Tick per tick (R1)", () => {
    const spawns = log.events.slice(0, 16);
    expect(spawns.map((e) => [e.kind, e.tick, e.kind === "Spawn" && e.agent])).toEqual(
      Array.from({ length: 16 }, (_, i) => ["Spawn", 0, `a${i}`]),
    );
    for (const e of eventsOfKind(log, "Spawn")) expect(getMap("arena-1").spawns).toContainEqual(e.pos);
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
    expect(end.agents.length <= 1 || end.tick === SIXTEEN.durationTicks).toBe(true);
    for (const t of ticks.slice(0, -1)) expect(t.agents.length, `tick ${t.tick}`).toBeGreaterThanOrEqual(2);
  });

  it("logs a Doer event for every living agent on ticks 1, 11, 21, … and on no other tick", () => {
    const deathTick = new Map(eventsOfKind(log, "Death").map((d) => [d.agent, d.tick]));
    const end = log.events.at(-1)!.tick;
    for (let slot = 0; slot < 16; slot++) {
      const id = `a${slot}`;
      const last = deathTick.get(id) ?? end; // it decides on its death tick: it was alive when the tick began
      const expected = Array.from({ length: last }, (_, i) => i + 1).filter(due);
      expect(doerOf(log, id).map((e) => e.tick), id).toEqual(expected);
    }
    expect(eventsOfKind(log, "Doer").every((e) => e.ok)).toBe(true);
  });

  it("puts a tick's Doer events before its step events and its Tick, in slot order", () => {
    const byTick = new Map<number, Event[]>();
    for (const e of log.events) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
    for (const [tick, events] of byTick) {
      if (tick === 0) continue;
      const kinds = events.map((e) => e.kind);
      const firstStep = kinds.findIndex((k) => k === "Shot" || k === "Hit" || k === "Death" || k === "Tick");
      expect(kinds.slice(0, firstStep).every((k) => k === "Doer"), `tick ${tick}`).toBe(true);
      expect(kinds.slice(firstStep).includes("Doer"), `tick ${tick}`).toBe(false);
      const order = events.flatMap((e) => (e.kind === "Doer" ? [Number(e.agent.slice(1))] : []));
      expect(order, `tick ${tick}`).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("drops each dead agent from Tick rows from its death tick on", () => {
    const deaths = eventsOfKind(log, "Death");
    expect(deaths.length).toBeGreaterThan(0);
    for (const tick of eventsOfKind(log, "Tick")) {
      for (const death of deaths) {
        const listed = tick.agents.some(([id]) => id === death.agent);
        expect(listed, `${death.agent} at tick ${tick.tick}`).toBe(tick.tick < death.tick);
      }
    }
  });

  it("rounds Tick numbers as R10 says: x, y to 2 decimals, facing to 1 in (-180, 180], hp whole", () => {
    const twoDecimals = (v: number) => roundTo(v, 2) === v;
    for (const tick of eventsOfKind(log, "Tick")) {
      for (const [id, x, y, facing, hp] of tick.agents) {
        const where = `${id} at tick ${tick.tick}`;
        expect(twoDecimals(x) && twoDecimals(y), where).toBe(true);
        expect(normalizeDeg(roundTo(facing, 1)), where).toBe(facing);
        expect(facing > -180 && facing <= 180, where).toBe(true);
        expect(Number.isInteger(hp), where).toBe(true);
      }
      for (const [id, x, y] of tick.bullets) expect(twoDecimals(x) && twoDecimals(y), id).toBe(true);
      for (const [id, x, y] of tick.near ?? []) expect(twoDecimals(x) && twoDecimals(y), id).toBe(true);
    }
  });

  it("writes near misses into Tick rows only when there are some (ISSUES I-016)", () => {
    const withNear = eventsOfKind(log, "Tick").filter((t) => t.near !== undefined);
    expect(withNear.length).toBeGreaterThan(0);
    for (const t of withNear) expect(t.near!.length, `tick ${t.tick}`).toBeGreaterThan(0);
  });

  it("ranks the survivors first, then the dead by how late they died (R11)", () => {
    const end = eventsOfKind(log, "MatchEnd")[0]!;
    const deaths = eventsOfKind(log, "Death");
    const survivors = eventsOfKind(log, "Tick").at(-1)!.agents.map(([id]) => id);
    expect([...end.ranking].sort()).toEqual(Array.from({ length: 16 }, (_, i) => `a${i}`).sort());
    expect(end.ranking.slice(0, survivors.length).sort()).toEqual([...survivors].sort());
    const deadOrder = end.ranking.slice(survivors.length).map((id) => deaths.find((d) => d.agent === id)!.tick);
    expect(deadOrder).toEqual([...deadOrder].sort((a, b) => b - a));
    expect(end.ranking).toEqual(rankAgents(final.agents));
  });
});

describe("runMatch: faults (R12, principle 5)", () => {
  it("logs a provider that rejects or throws as Doer ok:false with its message; the agent keeps its action", async () => {
    const flaky: DecisionProvider = {
      decide({ tick }) {
        if (tick === 1) return Promise.resolve(answer("forward"));
        if (tick === 11) return Promise.reject(new Error("boom"));
        if (tick === 21) throw "nope"; // a synchronous throw, and not an Error
        return Promise.reject(new Error("")); // no message: the error's name stands in
      },
    };
    const log = await runMatch(openConfig(40), { map: OPEN, prompts: PROMPTS, providers: firstIs(flaky) });
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(doerOf(log, "a0")).toEqual([
      { kind: "Doer", tick: 1, agent: "a0", ok: true, answers: answer("forward").answers },
      { kind: "Doer", tick: 11, agent: "a0", ok: false, error: "boom" },
      { kind: "Doer", tick: 21, agent: "a0", ok: false, error: "nope" },
      { kind: "Doer", tick: 31, agent: "a0", ok: false, error: "Error" },
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 40, ranking: ["a0", "a1"] });
    const path = pathOf(log, "a0");
    for (let t = 1; t <= 40; t++) expect(path[t], `tick ${t}`).not.toEqual(path[t - 1]); // walked on through every fault
  });

  it("times out a call that never settles after doerTimeoutMs; the agent keeps its action and the match goes on", async () => {
    const hangs: DecisionProvider = {
      decide: ({ tick }) => (tick === 1 ? Promise.resolve(answer("forward")) : new Promise<DoerAnswer>(() => {})),
    };
    const log = await runMatch(openConfig(25), { map: OPEN, prompts: PROMPTS, doerTimeoutMs: 5, providers: firstIs(hangs) });
    expect(doerOf(log, "a0").map((e) => [e.tick, e.ok, e.error])).toEqual([
      [1, true, undefined],
      [11, false, "timeout: no answer within 5 ms"],
      [21, false, "timeout: no answer within 5 ms"],
    ]);
    expect(doerOf(log, "a1").every((e) => e.ok)).toBe(true);
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: 25 });
    const path = pathOf(log, "a0");
    expect(path[25]).not.toEqual(path[11]);
  });

  it("logs an answer without an answers object as ok:false instead of applying it", async () => {
    const broken: DecisionProvider = { decide: () => Promise.resolve({ model: "x" } as unknown as DoerAnswer) };
    const log = await runMatch(openConfig(5), { map: OPEN, prompts: PROMPTS, providers: firstIs(broken) });
    expect(doerOf(log, "a0")).toEqual([{ kind: "Doer", tick: 1, agent: "a0", ok: false, error: "invalid answer: no answers object" }]);
    expect(MatchLogSchema.safeParse(log).success).toBe(true);
  });

  it("logs answers the schema rejects as ok:false, 'invalid answer: <path>: <message>'; the agent keeps its action and the log parses (R16)", async () => {
    const provider: DecisionProvider = {
      decide({ tick }) {
        if (tick === 1) return Promise.resolve(answer("forward"));
        if (tick === 11) return Promise.resolve({ model: "test", answers: { ...answer("stop").answers, fire: { type: "noul", noul: 1.0000001 } } });
        // A choice without its `type`.
        return Promise.resolve({ model: "test", answers: { ...answer("stop").answers, move: { choice: "stop", probabilities: { stop: 1 }, confidence: 1 } } } as unknown as DoerAnswer);
      },
    };
    const log = await runMatch(openConfig(25), { map: OPEN, prompts: PROMPTS, providers: firstIs(provider) });
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(doerOf(log, "a0").map((e) => [e.tick, e.ok, e.error])).toEqual([
      [1, true, undefined],
      [11, false, "invalid answer: fire.noul: Too big: expected number to be <=1"],
      [21, false, 'invalid answer: move.type: Invalid input: expected "choice"'],
    ]);
    const path = pathOf(log, "a0");
    for (let t = 12; t <= 25; t++) expect(path[t], `tick ${t}`).not.toEqual(path[t - 1]); // the answers of tick 1 stand: still walking
  });

  it("rounds probabilities and confidence to 4 decimals and keeps only the schema's keys before logging and acting (R16, ISSUES I-018)", async () => {
    const precise: DecisionProvider = {
      decide: () =>
        Promise.resolve({
          model: "test",
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
          },
        } as unknown as DoerAnswer),
    };
    const log = await runMatch(openConfig(12), { map: OPEN, prompts: PROMPTS, providers: firstIs(precise) });
    expect(doerOf(log, "a0")[0]?.answers).toEqual({
      move: { type: "choice", choice: "forward", probabilities: { forward: 0.6123, back: 0.0969, left: 0.0969, right: 0.0969, stop: 0.0969 }, confidence: 0.6123 },
      fire: { type: "noul", noul: 0.4999999999 }, // a noul is checked as given: below FIRE_THRESHOLD, so no shot
      escalate: { type: "noul", noul: 0.1234567891 },
    });
    expect(Object.keys(doerOf(log, "a0")[0]?.answers ?? {})).toEqual(["move", "fire", "escalate"]); // the schema's order
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(eventsOfKind(log, "Shot")).toEqual([]);
    const replayed = await replayMatch(log, { map: OPEN });
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(log));
  });
});

describe("runMatch: cancel (signal)", () => {
  it("an already aborted signal gives Spawn events, Tick(0) and MatchEnd(0) with ranking []", async () => {
    const log = await runMatch(openConfig(100), { map: OPEN, prompts: PROMPTS, providers: () => still, signal: AbortSignal.abort() });
    expect(log.events.map((e) => [e.kind, e.tick])).toEqual([
      ["Spawn", 0],
      ["Spawn", 0],
      ["Tick", 0],
      ["MatchEnd", 0],
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 0, ranking: [] });
    expect(MatchLogSchema.safeParse(log).success).toBe(true);
  });

  it("aborting during a tick ends the match after that tick's Tick, with ranking []", async () => {
    const controller = new AbortController();
    const log = await runMatch(SIXTEEN, {
      providers: botProviders(SIXTEEN.seed),
      prompts: PROMPTS,
      signal: controller.signal,
      onTick: (tick) => tick === 40 && controller.abort(),
    });
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(log.events.slice(-2).map((e) => [e.kind, e.tick])).toEqual([
      ["Tick", 40],
      ["MatchEnd", 40],
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 40, ranking: [] });
  });

  it("cuts a doer call in flight short: logged as aborted, the tick completes, the match ends at once", async () => {
    const controller = new AbortController();
    const hangs: DecisionProvider = {
      decide: ({ tick }) => (tick === 1 ? Promise.resolve(answer("forward")) : new Promise<DoerAnswer>(() => {})),
    };
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    const log = await runMatch(openConfig(100), {
      map: OPEN,
      prompts: PROMPTS,
      providers: firstIs(hangs),
      doerTimeoutMs: 60_000,
      signal: controller.signal,
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(log.events.slice(-4)).toEqual([
      { kind: "Doer", tick: 11, agent: "a0", ok: false, error: "aborted: the match was cancelled" },
      { kind: "Doer", tick: 11, agent: "a1", ok: true, answers: answer("stop").answers },
      expect.objectContaining({ kind: "Tick", tick: 11 }),
      { kind: "MatchEnd", tick: 11, ranking: [] },
    ]);
  });

  it("does not wait out the wall floor once cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const started = performance.now();
    const log = await runMatch(openConfig(100), {
      map: OPEN,
      prompts: PROMPTS,
      providers: () => still,
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

describe("runMatch: thinker events (pollEvents, row 31)", () => {
  const plan = { text: "Go north.", scratchpad: "" };
  const thinker = (agent: string, tick: number, requestedTick: number): Event => ({
    kind: "Thinker",
    tick,
    requestedTick,
    agent,
    input: { requestedTick },
    ok: true,
    plan,
  });

  it("appends pollEvents(t) at the start of tick t, slot by slot, before that tick's doer calls", async () => {
    const polled: number[] = [];
    const a0: DecisionProvider = {
      decide: () => Promise.resolve(answer("stop")),
      pollEvents(tick) {
        polled.push(tick);
        return tick === 11 ? [thinker("a0", 11, 1)] : [];
      },
    };
    const a1: DecisionProvider = {
      decide: () => Promise.resolve(answer("stop")),
      pollEvents: (tick) => (tick === 5 ? [thinker("a1", 5, 1)] : tick === 11 ? [thinker("a1", 11, 5)] : []),
    };
    const log = await runMatch(openConfig(21), { map: OPEN, prompts: PROMPTS, providers: (_, i) => (i === 0 ? a0 : a1) });
    expect(polled).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    const atTick = (t: number) => log.events.filter((e) => e.tick === t).map((e) => [e.kind, "agent" in e ? e.agent : "-"]);
    expect(atTick(5)).toEqual([
      ["Thinker", "a1"],
      ["Tick", "-"],
    ]);
    expect(atTick(11)).toEqual([
      ["Thinker", "a0"],
      ["Thinker", "a1"],
      ["Doer", "a0"],
      ["Doer", "a1"],
      ["Tick", "-"],
    ]);
    expect(MatchLogSchema.parse(log)).toEqual(log);
  });

  it("gives decide the agent's latest successful plan text; a failed thinker call keeps the old one", async () => {
    const contexts: DecisionContext[] = [];
    const a0: DecisionProvider = {
      decide(ctx) {
        contexts.push(ctx);
        return Promise.resolve(answer("stop"));
      },
      pollEvents(tick) {
        if (tick === 4) return [thinker("a0", 4, 1)];
        if (tick === 15) return [{ kind: "Thinker", tick, requestedTick: 11, agent: "a0", input: null, ok: false, error: "refusal" }];
        return [];
      },
    };
    await runMatch(openConfig(21), { map: OPEN, prompts: PROMPTS, providers: firstIs(a0) });
    expect(contexts.map((c) => [c.tick, c.plan])).toEqual([
      [1, ""],
      [11, "Go north."],
      [21, "Go north."],
    ]);
  });

  it("refuses an event that pollEvents(t) stamped with another tick", async () => {
    const wrong: DecisionProvider = { decide: still.decide, pollEvents: (tick) => (tick === 3 ? [thinker("a0", 2, 1)] : []) };
    await expect(runMatch(openConfig(10), { map: OPEN, prompts: PROMPTS, providers: firstIs(wrong) })).rejects.toThrow(
      /pollEvents\(3\)/,
    );
  });

  it("refuses a polled event that fails EventSchema, so a provider bug never reaches the log (R16)", async () => {
    const invalid = [
      { kind: "Thinker", tick: 3, requestedTick: 1, agent: "a0", input: {}, ok: true }, // ok without a plan
      { kind: "Thinker", tick: 3, requestedTick: 4, agent: "a0", input: {}, ok: true, plan }, // asked for after it landed
      { kind: "Thinker", tick: 3, requestedTick: 1, agent: "a0", input: undefined, ok: true, plan }, // no input to log (principle 4)
      { kind: "Shot", tick: 3, agent: "a0", bullet: "" },
    ];
    for (const event of invalid) {
      const wrong: DecisionProvider = { decide: still.decide, pollEvents: (tick) => (tick === 3 ? [event as Event] : []) };
      await expect(runMatch(openConfig(10), { map: OPEN, prompts: PROMPTS, providers: firstIs(wrong) }), JSON.stringify(event)).rejects.toThrow(
        new RegExp(`^pollEvents\\(3\\) returned an invalid ${event.kind} event: `),
      );
    }
  });

  it("logs a polled event as the schema reads it: unknown keys dropped", async () => {
    const extra = { ...thinker("a0", 3, 1), debug: { raw: "provider internals" } } as unknown as Event;
    const a0: DecisionProvider = { decide: still.decide, pollEvents: (tick) => (tick === 3 ? [extra] : []) };
    const log = await runMatch(openConfig(5), { map: OPEN, prompts: PROMPTS, providers: firstIs(a0) });
    expect(eventsOfKind(log, "Thinker")).toEqual([thinker("a0", 3, 1)]);
    expect(MatchLogSchema.parse(log)).toEqual(log);
  });
});

describe("runMatch: cadence, providers and the clock", () => {
  it("makes one provider per slot, once per match, in slot order", async () => {
    const made: [Slot, number][] = [];
    const config = { ...openConfig(30), slots: [{ kind: "doer" }, { kind: "prompted" }, { kind: "bot", bot: "camper" }] as Slot[] };
    await runMatch(config, {
      map: OPEN,
      prompts: PROMPTS,
      providers: (slot, i) => {
        made.push([slot, i]);
        return still;
      },
    });
    expect(made).toEqual(config.slots.map((slot, i) => [slot, i]));
  });

  it("asks each living agent once per due tick, with its view of the world before that tick's step", async () => {
    const contexts: DecisionContext[] = [];
    const spy: DecisionProvider = {
      decide(ctx) {
        contexts.push(ctx);
        return Promise.resolve(answer("forward"));
      },
    };
    const states: WorldState[] = [];
    await runMatch(openConfig(30), { map: OPEN, prompts: PROMPTS, providers: () => spy, onTick: (_, s) => states.push(s) });
    expect(contexts.map((c) => [c.tick, c.agent])).toEqual([
      [1, "a0"],
      [1, "a1"],
      [11, "a0"],
      [11, "a1"],
      [21, "a0"],
      [21, "a1"],
    ]);
    for (const { tick, agent, observation } of contexts) {
      const before = states[tick - 1]!.agents.find((a) => a.id === agent)!;
      expect(observation.self.pos, `${agent} at ${tick}`).toEqual({ x: roundTo(before.pos.x, 2), y: roundTo(before.pos.y, 2) });
    }
  });

  it("calls onTick after every Tick event, tick 0 included, with that tick's world", async () => {
    const seen: [number, number][] = [];
    const log = await runMatch(openConfig(12), { map: OPEN, prompts: PROMPTS, providers: () => still, onTick: (t, s) => seen.push([t, s.tick]) });
    expect(seen).toEqual(eventsOfKind(log, "Tick").map((t) => [t.tick, t.tick]));
    expect(seen).toHaveLength(13);
  });

  it("steps at least minWallMsPerTick apart in wall time, and the log does not depend on it (row 31)", async () => {
    const config = openConfig(8);
    const deps = { map: OPEN, prompts: PROMPTS, providers: () => still };
    const plain = await runMatch(config, deps);
    const at: number[] = [];
    const floored = await runMatch(config, { ...deps, minWallMsPerTick: 15, onTick: () => at.push(performance.now()) });
    expect(at).toHaveLength(9);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `tick ${i - 1} to ${i}`).toBeGreaterThanOrEqual(14.5);
    expect(JSON.stringify(floored)).toBe(JSON.stringify(plain));
  });

  it("rejects a config or prompts that do not validate before anything runs", async () => {
    const deps = { map: OPEN, prompts: PROMPTS, providers: () => still };
    await expect(runMatch({ ...openConfig(10), durationTicks: 0 }, deps)).rejects.toThrow();
    await expect(runMatch(openConfig(10), { ...deps, prompts: { thinkerSystem: "x" } as Prompts })).rejects.toThrow();
  });
});

describe("rankAgents (R11)", () => {
  it("puts the living first by kills, then HP, then slot; then the dead by death tick (latest first), kills, slot", () => {
    const agents = [
      makeAgent(0, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
      makeAgent(1, { x: 0, y: 0 }, 0, { kills: 1, hp: 40 }),
      makeAgent(2, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 900, kills: 0 }),
      makeAgent(3, { x: 0, y: 0 }, 0, { kills: 2, hp: 20 }),
      makeAgent(4, { x: 0, y: 0 }, 0, { kills: 1, hp: 80 }),
      makeAgent(5, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 3 }),
      makeAgent(6, { x: 0, y: 0 }, 0, { kills: 1, hp: 40 }),
      makeAgent(7, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
      makeAgent(10, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
    ];
    expect(rankAgents(agents)).toEqual(["a3", "a4", "a1", "a6", "a2", "a5", "a0", "a7", "a10"]);
  });
});
