import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDeg } from "../../src/angles";
import { AGENT_RADIUS_M, BULLET_SPEED_MPS, FIRE_INTERVAL_TICKS, SPREAD_DEG } from "../../src/constants";
import { nextFloat } from "../../src/sim/rng";
import { step, type StepEvent } from "../../src/sim/step";
import { BULLET_STEP_M, MUZZLE_OFFSET_M, spawnBullet, spreadDeg } from "../../src/sim/weapons";
import type { Action, WorldState } from "../../src/types";
import { mpsToMetersPerTick } from "../../src/units";
import { add, angleOf, fromAngle, len, scale, sub } from "../../src/vec2";
import { GOLDEN_DIR, turnFireGolden } from "./golden-scenarios";
import { makeAgent, makeWorld } from "./helpers";

// R4 step 4: with fire on, a ready weapon and a living agent, a bullet leaves
// pos + unit(facing) × (AGENT_RADIUS_M + 0.1) heading facing + a seeded spread
// in [−SPREAD_DEG, +SPREAD_DEG] at BULLET_SPEED_MPS; cooldown FIRE_INTERVAL_TICKS; Shot.

const firing = (overrides: Partial<Action> = {}): Action => ({
  move: "stop",
  turn: "none",
  fire: true,
  target: null,
  ...overrides,
});

/** Steps `ticks` times; `plan[i]` (if any) is the action given to a0 on step i + 1. */
function run(state: WorldState, ticks: number, plan: Record<number, Action> = {}) {
  const events: StepEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const action = plan[i];
    const result = step(state, action ? { a0: action } : {});
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

const shotTicks = (events: StepEvent[]) => events.filter((e) => e.kind === "Shot").map((e) => e.tick);

/** a0's spread for every shot it fires while spinning in the open middle of arena-1. */
function spreads(seed: number, ticks: number): number[] {
  let state = makeWorld({ seed, agents: [makeAgent(0, { x: 50, y: 50 }, 0, { action: firing({ turn: "right" }) })] });
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const result = step(state, {});
    state = result.state;
    for (const e of result.events) {
      if (e.kind !== "Shot") continue;
      const bullet = state.bullets.find((b) => b.id === e.bullet)!;
      out.push(normalizeDeg(angleOf(bullet.vel) - state.agents[0]!.facing));
    }
  }
  return out;
}

describe("weapons", () => {
  it("muzzle just outside the body; bullet speed per tick", () => {
    expect(MUZZLE_OFFSET_M).toBe(AGENT_RADIUS_M + 0.1);
    expect(BULLET_STEP_M).toBe(mpsToMetersPerTick(BULLET_SPEED_MPS));
    expect(BULLET_STEP_M).toBe(3);
  });

  it("spreadDeg maps a uniform draw in [0, 1) onto [−SPREAD_DEG, +SPREAD_DEG)", () => {
    expect(spreadDeg(0)).toBe(-SPREAD_DEG);
    expect(spreadDeg(0.5)).toBe(0);
    expect(spreadDeg(0.75)).toBe(SPREAD_DEG / 2);
    expect(spreadDeg(1 - 2 ** -32)).toBeLessThan(SPREAD_DEG);
  });

  it("spawnBullet puts the bullet at the muzzle along the facing, heading facing + spread", () => {
    const shooter = makeAgent(3, { x: 50, y: 50 }, 30);
    const bullet = spawnBullet(shooter, "b4", 7, 2);
    expect(bullet).toMatchObject({ id: "b4", owner: "a3", spawnTick: 7 });
    const muzzle = add(shooter.pos, scale(fromAngle(30), 0.6));
    expect(bullet.pos.x).toBeCloseTo(muzzle.x, 12);
    expect(bullet.pos.y).toBeCloseTo(muzzle.y, 12);
    expect(len(bullet.vel)).toBeCloseTo(3, 12);
    expect(angleOf(bullet.vel)).toBeCloseTo(32, 12);
  });
});

describe("firing in a step", () => {
  const world = makeWorld({ seed: 11, agents: [makeAgent(0, { x: 50, y: 50 }, 30)] });

  it("spawns b0 at the muzzle with a Shot event, and records the shot for hearing (R6)", () => {
    const { state, events } = step(world, { a0: firing() });
    expect(events).toEqual([{ kind: "Shot", tick: 1, agent: "a0", bullet: "b0" }]);
    expect(state.nextBulletId).toBe(1);
    const [bullet] = state.bullets;
    expect(bullet).toMatchObject({ id: "b0", owner: "a0", spawnTick: 1 });
    // A new bullet makes its first move in the tick it is fired (R4 step 5).
    const start = sub(bullet!.pos, bullet!.vel);
    const muzzle = add({ x: 50, y: 50 }, scale(fromAngle(30), 0.6));
    expect(start.x).toBeCloseTo(muzzle.x, 12);
    expect(start.y).toBeCloseTo(muzzle.y, 12);
    expect(len(bullet!.vel)).toBeCloseTo(3, 12);
    expect(state.lastTick.shots).toEqual([{ agent: "a0", pos: { x: 50, y: 50 } }]);
  });

  it("draws the spread from state.rng, one draw per shot", () => {
    const { state } = step(world, { a0: firing() });
    const draw = nextFloat(world.rng);
    expect(state.rng).toEqual(draw.rng);
    expect(angleOf(state.bullets[0]!.vel)).toBeCloseTo(30 + spreadDeg(draw.value), 9);
    expect(step(world, {}).state.rng).toEqual(world.rng); // no shot, no draw
  });

  it("then holds fire for FIRE_INTERVAL_TICKS − 1 ticks: shots at 1, 11, 21", () => {
    expect(FIRE_INTERVAL_TICKS).toBe(10);
    const { events } = run(world, 25, { 0: firing() });
    expect(shotTicks(events)).toEqual([1, 11, 21]);
    expect(events.map((e) => (e.kind === "Shot" ? e.bullet : e.kind))).toEqual(["b0", "b1", "b2"]);
  });

  it("the cooldown runs down while not firing", () => {
    expect(shotTicks(run(world, 15, { 0: firing(), 1: firing({ fire: false }), 6: firing() }).events)).toEqual([1, 11]);
    expect(shotTicks(run(world, 15, { 0: firing(), 1: firing({ fire: false }), 13: firing() }).events)).toEqual([
      1, 14,
    ]);
  });

  it("does not fire with fire off, or when dead", () => {
    expect(run(world, 5, { 0: firing({ fire: false }) }).events).toEqual([]);
    const dead = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0, { alive: false, hp: 0, deathTick: 0 })] });
    expect(run(dead, 5, { 0: firing() }).events).toEqual([]);
  });

  it("fires along the facing after this tick's turn, from the position after this tick's move", () => {
    const { state } = step(world, { a0: firing({ move: "forward", turn: "right" }) });
    const a0 = state.agents[0]!;
    expect(a0.facing).toBe(39);
    const start = sub(state.bullets[0]!.pos, state.bullets[0]!.vel);
    const muzzle = add(a0.pos, scale(fromAngle(39), 0.6));
    expect(start.x).toBeCloseTo(muzzle.x, 12);
    expect(start.y).toBeCloseTo(muzzle.y, 12);
    expect(state.lastTick.shots).toEqual([{ agent: "a0", pos: a0.pos }]);
  });

  it("several shooters fire in slot order with ascending bullet ids", () => {
    const three = makeWorld({
      agents: [0, 1, 2].map((slot) => makeAgent(slot, { x: 20 + 30 * slot, y: 50 }, -90, { action: firing() })),
    });
    const { events } = step(three, {});
    expect(events.map((e) => (e.kind === "Shot" ? [e.agent, e.bullet] : e.kind))).toEqual([
      ["a0", "b0"],
      ["a1", "b1"],
      ["a2", "b2"],
    ]);
  });
});

describe("spread is seeded and bounded", () => {
  it("stays within ±SPREAD_DEG and uses the whole range", () => {
    const all = spreads(5, 1000);
    expect(all).toHaveLength(100);
    for (const s of all) {
      expect(s).toBeGreaterThanOrEqual(-SPREAD_DEG - 1e-9);
      expect(s).toBeLessThanOrEqual(SPREAD_DEG + 1e-9);
    }
    expect(Math.min(...all)).toBeLessThan(-2);
    expect(Math.max(...all)).toBeGreaterThan(2);
  });

  it("the same seed gives the same spreads, another seed different ones", () => {
    expect(spreads(5, 300)).toEqual(spreads(5, 300));
    expect(spreads(5, 300)).not.toEqual(spreads(6, 300));
  });
});

describe("golden: firing while turning (v1.2-turn-fire.json)", () => {
  it("the regenerated trace equals the golden", () => {
    const golden: unknown = JSON.parse(readFileSync(new URL("v1.2-turn-fire.json", GOLDEN_DIR), "utf8"));
    expect(JSON.parse(JSON.stringify(turnFireGolden()))).toEqual(golden);
  });

  it("the golden agrees with the rules worked out by hand", () => {
    const { shots, trace } = turnFireGolden();
    expect(trace.map(([tick, facing]) => [tick, facing])).toEqual(
      trace.map(([tick]) => [tick, normalizeDeg(9 * tick)]), // 9° right per tick from 0
    );
    expect(shots.map(([tick, id]) => [tick, id])).toEqual([
      [1, "b0"],
      [11, "b1"],
      [21, "b2"],
      [31, "b3"],
      [41, "b4"],
    ]);
    for (const [tick, , heading] of shots) {
      expect(Math.abs(normalizeDeg(heading - normalizeDeg(9 * tick)))).toBeLessThanOrEqual(SPREAD_DEG);
    }
    expect(trace[0]![2]).toBe(1); // one bullet in flight after the first shot
    expect(Math.max(...trace.map(([, , count]) => count))).toBeLessThanOrEqual(5);
  });
});
