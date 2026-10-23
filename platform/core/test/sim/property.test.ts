import { describe, expect, it } from "vitest";
import { AGENT_HP, AGENT_RADIUS_M } from "../../src/constants";
import type { MapSpec } from "../../src/schemas";
import { circleInsideArena, circleOverlapsPolygon } from "../../src/sim/collision";
import { createRng, nextFloat, type RngState } from "../../src/rng";
import { step, type StepActions } from "../../src/sim/step";
import { MOVE_CHOICES, TURN_CHOICES, type Action, type WorldState } from "../../src/types";
import { arena1, makeAgent, makeWorld } from "./helpers";

// Property (v1.2): random seeded action streams never put an agent body outside
// the arena or into an obstacle, and never produce a non-finite number.

const OPEN: MapSpec = { id: "open", width: 100, height: 100, obstacles: [], spawns: arena1.spawns };
const R = AGENT_RADIUS_M;
const AGENTS = 4;
const TICKS = 150;

/** A tiny cursor over the sim's RNG for drawing test inputs. */
function drawer(seed: number) {
  let rng: RngState = createRng(seed);
  const float = () => {
    const d = nextFloat(rng);
    rng = d.rng;
    return d.value;
  };
  return { float, pick: <T>(items: readonly T[]): T => items[Math.floor(float() * items.length)]! };
}

const fits = (map: MapSpec, p: { x: number; y: number }) =>
  circleInsideArena(p, R, map.width, map.height) && !map.obstacles.some((o) => circleOverlapsPolygon(p, R, o.vertices));

function randomWorld(map: MapSpec, seed: number, draw: ReturnType<typeof drawer>): WorldState {
  const agents = Array.from({ length: AGENTS }, (_, slot) => {
    for (;;) {
      const pos = { x: draw.float() * map.width, y: draw.float() * map.height };
      if (fits(map, pos)) return makeAgent(slot, pos, draw.float() * 360 - 180);
    }
  });
  return makeWorld({ map, seed, agents });
}

function randomActions(draw: ReturnType<typeof drawer>, state: WorldState): StepActions {
  const actions: Record<string, Action> = {};
  for (const agent of state.agents) {
    if (draw.float() < 0.2) continue; // some agents keep their action this tick
    actions[agent.id] = {
      move: draw.pick(MOVE_CHOICES),
      turn: draw.pick(TURN_CHOICES),
      fire: draw.float() < 0.5,
      target: draw.pick([null, ...state.agents.map((a) => a.id)]),
    };
  }
  return actions;
}

function check(state: WorldState, where: string): void {
  for (const a of state.agents) {
    const nums = [a.pos.x, a.pos.y, a.facing, a.hp, a.cooldownTicks, a.kills];
    if (!nums.every(Number.isFinite)) throw new Error(`${where}: ${a.id} has a non-finite field ${JSON.stringify(a)}`);
    if (!fits(state.map, a.pos)) throw new Error(`${where}: ${a.id} at ${JSON.stringify(a.pos)} is out of bounds`);
    if (a.facing <= -180 || a.facing > 180) throw new Error(`${where}: ${a.id} facing ${a.facing}`);
    if (a.hp < 0 || a.hp > AGENT_HP) throw new Error(`${where}: ${a.id} hp ${a.hp}`);
  }
  for (const b of state.bullets) {
    if (![b.pos.x, b.pos.y, b.vel.x, b.vel.y].every(Number.isFinite)) throw new Error(`${where}: ${b.id} not finite`);
    if (!circleInsideArena(b.pos, 0, state.map.width, state.map.height)) throw new Error(`${where}: ${b.id} outside`);
  }
}

/** Runs one stream; returns how many moves were refused or slid (so the test knows walls were touched). */
function stream(map: MapSpec, seed: number): { blocked: number; shots: number } {
  const draw = drawer(seed);
  let state = randomWorld(map, seed, draw);
  check(state, `seed ${seed} start`);
  let blocked = 0;
  let shots = 0;
  for (let t = 1; t <= TICKS; t++) {
    const result = step(state, t % 5 === 1 ? randomActions(draw, state) : {});
    for (const [i, a] of result.state.agents.entries()) {
      const before = state.agents[i]!;
      if (a.alive && a.action.move !== "stop" && !a.moved) blocked++;
      if (a.moved && Math.hypot(a.pos.x - before.pos.x, a.pos.y - before.pos.y) < 0.2499) blocked++; // slid
    }
    shots += result.events.filter((e) => e.kind === "Shot").length;
    state = result.state;
    check(state, `seed ${seed} tick ${t}`);
  }
  return { blocked, shots };
}

describe("property: random action streams stay in bounds and finite", () => {
  it("200 seeded streams on arena-1", () => {
    let blocked = 0;
    let shots = 0;
    for (let seed = 0; seed < 200; seed++) {
      const r = stream(arena1, seed);
      blocked += r.blocked;
      shots += r.shots;
    }
    // The walls and the weapon were really exercised (measured: 2,513 refused or slid moves, 7,597 shots).
    expect(blocked).toBeGreaterThan(1000);
    expect(shots).toBeGreaterThan(3000);
  });

  it("50 seeded streams on an open map with no obstacles", () => {
    let blocked = 0;
    for (let seed = 1000; seed < 1050; seed++) blocked += stream(OPEN, seed).blocked;
    expect(blocked).toBeGreaterThan(100); // the arena boundary alone (measured: 305)
  });
});
