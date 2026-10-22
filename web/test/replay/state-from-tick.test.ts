import { MatchLogSchema, perceive, type Event as LogEvent, type MatchLog } from "@kbattle/core";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../core/fixtures/sample-log.json" with { type: "json" };
import { indexLog, type TickEvent } from "../../src/replay/log-index";
import { createStateAt, stateFromTick } from "../../src/replay/state-from-tick";

const sample = MatchLogSchema.parse(sampleJson);
const index = indexLog(sample);
const NO_FACTS = { shots: [], hits: [], nearMisses: [] };

describe("stateFromTick on the sample log", () => {
  it("tick 0: both agents at spawn, full HP, nothing happened yet", () => {
    const state = stateFromTick(index, sample, 0);
    expect(state.tick).toBe(0);
    expect(state.durationTicks).toBe(200); // from log.config
    expect(state.map.id).toBe("arena-1");
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 4, y: 50 }, facing: 0, hp: 100, alive: true, kills: 0, moved: false },
      { id: "a1", pos: { x: 96, y: 50 }, facing: 180, hp: 100, alive: true, kills: 0, moved: false },
    ]);
    expect(state.lastTick).toEqual(NO_FACTS);
    // 92 m apart: beyond the 60 m vision range.
    expect(perceive(state, "a0")).toEqual({
      self: { pos: { x: 4, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 10 },
      visible: [],
      heard: [],
      incoming: [],
    });
  });

  it("tick 141: this tick's shots stand where the shooters' Tick row puts them; moved compares with tick 140", () => {
    const state = stateFromTick(index, sample, 141);
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, alive: true, kills: 0, moved: false },
      { id: "a1", pos: { x: 60.76, y: 49.73 }, facing: -176.3, hp: 20, alive: true, kills: 0, moved: true },
    ]);
    expect(state.lastTick).toEqual({
      shots: [
        { agent: "a0", pos: { x: 26.57, y: 47.5 } },
        { agent: "a1", pos: { x: 60.76, y: 49.73 } },
      ],
      hits: [],
      nearMisses: [],
    });
    const seen = perceive(state, "a0");
    expect(seen.visible).toEqual([{ id: "a1", bearing: 0, dist: 34, moving: true }]);
    expect(seen.heard).toEqual([{ kind: "shot", bearing: 0, dist: "mid" }]); // its own shot is not heard
    expect(seen.self.secondsLeft).toBe(3); // (200 − 141) × 50 ms = 2.95 s, rounded half up to one decimal
  });

  it("tick 115: a hit's `from` is where its bullet's owner stands now (b6 was a1's, fired at 101)", () => {
    const state = stateFromTick(index, sample, 115);
    expect(state.lastTick).toEqual({ shots: [], hits: [{ target: "a0", from: { x: 67.25, y: 50 } }], nearMisses: [] });
    expect(perceive(state, "a0").incoming).toEqual([{ bearing: 0 }]);
    expect(perceive(state, "a1").incoming).toEqual([]);
  });

  it("tick 142, the Tick after the death: a1 dead where it was last seen, a0 credited with the kill", () => {
    const state = stateFromTick(index, sample, 142);
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, alive: true, kills: 1, moved: false },
      { id: "a1", pos: { x: 60.76, y: 49.73 }, facing: -176.3, hp: 0, alive: false, kills: 0, moved: false },
    ]);
    expect(state.lastTick).toEqual({ shots: [], hits: [{ target: "a1", from: { x: 26.57, y: 47.5 } }], nearMisses: [] });
    const a0 = perceive(state, "a0");
    expect(a0.self).toEqual({ pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, kills: 1, secondsLeft: 2.9 });
    expect([a0.visible, a0.heard, a0.incoming]).toEqual([[], [], []]); // the dead are neither seen nor heard
    expect(perceive(state, "a1")).toMatchObject({ self: { hp: 0, kills: 0 }, visible: [], heard: [], incoming: [] });
  });

  it("clamps the tick like a scrub: fractional ticks floor, out-of-range ticks pin to 0..lastTick", () => {
    expect(stateFromTick(index, sample, 141.6)).toEqual(stateFromTick(index, sample, 141));
    expect(stateFromTick(index, sample, 10_000).tick).toBe(142);
    expect(stateFromTick(index, sample, -3)).toEqual(stateFromTick(index, sample, 0));
  });
});

/** A three-slot log around hand-written events; Tick rows may carry v1.5's `near`. */
function miniLog(events: (LogEvent | TickEvent)[]): MatchLog {
  return {
    version: 1,
    config: { mapId: "arena-1", seed: 3, durationTicks: 50, slots: [{ kind: "prompted" }, { kind: "doer" }, { kind: "bot", bot: "camper" }] },
    seed: 3,
    prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
    events: events as LogEvent[],
  };
}

// a1 fires b0 at a0 (tick 1), a0 fires b1 back (tick 2), b0 grazes a2 on tick 2,
// b1 kills a1 (tick 3), and a1's bullet b0, still in flight, hits a0 on tick 4.
// Tick 5 has events but no Tick row.
const mini = miniLog([
  { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 10, y: 50 }, facing: 0 },
  { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 40, y: 50 }, facing: 180 },
  { kind: "Spawn", tick: 0, agent: "a2", pos: { x: 10, y: 60 }, facing: 0 },
  { kind: "Tick", tick: 0, agents: [["a0", 10, 50, 0, 100], ["a1", 40, 50, 180, 100], ["a2", 10, 60, 0, 100]], bullets: [] },
  { kind: "Shot", tick: 1, agent: "a1", bullet: "b0" },
  { kind: "Tick", tick: 1, agents: [["a0", 10.25, 50, 0, 100], ["a1", 40, 50, 180, 20], ["a2", 10, 60, 0, 100]], bullets: [["b0", 36.4, 50]] },
  { kind: "Shot", tick: 2, agent: "a0", bullet: "b1" },
  {
    kind: "Tick",
    tick: 2,
    agents: [["a0", 10.25, 50, 0, 100], ["a1", 39.75, 50, 180, 20], ["a2", 10, 60, 0, 100]],
    bullets: [["b0", 33.4, 50], ["b1", 13.85, 50]],
    near: [["a2", 39.75, 50]],
  },
  { kind: "Hit", tick: 3, bullet: "b1", target: "a1", damage: 20 },
  { kind: "Death", tick: 3, agent: "a1", killer: "a0" },
  { kind: "Tick", tick: 3, agents: [["a0", 10.5, 50, 0, 100], ["a2", 10, 60, 0, 100]], bullets: [["b0", 30.4, 50]] },
  { kind: "Hit", tick: 4, bullet: "b0", target: "a0", damage: 20 },
  { kind: "Tick", tick: 4, agents: [["a0", 10.5, 50, 0, 80], ["a2", 10, 60, 0, 100]], bullets: [], near: [["a2", 10.5, 50]] },
  { kind: "Shot", tick: 5, agent: "a0", bullet: "b2" },
]);
const miniIndex = indexLog(mini);

describe("stateFromTick on a hand-built log", () => {
  it("reads near misses from the Tick row's `near` field, and none when it is absent", () => {
    const state = stateFromTick(miniIndex, mini, 2);
    expect(state.lastTick).toEqual({
      shots: [{ agent: "a0", pos: { x: 10.25, y: 50 } }],
      hits: [],
      nearMisses: [{ target: "a2", from: { x: 39.75, y: 50 } }],
    });
    expect(perceive(state, "a2").incoming).toEqual([{ bearing: -19 }]); // 29.75 m right, 10 m up of a2, which faces +x
    expect(stateFromTick(miniIndex, mini, 1).lastTick.nearMisses).toEqual([]);
  });

  it("counts kills from Death events up to the tick, not after", () => {
    const kills = (t: number) => stateFromTick(miniIndex, mini, t).agents.map((a) => a.kills);
    expect(kills(2)).toEqual([0, 0, 0]);
    expect(kills(3)).toEqual([1, 0, 0]);
    expect(kills(5)).toEqual([1, 0, 0]);
  });

  it("the killing hit comes from the killer's position; the dead keep their last Tick position, HP 0", () => {
    const state = stateFromTick(miniIndex, mini, 3);
    expect(state.lastTick.hits).toEqual([{ target: "a1", from: { x: 10.5, y: 50 } }]);
    expect(state.agents[1]).toEqual({ id: "a1", pos: { x: 39.75, y: 50 }, facing: 180, hp: 0, alive: false, kills: 0, moved: false });
  });

  it("a bullet whose owner died before it landed comes from the owner's last known position", () => {
    const state = stateFromTick(miniIndex, mini, 4);
    expect(state.lastTick.hits).toEqual([{ target: "a0", from: { x: 39.75, y: 50 } }]);
    expect(state.lastTick.nearMisses).toEqual([{ target: "a2", from: { x: 10.5, y: 50 } }]);
    expect(perceive(state, "a0").incoming).toEqual([{ bearing: 0 }]);
  });

  it("moved is true only when the position differs from the previous tick's row", () => {
    const moved = (t: number) => stateFromTick(miniIndex, mini, t).agents.map((a) => a.moved);
    expect(moved(0)).toEqual([false, false, false]); // no previous row
    expect(moved(1)).toEqual([true, false, false]);
    expect(moved(2)).toEqual([false, true, false]);
    expect(moved(3)).toEqual([true, false, false]); // a1 is dead: never moving
  });

  it("a tick without a Tick row reuses the last positions but only its own events: no borrowed near misses", () => {
    const state = stateFromTick(miniIndex, mini, 5);
    expect(state.tick).toBe(5);
    expect(state.agents.map((a) => [a.id, a.pos, a.hp, a.alive, a.moved])).toEqual([
      ["a0", { x: 10.5, y: 50 }, 80, true, false],
      ["a1", { x: 39.75, y: 50 }, 0, false, false],
      ["a2", { x: 10, y: 60 }, 100, true, false],
    ]);
    expect(state.lastTick).toEqual({ shots: [{ agent: "a0", pos: { x: 10.5, y: 50 } }], hits: [], nearMisses: [] });
    expect(perceive(state, "a0").self.secondsLeft).toBe(2.3); // (50 − 5) × 50 ms = 2.25 s
  });

  it("an agent missing from the Tick row without a Death event counts as dead, at its spawn", () => {
    const log = miniLog([
      { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 10, y: 50 }, facing: 0 },
      { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 40, y: 50 }, facing: 180 },
      { kind: "Tick", tick: 0, agents: [["a0", 10, 50, 0, 100]], bullets: [] },
    ]);
    expect(stateFromTick(indexLog(log), log, 0).agents[1]).toEqual({
      id: "a1",
      pos: { x: 40, y: 50 },
      facing: 180,
      hp: 0,
      alive: false,
      kills: 0,
      moved: false,
    });
  });
});

describe("createStateAt", () => {
  it("memoizes per tick: one state for repeated asks of a tick, a new one when the tick changes", () => {
    const stateAt = createStateAt(index, sample);
    const at100 = stateAt(100);
    expect(stateAt(100)).toBe(at100);
    expect(stateAt(100.4)).toBe(at100); // the same tick on screen
    const at101 = stateAt(101);
    expect(at101).not.toBe(at100);
    expect(at101).toEqual(stateFromTick(index, sample, 101));
    expect(stateAt(100)).toEqual(at100);
  });
});
