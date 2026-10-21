import { describe, expect, it } from "vitest";
import { ARENA_HEIGHT_M, ARENA_WIDTH_M } from "../src/constants";
import { getMap, MAP_IDS } from "../src/maps";
import { MapSpecSchema } from "../src/schemas";
import { dist, type Vec2 } from "../src/vec2";

describe("bundled maps", () => {
  it("MAP_IDS lists arena-1 and is frozen", () => {
    expect(MAP_IDS).toContain("arena-1");
    expect(Object.isFrozen(MAP_IDS)).toBe(true);
  });

  it("every listed map loads, passes MapSpecSchema and carries its own id", () => {
    for (const id of MAP_IDS) {
      const map = getMap(id);
      expect(map.id).toBe(id);
      expect(MapSpecSchema.parse(map)).toEqual(map);
    }
  });

  it("throws on an unknown id, naming the known ones", () => {
    expect(() => getMap("arena-9")).toThrow(/unknown map id "arena-9".*arena-1/);
    expect(() => getMap("toString")).toThrow(/unknown map id "toString"/);
  });

  it("parses once: repeat calls return the same deeply frozen map", () => {
    const map = getMap("arena-1");
    expect(getMap("arena-1")).toBe(map);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.spawns)).toBe(true);
    expect(Object.isFrozen(map.spawns[0])).toBe(true);
    expect(Object.isFrozen(map.obstacles[0]?.vertices[0])).toBe(true);
  });
});

describe("arena-1", () => {
  const map = getMap("arena-1");
  const wallDistance = (p: Vec2) => Math.min(p.x, p.y, map.width - p.x, map.height - p.y);

  it("is the §6.2 arena, about 100 by 100 m", () => {
    expect([map.width, map.height]).toEqual([ARENA_WIDTH_M, ARENA_HEIGHT_M]);
  });

  it("has 16 spawns (one per slot at most), inside the arena, 3 to 5 m from the nearest wall", () => {
    expect(map.spawns).toHaveLength(16);
    for (const spawn of map.spawns) {
      expect(wallDistance(spawn), JSON.stringify(spawn)).toBeGreaterThanOrEqual(3);
      expect(wallDistance(spawn), JSON.stringify(spawn)).toBeLessThanOrEqual(5);
    }
  });

  it("has no two spawns closer than 8 m", () => {
    for (const [i, a] of map.spawns.entries()) {
      for (const b of map.spawns.slice(i + 1)) {
        expect(dist(a, b), `${JSON.stringify(a)} to ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("has 3 to 5 obstacles, all at least 10 m from every wall", () => {
    expect(map.obstacles.length).toBeGreaterThanOrEqual(3);
    expect(map.obstacles.length).toBeLessThanOrEqual(5);
    for (const vertex of map.obstacles.flatMap((o) => o.vertices)) {
      expect(wallDistance(vertex), JSON.stringify(vertex)).toBeGreaterThanOrEqual(10);
    }
  });

  it("has no spawn inside an obstacle's bounding box", () => {
    for (const { vertices } of map.obstacles) {
      const xs = vertices.map((v) => v.x);
      const ys = vertices.map((v) => v.y);
      for (const s of map.spawns) {
        const inBox =
          s.x >= Math.min(...xs) && s.x <= Math.max(...xs) && s.y >= Math.min(...ys) && s.y <= Math.max(...ys);
        expect(inBox, JSON.stringify(s)).toBe(false);
      }
    }
  });
});
