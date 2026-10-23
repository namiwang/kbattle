import { describe, expect, it } from "vitest";
import { MatchLogSchema, type MatchConfig, type Prompts } from "../../src/schemas";
import { createLogWriter, spawnEvents, tickEvent } from "../../src/sim/log";
import { spawn } from "../../src/sim/world";
import { map1, makeAgent, makeBullet, makeWorld } from "./helpers";

// The log writer (v1.5; sim ruling R10; ISSUES I-014, I-016): Spawn and Tick
// rows built from the world, rounded as people and the mind panel read them;
// events appended in order; every tick within 0..config.durationTicks.

const config: MatchConfig = {
  mapId: "map-1",
  seed: 9,
  durationTicks: 50,
  slots: [{ kind: "prompted" }, { kind: "bot", bot: "camper" }, { kind: "doer" }],
};
const prompts: Prompts = {
  thinkerSystem: "Hold the middle.",
  doerInstructions: { move: "m", turn: "t", fire: "f", target: "" },
};

describe("tickEvent: the Tick row of a world (R10)", () => {
  const world = makeWorld({
    tick: 17,
    agents: [
      makeAgent(0, { x: 10.123, y: 50.456 }, 12.345, { hp: 80 }),
      makeAgent(1, { x: 30, y: 30 }, -179.96, { hp: 0, alive: false, deathTick: 12 }),
      makeAgent(2, { x: 0.001, y: 99.999 }, 179.96, { hp: 59.6 }),
    ],
    bullets: [makeBullet(4, "a0", { x: 20.004, y: 49.996 }, { x: 3, y: 0 }), makeBullet(7, "a2", { x: 1, y: 2 }, { x: 0, y: 3 })],
  });

  it("lists living agents as [id, x, y, facing, hp]: x and y to 2 decimals, facing to 1 in (-180, 180], hp whole", () => {
    expect(tickEvent(world)).toEqual({
      kind: "Tick",
      tick: 17,
      agents: [
        ["a0", 10.12, 50.46, 12.3, 80],
        ["a2", 0, 100, 180, 60],
      ],
      bullets: [
        ["b4", 20, 50],
        ["b7", 1, 2],
      ],
    });
  });

  it("turns a facing that rounds to -180 into 180", () => {
    const turned = { ...world, agents: [makeAgent(0, { x: 5, y: 5 }, -179.96)] };
    expect(tickEvent(turned).agents).toEqual([["a0", 5, 5, 180, 100]]);
  });

  it("leaves out dead agents, and writes no near field when nothing passed close", () => {
    const row = tickEvent(world);
    expect(row.agents.map(([id]) => id)).toEqual(["a0", "a2"]);
    expect(row).not.toHaveProperty("near");
    expect(JSON.stringify(row)).not.toContain("near");
  });

  it("writes this tick's near misses as [target, fromX, fromY], from rounded to 2 decimals (ISSUES I-016)", () => {
    const thisTick = {
      shots: [],
      hits: [{ target: "a2", from: { x: 1, y: 1 } }],
      nearMisses: [
        { target: "a0", from: { x: 30.006, y: 29.994 } },
        { target: "a0", from: { x: 30.5, y: 29.5 } },
        { target: "a2", from: { x: 10.123, y: 50.456 } },
      ],
    };
    // An older step of the perception window (R15) was written by its own Tick event.
    const before = { shots: [], hits: [], nearMisses: [{ target: "a2", from: { x: 7, y: 7 } }] };
    expect(tickEvent({ ...world, recent: [before, thisTick] }).near).toEqual([
      ["a0", 30.01, 29.99],
      ["a0", 30.5, 29.5],
      ["a2", 10.12, 50.46],
    ]);
    expect(tickEvent({ ...world, recent: [before, { ...thisTick, nearMisses: [] }] })).not.toHaveProperty("near");
  });
});

describe("spawnEvents", () => {
  it("is one Spawn per agent in slot order at the world's tick, rounded like Tick rows", () => {
    const world = makeWorld({
      agents: [makeAgent(0, { x: 4, y: 50 }, 0), makeAgent(1, { x: 96.004, y: 4 }, 153.43494882)],
    });
    expect(spawnEvents(world)).toEqual([
      { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
      { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 96, y: 4 }, facing: 153.4 },
    ]);
  });
});

describe("createLogWriter", () => {
  const world = spawn(config, map1);

  it("spawn writes a Spawn per agent, then the Tick(0) snapshot (R1)", () => {
    const writer = createLogWriter(config, prompts);
    writer.spawn(world);
    expect(writer.log().events).toEqual([...spawnEvents(world), tickEvent(world)]);
  });

  it("appends events in order and builds a MatchLog that validates: version 1, config, its seed, prompts", () => {
    const writer = createLogWriter(config, prompts);
    writer.spawn(world);
    writer.append([{ kind: "Doer", tick: 1, agent: "a1", ok: false, error: "timeout" }]);
    writer.tick({ ...world, tick: 1 });
    writer.end(1, ["a0", "a2", "a1"]);
    const log = writer.log();
    expect(MatchLogSchema.parse(log)).toEqual(log);
    expect(log).toMatchObject({ version: 1, config, seed: 9, prompts });
    expect(log.events.map((e) => [e.kind, e.tick])).toEqual([
      ["Spawn", 0],
      ["Spawn", 0],
      ["Spawn", 0],
      ["Tick", 0],
      ["Doer", 1],
      ["Tick", 1],
      ["MatchEnd", 1],
    ]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 1, ranking: ["a0", "a2", "a1"] });
  });

  it.each([
    ["after config.durationTicks", 51],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
  ])("refuses an event tick that is %s, so a log never leaves 0..durationTicks (ISSUES I-014)", (_name, tick) => {
    const writer = createLogWriter(config, prompts);
    expect(() => writer.append([{ kind: "Shot", tick, agent: "a0", bullet: "b0" }])).toThrow(RangeError);
    expect(() => writer.end(tick, [])).toThrow(RangeError);
    expect(() => writer.tick({ ...world, tick })).toThrow(RangeError);
    expect(writer.log().events).toEqual([]);
  });

  it("accepts the last tick of the match", () => {
    const writer = createLogWriter(config, prompts);
    writer.end(50, []);
    expect(writer.log().events).toEqual([{ kind: "MatchEnd", tick: 50, ranking: [] }]);
  });

  it("log() is a snapshot: later appends and changes to the caller's config or prompts do not reach it", () => {
    const mine = structuredClone(config);
    const writer = createLogWriter(mine, prompts);
    writer.spawn(world);
    const before = writer.log();
    writer.end(0, []);
    mine.slots.push({ kind: "doer" });
    expect(before.events).toHaveLength(4);
    expect(writer.log().events).toHaveLength(5);
    expect(writer.log().config).toEqual(config);
  });
});
