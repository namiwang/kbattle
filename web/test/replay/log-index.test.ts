import { MatchLogSchema, type Event as LogEvent, type MatchLog } from "@kbattle/core";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../core/fixtures/sample-log.json" with { type: "json" };
import { indexLog } from "../../src/replay/log-index";

const sample = MatchLogSchema.parse(sampleJson);

/** A two-slot log around hand-written events. */
function craftedLog(events: LogEvent[]): MatchLog {
  return {
    version: 1,
    config: { mapId: "arena-1", seed: 7, durationTicks: 20, slots: [{ kind: "doer" }, { kind: "bot", bot: "camper" }] },
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

  it("gives each agent its slot kind (agent aN sits in slot N)", () => {
    expect(index.kindOf("a0")).toBe("prompted");
    expect(index.kindOf("a1")).toBe("bot");
    expect(index.kindOf("a7")).toBeUndefined();
    expect(index.kindOf("b1")).toBeUndefined();
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

  it("resolves tick 0 of a log with no events", () => {
    const index = indexLog(craftedLog([]));
    expect(index.lastTick).toBe(0);
    expect(index.byTick(0).agents).toEqual([]);
  });
});
