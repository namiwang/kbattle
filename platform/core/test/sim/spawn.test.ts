import { describe, expect, it } from "vitest";
import { headingTo } from "../../src/angles";
import { AGENT_HP } from "../../src/constants";
import { getMap } from "../../src/maps";
import type { MapSpec, MatchConfig, Slot } from "../../src/schemas";
import { createRng } from "../../src/rng";
import { spawn } from "../../src/sim/world";
import { STOP_ACTION } from "../../src/types";

// R14: agents take map spawns in a seeded shuffle, face the arena center, start
// with AGENT_HP and STOP_ACTION. R1: spawn yields tick 0.

const map1 = getMap("map-1");
const bots = (n: number): Slot[] => Array.from({ length: n }, () => ({ kind: "bot", bot: "wanderer" }));
const config = (seed: number, slots: number, mapId = "map-1"): MatchConfig => ({
  mapId,
  seed,
  durationTicks: 6000,
  slots: bots(slots),
});
const spawnKey = (state: ReturnType<typeof spawn>) => state.agents.map((a) => `${a.pos.x},${a.pos.y}`).join(" ");

describe("spawn: the world at tick 0", () => {
  const state = spawn(config(7, 4), map1);

  it("starts at tick 0 with no bullets, b0 next, the map and the match length", () => {
    expect(state.tick).toBe(0);
    expect(state.bullets).toEqual([]);
    expect(state.nextBulletId).toBe(0);
    expect(state.map).toBe(map1);
    expect(state.durationTicks).toBe(6000);
  });

  it("makes one agent per slot, a0… in slot order (§6.1)", () => {
    expect(state.agents.map((a) => [a.id, a.slot])).toEqual([
      ["a0", 0],
      ["a1", 1],
      ["a2", 2],
      ["a3", 3],
    ]);
  });

  it("gives every agent full HP, no kills, a ready weapon and STOP_ACTION", () => {
    for (const a of state.agents) {
      expect(a).toMatchObject({ hp: AGENT_HP, alive: true, deathTick: null, kills: 0, cooldownTicks: 0, moved: false });
      expect(a.action).toEqual(STOP_ACTION);
    }
  });

  it("starts with an empty perception window: no steps, so no shots, hits or near misses yet (R6, R15)", () => {
    expect(state.recent).toEqual([]);
  });

  it("faces every agent toward the arena center", () => {
    const center = { x: map1.width / 2, y: map1.height / 2 };
    for (const a of state.agents) expect(a.facing).toBe(headingTo(a.pos, center));
  });

  it("puts agents on distinct map spawns, copied rather than shared", () => {
    const spawns = map1.spawns.map((s) => `${s.x},${s.y}`);
    const taken = spawnKey(state).split(" ");
    expect(new Set(taken).size).toBe(4);
    for (const key of taken) expect(spawns).toContain(key);
    for (const a of state.agents) expect(map1.spawns).not.toContain(a.pos);
  });

  it("is plain data: a JSON round trip gives an equal state", () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("spawn: the seeded shuffle", () => {
  it("16 slots take all 16 spawns", () => {
    const state = spawn(config(1, 16), map1);
    expect(new Set(spawnKey(state).split(" ")).size).toBe(16);
  });

  it("the same seed gives the same world, including the RNG state", () => {
    expect(spawn(config(42, 16), map1)).toEqual(spawn(config(42, 16), map1));
  });

  it("different seeds give different assignments", () => {
    const keys = new Set(Array.from({ length: 20 }, (_, seed) => spawnKey(spawn(config(seed, 16), map1))));
    expect(keys.size).toBe(20);
  });

  it("shuffles: a0's spawn varies with the seed instead of always taking the first", () => {
    const first = new Set(Array.from({ length: 50 }, (_, seed) => spawnKey(spawn(config(seed, 1), map1))));
    expect(first.size).toBeGreaterThanOrEqual(10);
  });

  it("the RNG has advanced past the shuffle draws", () => {
    const state = spawn(config(5, 16), map1);
    expect(state.rng).not.toEqual(createRng(5));
  });
});

describe("spawn: misuse", () => {
  it("throws when there are more slots than spawns", () => {
    const tiny: MapSpec = { ...map1, id: "tiny", spawns: map1.spawns.slice(0, 2) };
    expect(() => spawn(config(1, 3, "tiny"), tiny)).toThrow(/3 slots.*2 spawns/);
  });

  it("throws when the config names another map", () => {
    expect(() => spawn(config(1, 2, "map-2"), map1)).toThrow(/map-2.*map-1/);
  });
});
