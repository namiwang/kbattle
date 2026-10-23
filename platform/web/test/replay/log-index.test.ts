import { MatchLogSchema, type Event as LogEvent, type MatchLog } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../../kits/shooter/fixtures/sample-log.json" with { type: "json" };
import { indexLog } from "../../src/replay/log-index";

const sample = MatchLogSchema.parse(sampleJson);

/** A two-slot log around hand-written events. */
function craftedLog(events: LogEvent[]): MatchLog {
  return {
    version: 1,
    config: { mapId: "map-1", seed: 7, durationTicks: 20, slots: [{ kind: "doer" }, { kind: "bot", bot: "camper" }] },
    seed: 7,
    prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
    events,
  };
}

describe("indexLog on the sample log", () => {
  const index = indexLog(sample);

  it("ends at the last event's tick", () => {
    expect(index.lastTick).toBe(142);
    expect(index.ticks).toHaveLength(143);
  });

  it("resolves every tick 0..lastTick to that tick's Tick event", () => {
    for (let t = 0; t <= 142; t++) {
      expect(index.byTick(t).tick).toBe(t);
      expect(index.ticks[t]).toBe(index.byTick(t));
    }
  });

  it("returns the positions the log recorded", () => {
    expect(index.byTick(0).agents).toEqual([
      ["a0", 4, 50, 0, 100],
      ["a1", 96, 50, 180, 100],
    ]);
    expect(index.byTick(140).agents).toEqual([
      ["a0", 26.57, 47.5, 3.7, 80],
      ["a1", 61.01, 49.75, -176.3, 20],
    ]);
    expect(index.byTick(140).bullets).toEqual([
      ["b10", 5.3, 47.61],
      ["b11", 57, 49.59],
      ["b12", 32.77, 48.97],
    ]);
  });

  it("indexes spawns and deaths by agent", () => {
    expect([...index.spawns.keys()]).toEqual(["a0", "a1"]);
    expect(index.spawns.get("a1")).toMatchObject({ tick: 0, pos: { x: 96, y: 50 }, facing: 180 });
    expect([...index.deaths.keys()]).toEqual(["a1"]);
    expect(index.deaths.get("a1")).toMatchObject({ tick: 142, killer: "a0" });
  });

  it("drops the dead agent from its death tick on and keeps it before", () => {
    const ids = (t: number) => index.byTick(t).agents.map(([id]) => id);
    for (let t = 0; t < 142; t++) expect(ids(t)).toContain("a1");
    expect(ids(142)).toEqual(["a0"]);
  });

  it("clamps out-of-range and fractional ticks instead of failing a scrub", () => {
    expect(index.byTick(-5).tick).toBe(0);
    expect(index.byTick(10_000).tick).toBe(142);
    expect(index.byTick(3.7).tick).toBe(3);
    expect(index.byTick(Number.NaN).tick).toBe(0);
  });

  it("lists every agent of the match, in spawn order", () => {
    expect(index.agents).toEqual(["a0", "a1"]);
  });

  it("lists the events of exactly one tick, in log order", () => {
    const kinds = (t: number) => index.eventsAt(t).map((e) => e.kind);
    expect(kinds(0)).toEqual(["Spawn", "Spawn", "Tick"]);
    expect(kinds(101)).toEqual(["Doer", "Shot", "Shot", "Tick"]);
    expect(kinds(142)).toEqual(["Hit", "Death", "Tick", "MatchEnd"]);
    expect(index.eventsAt(102)).toEqual([index.byTick(102)]);
    expect(index.eventsAt(-1)).toEqual([]);
    expect(index.eventsAt(143)).toEqual([]);
    expect(index.eventsAt(3.5)).toEqual([]);
  });

  it("indexes shots by bullet id, so a hit names its shooter", () => {
    expect(index.shots.size).toBe(15);
    expect(index.shots.get("b0")).toMatchObject({ tick: 71, agent: "a1" });
    expect(index.shots.get("b11")).toMatchObject({ tick: 131, agent: "a0" });
    expect(index.shots.get("b99")).toBeUndefined();
  });

  it("gives each agent its slot kind (agent aN sits in slot N)", () => {
    expect(index.kindOf("a0")).toBe("prompted");
    expect(index.kindOf("a1")).toBe("bot");
    expect(index.kindOf("a7")).toBeUndefined();
    expect(index.kindOf("b1")).toBeUndefined();
  });

  it("lists each agent's doer and thinker calls in tick order; agents without calls are absent", () => {
    const doer = index.doerCalls.get("a0") ?? [];
    expect(doer.map((e) => e.tick)).toEqual([1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141]);
    expect(doer.filter((e) => !e.ok).map((e) => e.tick)).toEqual([41]);
    expect(index.thinkerCalls.get("a0")?.map((e) => [e.requestedTick, e.tick, e.ok])).toEqual([
      [1, 7, true],
      [71, 78, false],
    ]);
    expect(doer[0]).toBe(index.eventsAt(1)[0]); // the log's own events, not copies
    expect([...index.doerCalls.keys(), ...index.thinkerCalls.keys()]).toEqual(["a0", "a0"]);
  });
});

describe("indexLog's call lists on a log out of tick order", () => {
  it("sorts each agent's calls by tick, keeping log order within a tick", () => {
    const answers = { fire: { type: "noul" as const, noul: 0.1 } };
    const plan = { text: "hold", scratchpad: "" };
    const index = indexLog(
      craftedLog([
        { kind: "Doer", tick: 11, agent: "a0", ok: true, answers },
        { kind: "Doer", tick: 1, agent: "a0", ok: false, error: "timeout" },
        { kind: "Doer", tick: 1, agent: "a1", ok: true, answers },
        { kind: "Thinker", tick: 9, requestedTick: 2, agent: "a0", input: null, ok: true, plan },
        { kind: "Thinker", tick: 5, requestedTick: 5, agent: "a0", input: null, ok: false, error: "refusal" },
        { kind: "Doer", tick: 11, agent: "a0", ok: false, error: "server: 502" },
      ]),
    );
    expect(index.doerCalls.get("a0")?.map((e) => [e.tick, e.ok])).toEqual([
      [1, false],
      [11, true],
      [11, false],
    ]);
    expect(index.doerCalls.get("a1")?.map((e) => e.tick)).toEqual([1]);
    expect(index.thinkerCalls.get("a0")?.map((e) => e.tick)).toEqual([5, 9]);
    expect(index.thinkerCalls.has("a1")).toBe(false);
  });
});

describe("indexLog on logs with missing Tick events", () => {
  it("carries the last recorded positions over ticks with no Tick event", () => {
    const index = indexLog(
      craftedLog([
        { kind: "Tick", tick: 0, agents: [["a0", 1, 1, 0, 100]], bullets: [] },
        { kind: "Tick", tick: 3, agents: [["a0", 4, 1, 0, 100]], bullets: [] },
        { kind: "Shot", tick: 5, agent: "a0", bullet: "b0" },
      ]),
    );
    expect(index.lastTick).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map((t) => index.byTick(t).agents[0]?.[1])).toEqual([1, 1, 1, 4, 4, 4]);
  });

  it("shows agents at their spawn, full HP, before the first Tick event", () => {
    const index = indexLog(
      craftedLog([
        { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
        { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 96, y: 50 }, facing: 180 },
        { kind: "Tick", tick: 2, agents: [["a0", 4.5, 50, 0, 100]], bullets: [] },
      ]),
    );
    expect(index.byTick(0).agents).toEqual([
      ["a0", 4, 50, 0, 100],
      ["a1", 96, 50, 180, 100],
    ]);
    expect(index.byTick(1).bullets).toEqual([]);
    expect(index.byTick(2).agents).toEqual([["a0", 4.5, 50, 0, 100]]);
    expect(index.kindOf("a0")).toBe("doer");
  });

  it("lists agents named by the first Tick event without a Spawn event after the spawned ones", () => {
    const index = indexLog(
      craftedLog([
        { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 96, y: 50 }, facing: 180 },
        { kind: "Tick", tick: 0, agents: [["a0", 4, 50, 0, 100], ["a1", 96, 50, 180, 100]], bullets: [] },
      ]),
    );
    expect(index.agents).toEqual(["a1", "a0"]);
  });

  it("resolves tick 0 of a log with no events", () => {
    const index = indexLog(craftedLog([]));
    expect(index.lastTick).toBe(0);
    expect(index.byTick(0).agents).toEqual([]);
    expect(index.agents).toEqual([]);
  });
});
