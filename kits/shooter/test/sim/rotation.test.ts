import { describe, expect, it } from "vitest";
import { TURN_RATE_DPS } from "../../src/constants";
import { step, type StepActions } from "../../src/sim/step";
import type { Action, TurnChoice, WorldState } from "../../src/types";
import { dpsToDegreesPerTick } from "../../src/units";
import { makeAgent, makeWorld } from "./helpers";

// R4 step 2: left/right turn TURN_RATE_DPS per tick; face_target turns toward
// the target's current position when it is alive, within VISION_RANGE_M and in
// line of sight (the cone is not required); otherwise no turn.

const TURN = dpsToDegreesPerTick(TURN_RATE_DPS);

const turning = (turn: TurnChoice, target: string | null = null): Action => ({
  move: "stop",
  turn,
  fire: false,
  target,
});

/** a0's facing after each of `ticks` steps; `actions` are given on the first step only. */
function facings(state: WorldState, actions: StepActions, ticks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    state = step(state, i === 0 ? actions : {}).state;
    out.push(state.agents[0]!.facing);
  }
  return out;
}

describe("left and right", () => {
  const world = (facing: number) => makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, facing)] });

  it("turn 9° per tick: right is clockwise (+), left counter-clockwise (−)", () => {
    expect(TURN).toBe(9);
    expect(facings(world(0), { a0: turning("right") }, 3)).toEqual([9, 18, 27]);
    expect(facings(world(0), { a0: turning("left") }, 3)).toEqual([-9, -18, -27]);
  });

  it("wrap through ±180", () => {
    expect(facings(world(175), { a0: turning("right") }, 2)).toEqual([-176, -167]);
    expect(facings(world(-175), { a0: turning("left") }, 2)).toEqual([176, 167]);
  });

  it("none keeps the facing", () => {
    expect(facings(world(33), { a0: turning("none") }, 2)).toEqual([33, 33]);
  });

  it("a dead agent does not turn", () => {
    const dead = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0, { alive: false, hp: 0, deathTick: 0 })] });
    expect(facings(dead, { a0: turning("right") }, 2)).toEqual([0, 0]);
  });
});

describe("face_target", () => {
  const duel = (target: { x: number; y: number }, facing = 0, a1: Parameters<typeof makeAgent>[3] = {}) =>
    makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, facing), makeAgent(1, target, 0, a1)] });

  it("turns toward the target by at most 9° per tick, reaches it and stops", () => {
    expect(facings(duel({ x: 50, y: 60 }), { a0: turning("face_target", "a1") }, 12)).toEqual([
      9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 90, 90,
    ]);
  });

  it("takes the shorter way round", () => {
    expect(facings(duel({ x: 50, y: 40 }), { a0: turning("face_target", "a1") }, 2)).toEqual([-9, -18]);
    // From 170° to a target at -160° (= 200°) the short way is clockwise, through 180.
    const at200 = { x: 50 + 10 * Math.cos((200 * Math.PI) / 180), y: 50 + 10 * Math.sin((200 * Math.PI) / 180) };
    expect(facings(duel(at200, 170), { a0: turning("face_target", "a1") }, 3)).toEqual([179, -172, -163]);
  });

  it("does not need the target in the vision cone: a target behind is turned to", () => {
    expect(facings(duel({ x: 40, y: 50 }), { a0: turning("face_target", "a1") }, 1)).toEqual([9]);
  });

  it("follows the target's current position each tick", () => {
    let state = step(duel({ x: 60, y: 50 }), { a0: turning("face_target", "a1") }).state;
    expect(state.agents[0]!.facing).toBe(0);
    const moved = { ...state, agents: [state.agents[0]!, { ...state.agents[1]!, pos: { x: 50, y: 60 } }] };
    state = step(moved, {}).state;
    expect(state.agents[0]!.facing).toBe(9);
  });

  it("does nothing without line of sight", () => {
    const blocked = makeWorld({ agents: [makeAgent(0, { x: 35, y: 24 }, 90), makeAgent(1, { x: 65, y: 24 })] });
    expect(facings(blocked, { a0: turning("face_target", "a1") }, 2)).toEqual([90, 90]);
  });

  it("does nothing beyond VISION_RANGE_M (60 m), and turns at exactly 60 m", () => {
    const far = makeWorld({ agents: [makeAgent(0, { x: 10, y: 50 }, 90), makeAgent(1, { x: 70.5, y: 50 })] });
    expect(facings(far, { a0: turning("face_target", "a1") }, 1)).toEqual([90]);
    const edge = makeWorld({ agents: [makeAgent(0, { x: 10, y: 50 }, 90), makeAgent(1, { x: 70, y: 50 })] });
    expect(facings(edge, { a0: turning("face_target", "a1") }, 1)).toEqual([81]);
  });

  it("does nothing when the target is dead, unknown, itself or null", () => {
    const dead = duel({ x: 50, y: 60 }, 0, { alive: false, hp: 0, deathTick: 0 });
    expect(facings(dead, { a0: turning("face_target", "a1") }, 1)).toEqual([0]);
    expect(facings(duel({ x: 50, y: 60 }), { a0: turning("face_target", "a7") }, 1)).toEqual([0]);
    expect(facings(duel({ x: 50, y: 60 }), { a0: turning("face_target", "a0") }, 1)).toEqual([0]);
    expect(facings(duel({ x: 50, y: 60 }), { a0: turning("face_target", null) }, 1)).toEqual([0]);
  });
});

describe("order inside a tick (R4)", () => {
  it("moves along the facing after this tick's turn", () => {
    const world = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0)] });
    const { state } = step(world, { a0: { move: "forward", turn: "right", fire: false, target: null } });
    const a0 = state.agents[0]!;
    expect(a0.facing).toBe(9);
    expect(a0.pos.x).toBeCloseTo(50 + 0.25 * Math.cos((9 * Math.PI) / 180), 12);
    expect(a0.pos.y).toBeCloseTo(50 + 0.25 * Math.sin((9 * Math.PI) / 180), 12);
  });
});
