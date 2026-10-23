import { describe, expect, expectTypeOf, it } from "vitest";
import { eventsOfKind, lastTick, type EventKind, type EventOf } from "../../src/legacy/log";
import type { Event, MatchLog } from "../../src/legacy/schemas";

// Typed with the z.infer types: this literal only compiles if the schemas infer what log.ts expects.
const log: MatchLog = {
  version: 1,
  config: {
    mapId: "map-1",
    seed: 3,
    durationTicks: 100,
    slots: [{ kind: "prompted" }, { kind: "bot", bot: "camper" }],
  },
  seed: 3,
  prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
  events: [
    { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
    { kind: "Tick", tick: 0, agents: [["a0", 4, 50, 0, 100]], bullets: [] },
    {
      kind: "Thinker",
      tick: 9,
      requestedTick: 2,
      agent: "a0",
      input: null,
      ok: true,
      plan: { text: "Go east.", scratchpad: "" },
    },
    { kind: "Tick", tick: 1, agents: [["a0", 4.25, 50, 0, 100]], bullets: [] },
  ],
};

describe("eventsOfKind", () => {
  it("returns the events of one kind in log order", () => {
    expect(eventsOfKind(log, "Tick").map((e) => e.tick)).toEqual([0, 1]);
    expect(eventsOfKind(log, "Spawn")).toEqual([log.events[0]]);
  });

  it("returns [] for a kind the log does not have", () => {
    expect(eventsOfKind(log, "Death")).toEqual([]);
  });

  it("narrows the type to that kind", () => {
    const thinker = eventsOfKind(log, "Thinker");
    expectTypeOf(thinker).toEqualTypeOf<EventOf<"Thinker">[]>();
    expect(thinker[0]?.requestedTick).toBe(2); // compiles only because the type is narrowed
    expectTypeOf<EventOf<"Tick">["agents"]>().toEqualTypeOf<[string, number, number, number, number][]>();
    expectTypeOf<EventKind>().toEqualTypeOf<Event["kind"]>();
  });
});

describe("lastTick", () => {
  it("is the highest tick of any event, wherever it sits in the log", () => {
    expect(lastTick(log)).toBe(9);
  });

  it("is 0 for a log with no events", () => {
    expect(lastTick({ ...log, events: [] })).toBe(0);
  });
});
