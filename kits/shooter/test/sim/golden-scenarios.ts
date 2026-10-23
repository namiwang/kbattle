// The scenarios behind kits/shooter/fixtures/golden/*.json. Tests regenerate each trace
// and compare it with the committed file; scripts/make-goldens.ts writes the
// files. Tests never write goldens: change one on purpose by rerunning the
// script and reviewing the diff.

import { perceive } from "../../src/sim/perceive";
import { step } from "../../src/sim/step";
import { BULLET_STEP_M } from "../../src/sim/weapons";
import type { AgentId, Observation, WorldState } from "../../src/types";
import { angleOf, fromAngle, norm, scale, sub, type Vec2 } from "../../src/vec2";
import { loadScene, makeAgent, makeBullet, makeWorld } from "./helpers";

export const GOLDEN_DIR = new URL("../../fixtures/golden/", import.meta.url);

/** Rounds to 6 decimals (µm), turning -0 into 0: goldens stay readable and ignore last-bit float noise. */
export function round6(value: number): number {
  const r = Math.round(value * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

// ---- v1.1: one bullet in a straight line ----

/**
 * a0 at (10, 50) facing 0° on map-1, holding still; b0 pre-placed at its
 * muzzle moving (1.5, -0.05) m per tick. The middle lane is open, so the bullet
 * stays in the arena and clear of obstacles for all 50 ticks.
 */
export function singleBulletWorld(seed = 1): WorldState {
  return makeWorld({
    seed,
    agents: [makeAgent(0, { x: 10, y: 50 }, 0)],
    bullets: [makeBullet(0, "a0", { x: 10.6, y: 50 }, { x: 1.5, y: -0.05 })],
  });
}

export function singleBulletGolden() {
  let state = singleBulletWorld();
  const trace: [number, number, number][] = [];
  for (let i = 0; i < 50; i++) {
    state = step(state, {}).state;
    const bullet = state.bullets.find((b) => b.id === "b0");
    if (!bullet) throw new Error(`b0 disappeared at tick ${state.tick}`);
    trace.push([state.tick, round6(bullet.pos.x), round6(bullet.pos.y)]);
  }
  return {
    scenario:
      "map-1; a0 at (10, 50) facing 0, stopped; b0 (owner a0) at (10.6, 50) moving (1.5, -0.05) m/tick; 50 ticks",
    trace, // [tick, b0 x, b0 y] after each step
  };
}

// ---- v1.2: bullets stop at walls on the tick their path crosses one ----

const WALL_MUZZLE = { x: 10.6, y: 24 };
const toward = (p: Vec2) => scale(norm(sub(p, WALL_MUZZLE)), BULLET_STEP_M);

/**
 * a0 at (10, 24) facing 0 on map-1, holding still, with four bullets of its
 * own pre-placed at its muzzle at bullet speed: b0 straight at the north block's
 * west face (x = 42), b1 at the west triangle's slanted face at (24, 33), b2 at
 * -120° into the arena boundary x = 0, b3 clearing the block's corner (42, 18)
 * by 0.2 m on its way to the boundary x = 100.
 */
export function bulletWallWorld(): WorldState {
  return makeWorld({
    agents: [makeAgent(0, { x: 10, y: 24 }, 0)],
    bullets: [
      makeBullet(0, "a0", WALL_MUZZLE, { x: BULLET_STEP_M, y: 0 }),
      makeBullet(1, "a0", WALL_MUZZLE, toward({ x: 24, y: 33 })),
      makeBullet(2, "a0", WALL_MUZZLE, scale(fromAngle(-120), BULLET_STEP_M)),
      makeBullet(3, "a0", WALL_MUZZLE, toward({ x: 42, y: 17.8 })),
    ],
  });
}

export function bulletWallGolden() {
  let state = bulletWallWorld();
  const removedAt: Record<string, number | null> = Object.fromEntries(state.bullets.map((b) => [b.id, null]));
  const trace: [number, ...[string, number, number][]][] = [];
  for (let i = 0; i < 32; i++) {
    const before = state.bullets.map((b) => b.id);
    const result = step(state, {});
    state = result.state;
    if (result.events.length > 0) throw new Error(`walls make no events, got ${JSON.stringify(result.events)}`);
    for (const id of before) if (!state.bullets.some((b) => b.id === id)) removedAt[id] = state.tick;
    trace.push([state.tick, ...state.bullets.map((b): [string, number, number] => [b.id, round6(b.pos.x), round6(b.pos.y)])]);
  }
  return {
    scenario:
      "map-1; a0 at (10, 24) facing 0, stopped; its bullets from (10.6, 24) at 3 m/tick: " +
      "b0 at 0 deg into the north block (x = 42), b1 toward (24, 33) on the west triangle, " +
      "b2 at -120 deg into the boundary x = 0, b3 toward (42, 17.8) past the block's corner to x = 100; 32 ticks",
    removedAt, // bullet id → the tick its path crossed a wall (null: still flying)
    trace, // [tick, ...[id, x, y] of the bullets still in flight after each step]
  };
}

// ---- v1.2: an agent firing while turning ----

/** a0 alone at the center of map-1 facing 0, turning right and firing every chance it gets; seed 7. */
export function turnFireWorld(): WorldState {
  const action = { move: "stop", turn: "right", fire: true, target: null } as const;
  return makeWorld({ seed: 7, agents: [makeAgent(0, { x: 50, y: 50 }, 0, { action })] });
}

export function turnFireGolden() {
  let state = turnFireWorld();
  const shots: [number, string, number][] = [];
  const trace: [number, number, number][] = [];
  for (let i = 0; i < 50; i++) {
    const result = step(state, {});
    state = result.state;
    for (const e of result.events) {
      if (e.kind !== "Shot") continue;
      const bullet = state.bullets.find((b) => b.id === e.bullet);
      if (!bullet) throw new Error(`${e.bullet} was gone in the tick it was fired`);
      shots.push([e.tick, e.bullet, round6(angleOf(bullet.vel))]);
    }
    trace.push([state.tick, round6(state.agents[0]!.facing), state.bullets.length]);
  }
  return {
    scenario: "map-1, seed 7; a0 at (50, 50) facing 0, action { stop, right, fire }; 50 ticks",
    shots, // [tick, bullet id, heading in degrees] per Shot
    trace, // [tick, a0 facing, bullets in flight] after each step
  };
}

// ---- v1.3: what every agent perceives in five hand-written scenes ----

/** The scenes in kits/shooter/fixtures/scenes, golden `v1.3-<name>.json` each. */
export const SCENES = Object.freeze(["cone-edge", "los-blocked", "hearing", "incoming", "combined"] as const);

/** The scene's description and every agent's Observation, by agent id. */
export function perceptionGolden(name: string): { scene: string; observations: Record<AgentId, Observation> } {
  const { description, state } = loadScene(name);
  return {
    scene: description,
    observations: Object.fromEntries(state.agents.map((a) => [a.id, perceive(state, a.id)])),
  };
}

/** Golden file name → the function that regenerates its content. */
export const GOLDENS: Readonly<Record<string, () => Record<string, unknown>>> = {
  "v1.1-single-bullet.json": singleBulletGolden,
  "v1.2-bullet-wall.json": bulletWallGolden,
  "v1.2-turn-fire.json": turnFireGolden,
  ...Object.fromEntries(SCENES.map((name) => [`v1.3-${name}.json`, () => perceptionGolden(name)])),
};

/** Top-level fields pretty, each row of an array field on one line: readable, diffable. */
export function formatGolden(golden: Record<string, unknown>): string {
  const fields = Object.entries(golden).map(([key, value]) => {
    const body =
      Array.isArray(value) && value.length > 0
        ? `[\n${value.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`
        : JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
    return `  ${JSON.stringify(key)}: ${body}`;
  });
  return `{\n${fields.join(",\n")}\n}\n`;
}
