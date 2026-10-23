import type { MatchConfig, Slot } from "@decision-arena/core/legacy";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { step } from "../../src/sim/step";
import { spawn } from "../../src/sim/world";
import type { Action, WorldState } from "../../src/types";
import { GOLDEN_DIR, singleBulletGolden, singleBulletWorld } from "./golden-scenarios";
import { map1, deepFreeze, makeAgent, makeBullet, makeWorld } from "./helpers";

// v1.1: step(state, actions) → { state, events } advances time and moves bullets
// in straight lines; it is pure (R2): same inputs, same outputs, input untouched.

function run(state: WorldState, ticks: number): WorldState {
  for (let i = 0; i < ticks; i++) state = step(state, {}).state;
  return state;
}

describe("step: time and bullets", () => {
  const world = makeWorld({
    agents: [makeAgent(0, { x: 10, y: 50 })],
    bullets: [
      makeBullet(0, "a0", { x: 20, y: 50 }, { x: 3, y: 0 }),
      makeBullet(1, "a0", { x: 20, y: 60 }, { x: 0.5, y: -0.25 }),
    ],
  });

  it("advances the tick by one and returns the new state with its events", () => {
    const result = step(world, {});
    expect(result.state.tick).toBe(1);
    expect(result.events).toEqual([]);
    expect(step(result.state, {}).state.tick).toBe(2);
  });

  it("moves every bullet by its velocity each tick, in a straight line", () => {
    const after = run(world, 4);
    expect(after.bullets.map((b) => [b.id, b.pos])).toEqual([
      ["b0", { x: 32, y: 50 }],
      ["b1", { x: 22, y: 59 }],
    ]);
    expect(after.bullets.map((b) => b.vel)).toEqual([
      { x: 3, y: 0 },
      { x: 0.5, y: -0.25 },
    ]);
  });

  it("keeps bullet ids, owners, spawn ticks and the id counter", () => {
    const after = run(world, 2);
    expect(after.bullets.map((b) => [b.id, b.owner, b.spawnTick])).toEqual([
      ["b0", "a0", 0],
      ["b1", "a0", 0],
    ]);
    expect(after.nextBulletId).toBe(2);
  });
});

describe("step: actions persist until replaced (§5.4)", () => {
  // `target` without face_target changes nothing physical, so this holds in later milestones too.
  const aim: Action = { move: "stop", turn: "none", fire: false, target: "a1" };
  const keep: Action = { move: "stop", turn: "none", fire: false, target: "a0" };
  const world = makeWorld({ agents: [makeAgent(0, { x: 10, y: 50 }), makeAgent(1, { x: 90, y: 50 }, 180, { action: keep })] });

  it("records a new action on its agent; an agent without one keeps its current action", () => {
    const { state } = step(world, { a0: aim });
    expect(state.agents.map((a) => a.action)).toEqual([aim, keep]);
    expect(step(state, {}).state.agents.map((a) => a.action)).toEqual([aim, keep]);
  });

  it("stores a copy of the action and ignores ids that are not in the world", () => {
    const { state } = step(world, { a0: aim, a9: aim });
    expect(state.agents[0]?.action).not.toBe(aim);
    expect(state.agents).toHaveLength(2);
  });
});

describe("step is pure (R2)", () => {
  it("leaves a deeply frozen input deep-equal to its copy, and returns a new state", () => {
    const input = deepFreeze(singleBulletWorld());
    const before = structuredClone(input);
    const result = step(input, {});
    expect(input).toEqual(before);
    expect(result.state).not.toBe(input);
    expect(result.state.bullets[0]).not.toBe(input.bullets[0]);
  });

  it("gives the same output for the same input", () => {
    const input = deepFreeze(singleBulletWorld());
    expect(step(input, {})).toEqual(step(input, {}));
  });
});

describe("golden: one bullet over 50 ticks (v1.1-single-bullet.json)", () => {
  const golden: unknown = JSON.parse(readFileSync(new URL("v1.1-single-bullet.json", GOLDEN_DIR), "utf8"));

  it("the regenerated trace equals the golden", () => {
    expect(JSON.parse(JSON.stringify(singleBulletGolden()))).toEqual(golden);
  });

  it("the golden itself is the straight line worked out by hand", () => {
    const { trace } = singleBulletGolden();
    expect(trace).toHaveLength(50);
    expect(trace[0]).toEqual([1, 12.1, 49.95]); // (10.6, 50) + (1.5, -0.05)
    expect(trace[49]).toEqual([50, 85.6, 47.5]); // (10.6, 50) + 50 × (1.5, -0.05)
  });
});

describe("determinism: the same scenario with the same seed twice", () => {
  const sixteen = (seed: number): MatchConfig => ({
    mapId: "map-1",
    seed,
    durationTicks: 6000,
    slots: Array.from({ length: 16 }, (): Slot => ({ kind: "bot", bot: "camper" })),
  });
  const scenario = (seed: number) => {
    const state = spawn(sixteen(seed), map1);
    const bullets = state.agents.map((a, n) => makeBullet(n, a.id, a.pos, { x: 1, y: n / 16 - 0.5 }));
    return run({ ...state, bullets, nextBulletId: bullets.length }, 50);
  };

  it("single bullet: identical final state objects", () => {
    expect(run(singleBulletWorld(9), 50)).toEqual(run(singleBulletWorld(9), 50));
  });

  it("16 spawned agents and 16 bullets: identical final state objects", () => {
    expect(scenario(31)).toEqual(scenario(31));
    expect(scenario(31)).not.toEqual(scenario(32)); // the seed reaches the world
  });
});
