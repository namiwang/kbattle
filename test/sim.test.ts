// The battle royale's sim and perception: goldens, the perception window, invariants, answers, ranking, maps.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { battleRoyale } from "../src/arenas/battle-royale/arena.ts";
import { AGENT_HP, AGENT_RADIUS_M, BULLET_STEP_M, DECISION_TICKS, MAP_SIZE_M, MATCH_TICKS } from "../src/arenas/battle-royale/constants.ts";
import { circleInsideMap, circleOverlapsPolygon, fromAngle, headingTo, scale, type Vec2 } from "../src/arenas/battle-royale/geometry.ts";
import { getMap, MAPS, type MapSpec } from "../src/arenas/battle-royale/maps.ts";
import { perceive } from "../src/arenas/battle-royale/perceive.ts";
import { step } from "../src/arenas/battle-royale/sim.ts";
import type { Action, Bullet, Fighter, WorldState } from "../src/arenas/battle-royale/types.ts";
import { createRng, nextFloat, roundTo } from "../src/core/numbers.ts";

const STOPPED: Action = { move: "stop", turn: "none", fire: false, target: null };

/** Agent a<i> as it spawns: full HP, a ready weapon, standing still. */
function agent(i: number, pos: Vec2, facing = 0, over: Partial<Fighter> = {}): Fighter {
  return { id: `a${i}`, pos, facing, hp: AGENT_HP, alive: true, deathTick: null, kills: 0, cooldownTicks: 0, action: STOPPED, moved: false, ...over };
}

/** Bullet b<n> of a0, in flight. */
function bullet(n: number, pos: Vec2, vel: Vec2): Bullet {
  return { id: `b${n}`, owner: "a0", pos, vel, spawnTick: 0 };
}

/** A hand-built world, on map-1 unless another map is given. */
function world(parts: { agents: Fighter[]; bullets?: Bullet[]; map?: MapSpec; seed?: number; tick?: number }): WorldState {
  const { agents, bullets = [], map = getMap("map-1"), seed = 1, tick = 0 } = parts;
  return { tick, map, agents, bullets, nextBulletId: bullets.length, rng: createRng(seed), recent: [] };
}

/** Freezes a value and all it holds, so a step or a perception that writes to its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Steps `state` `ticks` times with no answers, each input frozen, showing `see` every new world. */
function run(state: WorldState, ticks: number, see: (state: WorldState) => void): void {
  for (let i = 0; i < ticks; i++) {
    state = step(deepFreeze(state), {});
    see(state);
  }
}

// ---- The goldens: each trace is regenerated and compared with its stored file, byte for byte ----

function singleBullet() {
  const trace: unknown[] = []; // [tick, b0 x, b0 y] after each step
  const start = world({ agents: [agent(0, { x: 10, y: 50 })], bullets: [bullet(0, { x: 10.6, y: 50 }, { x: 1.5, y: -0.05 })] });
  run(start, 50, (state) => trace.push([state.tick, roundTo(state.bullets[0]!.pos.x, 6), roundTo(state.bullets[0]!.pos.y, 6)]));
  return { scenario: "map-1; a0 at (10, 50) facing 0, stopped; b0 (owner a0) at (10.6, 50) moving (1.5, -0.05) m/tick; 50 ticks", trace };
}

function bulletWall() {
  const muzzle = { x: 10.6, y: 24 };
  const toward = (p: Vec2) => {
    const length = Math.hypot(p.x - muzzle.x, p.y - muzzle.y);
    return scale({ x: (p.x - muzzle.x) / length, y: (p.y - muzzle.y) / length }, BULLET_STEP_M);
  };
  const bullets = [
    bullet(0, muzzle, { x: BULLET_STEP_M, y: 0 }),
    bullet(1, muzzle, toward({ x: 24, y: 33 })),
    bullet(2, muzzle, scale(fromAngle(-120), BULLET_STEP_M)),
    bullet(3, muzzle, toward({ x: 42, y: 17.8 })),
  ];
  const removedAt: Record<string, number | null> = { b0: null, b1: null, b2: null, b3: null }; // the tick its path crossed a wall
  const trace: unknown[] = []; // [tick, ...[id, x, y] of the bullets still in flight]
  let flying = bullets.map((b) => b.id);
  run(world({ agents: [agent(0, { x: 10, y: 24 })], bullets }), 32, (state) => {
    for (const id of flying) if (!state.bullets.some((b) => b.id === id)) removedAt[id] = state.tick;
    flying = state.bullets.map((b) => b.id);
    trace.push([state.tick, ...state.bullets.map((b) => [b.id, roundTo(b.pos.x, 6), roundTo(b.pos.y, 6)])]);
  });
  return {
    scenario:
      "map-1; a0 at (10, 24) facing 0, stopped; its bullets from (10.6, 24) at 3 m/tick: " +
      "b0 at 0 deg into the north block (x = 42), b1 toward (24, 33) on the west triangle, " +
      "b2 at -120 deg into the boundary x = 0, b3 toward (42, 17.8) past the block's corner to x = 100; 32 ticks",
    removedAt,
    trace,
  };
}

function turnFire() {
  const shots: unknown[] = []; // [tick, bullet id, heading in degrees] per shot
  const trace: unknown[] = []; // [tick, a0 facing, bullets in flight]
  const start = world({ seed: 7, agents: [agent(0, { x: 50, y: 50 }, 0, { action: { ...STOPPED, turn: "right", fire: true } })] });
  run(start, 50, (state) => {
    for (const b of state.bullets) if (b.spawnTick === state.tick) shots.push([state.tick, b.id, roundTo(headingTo({ x: 0, y: 0 }, b.vel), 6)]);
    trace.push([state.tick, roundTo(state.agents[0]!.facing, 6), state.bullets.length]);
  });
  return { scenario: "map-1, seed 7; a0 at (50, 50) facing 0, action { stop, right, fire }; 50 ticks", shots, trace };
}

/** A hand-written world from test/scenes, and what every agent in it perceives. */
function scene(name: string) {
  const file = readFileSync(new URL(`scenes/${name}.json`, import.meta.url), "utf8");
  const { description, state } = deepFreeze(JSON.parse(file) as { description: string; state: WorldState });
  return { scene: description, observations: Object.fromEntries(state.agents.map((a) => [a.id, perceive(state, a.id)])) };
}

const GOLDENS: Record<string, () => Record<string, unknown>> = {
  "single-bullet": singleBullet,
  "bullet-wall": bulletWall,
  "turn-fire": turnFire,
  ...Object.fromEntries(["cone-edge", "los-blocked", "hearing", "incoming", "combined"].map((name) => [name, () => scene(name)])),
};

/** Top-level fields pretty, each row of an array field on one line. */
function format(golden: Record<string, unknown>): string {
  const fields = Object.entries(golden).map(([key, value]) => {
    const body =
      Array.isArray(value) && value.length > 0
        ? `[\n${value.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`
        : JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
    return `  ${JSON.stringify(key)}: ${body}`;
  });
  return `{\n${fields.join(",\n")}\n}\n`;
}

describe("goldens", () => {
  for (const [name, make] of Object.entries(GOLDENS)) {
    it(name, () => expect(format(make())).toBe(readFileSync(new URL(`golden/${name}.json`, import.meta.url), "utf8")));
  }
});

// ---- The perception window ----

it("each shot reaches exactly one decision: the first one after it", () => {
  // a1's weapon is ready at step 7: it fires once, then holds fire. Decisions read the worlds of ticks 0, 10, 20, 30.
  let state = world({ agents: [agent(0, { x: 50, y: 10 }), agent(1, { x: 50, y: 40 }, 0, { cooldownTicks: 7, action: { ...STOPPED, fire: true } })] });
  const heard = [perceive(state, "a0").heard.length];
  for (let t = 1; t <= 30; t++) {
    state = step(state, t === 8 ? { a1: { fire: "no" } } : {});
    expect(state.recent.at(-1)!.shots).toEqual(t === 7 ? [{ agent: "a1", pos: { x: 50, y: 40 } }] : []);
    heard.push(perceive(state, "a0").heard.length);
  }
  expect(heard.flatMap((n, tick) => (n > 0 ? [tick] : []))).toEqual(Array.from({ length: DECISION_TICKS }, (_, i) => 7 + i)); // ticks 7..16
  expect([0, 10, 20, 30].filter((tick) => heard[tick]! > 0)).toEqual([10]);
});

// ---- Invariants ----

describe("seeded random answer streams never leave the map, enter an obstacle or produce a non-finite number", () => {
  const MOVES = ["forward", "back", "left", "right", "stop"];
  const TURNS = ["left", "right", "none", "face_target"];

  /** One stream of 150 ticks: how many moves were refused or slid, and how many shots were fired. */
  function stream(map: MapSpec, seed: number): { blocked: number; shots: number } {
    let rng = createRng(seed);
    const float = () => {
      const draw = nextFloat(rng);
      rng = draw.rng;
      return draw.value;
    };
    const pick = (items: string[]) => items[Math.floor(float() * items.length)]!;
    const fits = (p: Vec2) =>
      circleInsideMap(p, AGENT_RADIUS_M, map.width, map.height) && !map.obstacles.some((o) => circleOverlapsPolygon(p, AGENT_RADIUS_M, o.vertices));
    const agents = Array.from({ length: 4 }, (_, i) => {
      for (;;) {
        const pos = { x: float() * map.width, y: float() * map.height };
        if (fits(pos)) return agent(i, pos, 180 - float() * 360);
      }
    });
    let state = world({ map, seed, agents });
    let blocked = 0;
    let shots = 0;
    for (let t = 1; t <= 150; t++) {
      const answers: Record<string, Record<string, string>> = {};
      if (t % 5 === 1) for (const a of state.agents) if (float() >= 0.2) answers[a.id] = { move: pick(MOVES), turn: pick(TURNS), fire: pick(["yes", "no"]) };
      const next = step(state, answers);
      next.agents.forEach((a, i) => {
        const before = state.agents[i]!.pos;
        if (a.alive && a.action.move !== "stop" && !a.moved) blocked++;
        if (a.moved && Math.hypot(a.pos.x - before.x, a.pos.y - before.y) < 0.2499) blocked++; // slid along a wall
      });
      shots += next.recent.at(-1)!.shots.length;
      state = next;
      const where = `seed ${seed} tick ${t}`;
      for (const a of state.agents) {
        const finite = [a.pos.x, a.pos.y, a.facing, a.hp, a.cooldownTicks, a.kills].every(Number.isFinite);
        if (!finite) throw new Error(`${where}: ${JSON.stringify(a)} is not finite`);
        if (!fits(a.pos)) throw new Error(`${where}: ${a.id} at ${JSON.stringify(a.pos)} is out of bounds`);
        if (a.facing <= -180 || a.facing > 180 || a.hp < 0 || a.hp > AGENT_HP) throw new Error(`${where}: ${a.id} facing ${a.facing}, hp ${a.hp}`);
      }
      for (const b of state.bullets) {
        if (![b.pos.x, b.pos.y, b.vel.x, b.vel.y].every(Number.isFinite)) throw new Error(`${where}: ${b.id} is not finite`);
        if (!circleInsideMap(b.pos, 0, map.width, map.height)) throw new Error(`${where}: ${b.id} is outside`);
      }
    }
    return { blocked, shots };
  }

  it("200 streams on map-1", () => {
    let blocked = 0;
    let shots = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = stream(getMap("map-1"), seed);
      blocked += result.blocked;
      shots += result.shots;
    }
    expect(blocked).toBeGreaterThan(1000); // walls and weapons were really exercised: measured 2,684 and 7,518
    expect(shots).toBeGreaterThan(3000);
  });

  it("50 streams on a map with no obstacles", () => {
    let blocked = 0;
    for (let seed = 1000; seed < 1050; seed++) blocked += stream({ id: "open", width: 100, height: 100, obstacles: [], spawns: [] }, seed).blocked;
    expect(blocked).toBeGreaterThan(100); // the map's edge alone: measured 334
  });
});

it("a body may touch a wall but not enter it, and rounds a corner by the x part of its move first", () => {
  const walk = (from: Vec2, facing: number, ticks: number) => {
    let state = world({ agents: [agent(0, from, facing, { action: { ...STOPPED, move: "forward" } })] });
    for (let t = 0; t < ticks; t++) state = step(state, {});
    return state.agents[0]!;
  };
  expect(walk({ x: 1, y: 50 }, 180, 5)).toMatchObject({ pos: { x: 0.5, y: 50 }, moved: false }); // the map's west edge
  expect(walk({ x: 41, y: 24 }, 0, 5)).toMatchObject({ pos: { x: 41.5, y: 24 }, moved: false }); // the north block's west face
  const { pos } = walk({ x: 41.5, y: 17.5 }, 45, 1); // diagonally at the block's corner (42, 18): either part alone fits
  expect([pos.x > 41.6, pos.y]).toEqual([true, 17.5]);
});

it("the dead do nothing and perceive nothing, whatever answers land for them", () => {
  const dead = agent(0, { x: 50, y: 50 }, 0, { alive: false, hp: 0, deathTick: 3 });
  const state = step(world({ agents: [dead, agent(1, { x: 60, y: 50 })] }), { a0: { move: "forward", turn: "left", fire: "yes" } });
  expect(state.agents[0]).toMatchObject({ pos: { x: 50, y: 50 }, facing: 0, moved: false });
  expect(state.bullets).toEqual([]);
  expect(perceive(state, "a0")).toMatchObject({ visible: [], heard: [], incoming: [] });
});

// ---- Answers ----

describe("answers", () => {
  // a1 is in a0's cone, 11 m away; a2 is nearer, behind its back.
  const three = (a0: Partial<Fighter> = {}) =>
    deepFreeze(world({ agents: [agent(0, { x: 50, y: 50 }, 0, a0), agent(1, { x: 60, y: 55 }), agent(2, { x: 45, y: 50 })] }));
  const a0 = (state: WorldState) => state.agents[0]!;

  it("face_target aims at the nearest enemy in sight when the answer lands, and follows it until the next turn answer", () => {
    let state = step(three(), { a0: { turn: "face_target" } });
    expect(a0(state).action).toEqual({ ...STOPPED, turn: "face_target", target: "a1" });
    expect(a0(state).facing).toBe(9); // one tick of turning toward a1, at 26.6°
    let before = state;
    for (let t = 0; t < 5; t++) [before, state] = [state, step(state, { a1: { move: "left" } })]; // a1 walks; a0 is not asked again
    expect(a0(state).facing).toBe(headingTo(a0(before).pos, before.agents[1]!.pos)); // where a1 stood as the tick began
    expect(a0(step(state, { a0: { turn: "none" } })).action).toEqual(STOPPED);
  });

  it("face_target is none when the agent sees nobody", () => {
    const state = step(three({ facing: 90 }), { a0: { turn: "face_target", fire: "yes" } });
    expect(a0(state).action).toEqual({ ...STOPPED, fire: true });
    expect(a0(state).facing).toBe(90);
  });

  it("a partial answer keeps the other parts of the action, and no answer keeps all of it", () => {
    const busy: Action = { move: "forward", turn: "left", fire: true, target: null };
    expect(a0(step(three({ action: busy }), { a0: { fire: "no" } })).action).toEqual({ ...busy, fire: false });
    expect(a0(step(three({ action: busy }), { a0: { move: "back", turn: "up", fire: "maybe" } })).action).toEqual({ ...busy, move: "back" });
    expect(a0(step(three({ action: busy }), { a1: { move: "back" } })).action).toEqual(busy);
  });
});

// ---- The ranking ----

describe("ended", () => {
  const alive = (i: number, kills = 0, hp = 100) => agent(i, { x: 5, y: 5 }, 0, { kills, hp });
  const dead = (i: number, deathTick: number, kills = 0) => agent(i, { x: 5, y: 5 }, 0, { alive: false, hp: 0, deathTick, kills });

  it("is null while two are alive before the time limit, and a ranking once one is left", () => {
    expect(battleRoyale.ended(world({ tick: MATCH_TICKS - 1, agents: [alive(0), dead(1, 4), alive(2)] }))).toBeNull();
    expect(battleRoyale.ended(world({ tick: 300, agents: [dead(0, 120, 2), alive(1, 1, 40), dead(2, 299)] }))).toEqual(["a1", "a2", "a0"]);
    expect(battleRoyale.ended(world({ tick: 9, agents: [dead(0, 9), dead(1, 9, 1)] }))).toEqual(["a1", "a0"]);
  });

  it("ranks the living by kills, HP, list order; then the dead by latest death, kills, list order", () => {
    const agents = [
      dead(0, 300, 1), alive(1, 1, 40), dead(2, 900), alive(3, 2, 20), alive(4, 1, 80),
      dead(5, 300, 3), alive(6, 1, 40), dead(7, 300, 1), dead(10, 300, 1),
    ];
    expect(battleRoyale.ended(world({ tick: MATCH_TICKS, agents }))).toEqual(["a3", "a4", "a1", "a6", "a2", "a5", "a0", "a7", "a10"]);
  });
});

// ---- The maps and the texts ----

it("the two maps are valid: obstacles inside, 16 free spawns; the texts fit", () => {
  expect(battleRoyale.maps).toEqual(["map-1", "map-2"]);
  for (const [id, map] of Object.entries(MAPS)) {
    expect([map.id, map.width, map.height]).toEqual([id, MAP_SIZE_M, MAP_SIZE_M]);
    for (const { vertices } of map.obstacles) {
      expect(vertices.length).toBeGreaterThanOrEqual(3);
      for (const v of vertices) expect(circleInsideMap(v, 0, map.width, map.height)).toBe(true);
    }
    expect(new Set(map.spawns.map((p) => `${p.x},${p.y}`)).size).toBe(16);
    for (const p of map.spawns) {
      const room = AGENT_RADIUS_M + 1; // a body and a meter to spare
      expect(circleInsideMap(p, room, map.width, map.height) && !map.obstacles.some((o) => circleOverlapsPolygon(p, room, o.vertices))).toBe(true);
    }
    expect(battleRoyale.rules({ seed: 1, map: id }).length).toBeLessThan(1500);
  }
  expect(battleRoyale.defaultPrompt.length).toBeLessThanOrEqual(600);
});
