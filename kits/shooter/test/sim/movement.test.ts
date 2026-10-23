import { describe, expect, it } from "vitest";
import { AGENT_RADIUS_M, MOVE_SPEED_MPS } from "../../src/constants";
import { step } from "../../src/sim/step";
import type { Action, MoveChoice, WorldState } from "../../src/types";
import { mpsToMetersPerTick } from "../../src/units";
import { makeAgent, makeWorld } from "./helpers";

// R4 step 3: moves are relative to the facing after the turn, MOVE_SPEED_MPS per
// tick. R5: a body that would overlap an obstacle or leave the arena tries the
// x-only move, then the y-only move, else stays; `moved` = the position changed.

const STEP = mpsToMetersPerTick(MOVE_SPEED_MPS);
const R = AGENT_RADIUS_M;

const moving = (move: MoveChoice): Action => ({ move, turn: "none", fire: false, target: null });

function walk(state: WorldState, move: MoveChoice, ticks: number): WorldState {
  for (let i = 0; i < ticks; i++) state = step(state, i === 0 ? { a0: moving(move) } : {}).state;
  return state;
}

const at = (x: number, y: number, facing: number) => makeWorld({ agents: [makeAgent(0, { x, y }, facing)] });

function expectPos(state: WorldState, x: number, y: number): void {
  const { pos } = state.agents[0]!;
  expect(pos.x).toBeCloseTo(x, 12);
  expect(pos.y).toBeCloseTo(y, 12);
}

describe("moving relative to facing", () => {
  it("forward at 0° goes +x, 0.25 m per tick", () => {
    expect(STEP).toBe(0.25);
    expectPos(walk(at(50, 50, 0), "forward", 1), 50.25, 50);
    expectPos(walk(at(50, 50, 0), "forward", 4), 51, 50);
  });

  it("forward at 90° goes +y (down on screen)", () => {
    expectPos(walk(at(50, 50, 90), "forward", 1), 50, 50.25);
  });

  it.each([
    ["back", 49.75, 50], // facing + 180
    ["left", 50, 49.75], // facing − 90: up on screen when facing +x
    ["right", 50, 50.25], // facing + 90
  ] as const)("%s at 0° goes to (%d, %d)", (move, x, y) => {
    expectPos(walk(at(50, 50, 0), move, 1), x, y);
  });

  it("left and right follow the facing: at 90°, left is +x and right is −x", () => {
    expectPos(walk(at(50, 50, 90), "left", 1), 50.25, 50);
    expectPos(walk(at(50, 50, 90), "right", 1), 49.75, 50);
  });

  it("a diagonal step is 0.25 m long", () => {
    const d = STEP / Math.SQRT2;
    expectPos(walk(at(50, 50, 45), "forward", 1), 50 + d, 50 + d);
  });

  it("stop stays put", () => {
    expectPos(walk(at(50, 50, 0), "stop", 3), 50, 50);
  });
});

describe("blocked moves slide or stay (R5)", () => {
  const d = STEP / Math.SQRT2;

  it("slides along y when the x part would enter a wall", () => {
    // Touching the north block's west face (x = 42, y 18..30), walking down-right.
    const state = walk(at(42 - R, 24, 45), "forward", 1);
    expectPos(state, 42 - R, 24 + d);
    expect(state.agents[0]!.moved).toBe(true);
  });

  it("slides along x when the y part would enter a wall", () => {
    // Touching the north block's south face (y = 30, x 42..58), walking up-right.
    const state = walk(at(50, 30 + R, -45), "forward", 1);
    expectPos(state, 50 + d, 30 + R);
    expect(state.agents[0]!.moved).toBe(true);
  });

  it("stays when both parts are blocked, in an arena corner", () => {
    const state = walk(at(R, R, -135), "forward", 3);
    expectPos(state, R, R);
    expect(state.agents[0]!.moved).toBe(false);
  });

  it("the arena boundary blocks like a wall", () => {
    expectPos(walk(at(R, 50, 180), "forward", 2), R, 50);
    expectPos(walk(at(100 - R, 50, 0), "forward", 2), 100 - R, 50);
  });

  it("takes no partial steps: 0.1 m short of a wall, a 0.25 m step is refused and the agent stays", () => {
    const wall = walk(at(42 - R - 0.1, 24, 0), "forward", 3); // the north block's west face
    expectPos(wall, 42 - R - 0.1, 24);
    expect(wall.agents[0]!.moved).toBe(false);
    expectPos(walk(at(50, 100 - R - 0.1, 90), "forward", 2), 50, 100 - R - 0.1); // the south boundary
  });

  it("an agent touching a wall can walk away from it", () => {
    expectPos(walk(at(42 - R, 24, 180), "forward", 1), 42 - R - STEP, 24);
  });
});

describe("the moved flag", () => {
  it("is true after a step that changed the position and false otherwise", () => {
    let state = walk(at(50, 50, 0), "forward", 1);
    expect(state.agents[0]!.moved).toBe(true);
    state = step(state, { a0: moving("stop") }).state;
    expect(state.agents[0]!.moved).toBe(false);
  });

  it("a dead agent does not move", () => {
    const dead = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0, { alive: false, hp: 0, deathTick: 0 })] });
    const state = walk(dead, "forward", 2);
    expectPos(state, 50, 50);
    expect(state.agents[0]!.moved).toBe(false);
  });

  it("agents do not collide with each other (PoC)", () => {
    const pair = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0), makeAgent(1, { x: 50.5, y: 50 })] });
    expectPos(walk(pair, "forward", 2), 50.5, 50);
  });
});
