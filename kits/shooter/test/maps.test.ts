import { describe, expect, expectTypeOf, it } from "vitest";
import type * as z from "zod";
import { ARENA_HEIGHT_M, ARENA_WIDTH_M } from "../src/constants";
import { getMap, loadMap, MAP_IDS, MapSpecSchema, validateMap, Vec2Schema, type MapSpec } from "../src/maps";
import { dist, type Vec2 } from "../src/vec2";

describe("bundled maps", () => {
  it("MAP_IDS lists map-1 and map-2 and is frozen", () => {
    expect(MAP_IDS).toEqual(["map-1", "map-2"]);
    expect(Object.isFrozen(MAP_IDS)).toBe(true);
  });

  it("every listed map passes the geometry sanity check", () => {
    for (const id of MAP_IDS) expect(validateMap(getMap(id)), id).toEqual([]);
  });

  it("every listed map loads, passes MapSpecSchema and carries its own id", () => {
    for (const id of MAP_IDS) {
      const map = getMap(id);
      expect(map.id).toBe(id);
      expect(MapSpecSchema.parse(map)).toEqual(map);
    }
  });

  it("throws on an unknown id, naming the known ones", () => {
    expect(() => getMap("map-9")).toThrow(/unknown map id "map-9".*map-1/);
    expect(() => getMap("toString")).toThrow(/unknown map id "toString"/);
  });

  it("parses once: repeat calls return the same deeply frozen map", () => {
    const map = getMap("map-1");
    expect(getMap("map-1")).toBe(map);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.spawns)).toBe(true);
    expect(Object.isFrozen(map.spawns[0])).toBe(true);
    expect(Object.isFrozen(map.obstacles[0]?.vertices[0])).toBe(true);
  });
});

describe("map-1", () => {
  const map = getMap("map-1");
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

describe("map-2 (v1.4)", () => {
  const map = getMap("map-2");
  const wallDistance = (p: Vec2) => Math.min(p.x, p.y, map.width - p.x, map.height - p.y);

  it("is the §6.2 arena, about 100 by 100 m", () => {
    expect([map.width, map.height]).toEqual([ARENA_WIDTH_M, ARENA_HEIGHT_M]);
  });

  it("has 16 spawns spread around the edge: 3 to 5 m from the nearest wall, at least 8 m apart", () => {
    expect(map.spawns).toHaveLength(16);
    for (const spawn of map.spawns) {
      expect(wallDistance(spawn), JSON.stringify(spawn)).toBeGreaterThanOrEqual(3);
      expect(wallDistance(spawn), JSON.stringify(spawn)).toBeLessThanOrEqual(5);
    }
    for (const [i, a] of map.spawns.entries()) {
      for (const b of map.spawns.slice(i + 1)) expect(dist(a, b)).toBeGreaterThanOrEqual(8);
    }
  });

  it("has 5 or 6 obstacles, one of them a long wall (at least 40 m long, at most 3 m thick)", () => {
    expect(map.obstacles.length).toBeGreaterThanOrEqual(5);
    expect(map.obstacles.length).toBeLessThanOrEqual(6);
    const boxes = map.obstacles.map(({ vertices }) => {
      const xs = vertices.map((v) => v.x);
      const ys = vertices.map((v) => v.y);
      const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      return { long: Math.max(w, h), thick: Math.min(w, h) };
    });
    expect(boxes.some((b) => b.long >= 40 && b.thick <= 3)).toBe(true);
  });

  it("is asymmetric: no mirror or half-turn maps its obstacles onto themselves (map-1 has a half-turn)", () => {
    const vertexSet = (m: MapSpec, f: (v: Vec2) => Vec2 = (v) => v) =>
      new Set(m.obstacles.flatMap((o) => o.vertices.map((v) => JSON.stringify(f(v)))));
    const turns = {
      mirrorX: (v: Vec2) => ({ x: 100 - v.x, y: v.y }),
      mirrorY: (v: Vec2) => ({ x: v.x, y: 100 - v.y }),
      halfTurn: (v: Vec2) => ({ x: 100 - v.x, y: 100 - v.y }),
    };
    for (const [name, f] of Object.entries(turns)) expect(vertexSet(map, f), name).not.toEqual(vertexSet(map));
    const map1 = getMap("map-1");
    expect(vertexSet(map1, turns.halfTurn)).toEqual(vertexSet(map1));
  });
});

describe("validateMap: geometry sanity (v1.4)", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({
    vertices: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });
  const sound = (): MapSpec => ({
    id: "test",
    width: 100,
    height: 100,
    obstacles: [box(40, 40, 60, 60)],
    spawns: [
      { x: 4, y: 4 },
      { x: 96, y: 96 },
    ],
  });
  const withObstacle = (...points: [number, number][]): MapSpec => ({
    ...sound(),
    obstacles: [{ vertices: points.map(([x, y]) => ({ x, y })) }],
  });
  const withSpawns = (...points: [number, number][]): MapSpec => ({ ...sound(), spawns: points.map(([x, y]) => ({ x, y })) });
  const notSimple = [expect.stringMatching(/^obstacle 0 is not a simple polygon/)];

  it("a sound map has no problems", () => {
    expect(validateMap(sound())).toEqual([]);
  });

  it("a self-intersecting polygon (a bow tie)", () => {
    expect(validateMap(withObstacle([40, 40], [60, 60], [60, 40], [40, 60]))).toEqual(notSimple);
  });

  it("a polygon that touches itself, folds back on itself, repeats a vertex, or is flat", () => {
    expect(validateMap(withObstacle([40, 40], [60, 40], [60, 60], [50, 40], [40, 60]))).toEqual(notSimple);
    expect(validateMap(withObstacle([40, 40], [60, 40], [50, 40], [50, 60]))).toEqual(notSimple);
    expect(validateMap(withObstacle([40, 40], [40, 40], [60, 40], [60, 60]))).toEqual(notSimple);
    expect(validateMap(withObstacle([20, 20], [30, 20], [40, 20]))).toEqual(notSimple);
  });

  it("a concave but simple polygon is fine", () => {
    expect(validateMap(withObstacle([40, 40], [60, 40], [60, 60], [50, 50], [40, 60]))).toEqual([]);
  });

  it("fewer than 3 vertices, or a vertex outside the arena", () => {
    expect(validateMap(withObstacle([40, 40], [60, 60]))).toEqual([
      expect.stringMatching(/^obstacle 0 has 2 vertices; a polygon needs at least 3/),
    ]);
    expect(validateMap(withObstacle([90, 40], [110, 40], [90, 60]))).toEqual([
      expect.stringMatching(/^obstacle 0 has vertex \(110, 40\) outside the 100 × 100 m arena/),
    ]);
  });

  it("a spawn inside an obstacle, or closer than AGENT_RADIUS_M + 1 m to one", () => {
    expect(validateMap(withSpawns([50, 50], [96, 96]))).toEqual([
      expect.stringMatching(/^spawn 0 at \(50, 50\) is inside obstacle 0/),
    ]);
    expect(validateMap(withSpawns([38.6, 50], [96, 96]))).toEqual([
      expect.stringMatching(/^spawn 0 at \(38.6, 50\) is 1.4 m from obstacle 0; spawns need 1.5 m/),
    ]);
    expect(validateMap(withSpawns([38.5, 50], [96, 96]))).toEqual([]);
  });

  it("a spawn outside the arena or closer than 1.5 m to a wall", () => {
    expect(validateMap(withSpawns([-5, 50], [96, 96]))).toEqual([
      expect.stringMatching(/^spawn 0 at \(-5, 50\) is outside the arena/),
    ]);
    expect(validateMap(withSpawns([1, 50], [96, 96]))).toEqual([
      expect.stringMatching(/^spawn 0 at \(1, 50\) is 1 m from the arena wall; spawns need 1.5 m/),
    ]);
  });

  it("two spawns closer than 8 m", () => {
    expect(validateMap(withSpawns([10, 10], [15, 10], [96, 96]))).toEqual([
      expect.stringMatching(/^spawns 0 and 1 are 5 m apart; spawns need 8 m/),
    ]);
  });

  it("lists every problem, not just the first", () => {
    const map = { ...withObstacle([40, 40], [60, 60], [60, 40], [40, 60]), spawns: [{ x: 50, y: 52 }, { x: 52, y: 50 }] };
    expect(validateMap(map)).toHaveLength(4); // the bow tie, a spawn inside it, one 1.4 m from it, their spacing
  });
});

describe("loadMap: parse, check, freeze (the bundled-map loader)", () => {
  const raw = () => JSON.parse(JSON.stringify(getMap("map-2"))) as MapSpec;

  it("returns a deeply frozen MapSpec equal to its input", () => {
    const map = loadMap(raw());
    expect(map).toEqual(raw());
    expect(Object.isFrozen(map.obstacles[0]?.vertices[0])).toBe(true);
  });

  it("throws on a schema failure", () => {
    expect(() => loadMap({ ...raw(), width: -1 })).toThrow();
  });

  it("throws listing every geometry problem", () => {
    const bad = raw();
    bad.spawns[0] = { x: 50, y: 61 }; // inside the long wall, obstacle 0
    bad.spawns[1] = { x: 50, y: 66 }; // 4 m from the long wall, 5 m from spawn 0
    expect(() => loadMap(bad)).toThrow(
      /^map "map-2" is not sound:\n- spawn 0 at \(50, 61\) is inside obstacle 0\n- spawns 0 and 1 are 5 m apart/,
    );
  });
});

// ---- The map format's schemas, moved with them from platform/core/test/schemas.test.ts (ruling R23) ----

/** The path of every issue; [] when the value parses. */
function issuePaths(schema: z.ZodType, value: unknown): PropertyKey[][] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

/** The boundary round trip: parse, serialize, parse again. */
function roundTrip<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));
}

const mapSpec = {
  id: "box",
  width: 20,
  height: 10,
  obstacles: [{ vertices: [{ x: 5, y: 2 }, { x: 8, y: 2 }, { x: 6, y: 5 }] }],
  spawns: [{ x: 1, y: 1 }, { x: 19, y: 9 }],
};

describe("MapSpec and Vec2", () => {
  it("parses a map", () => {
    expect(roundTrip(MapSpecSchema, mapSpec)).toEqual(mapSpec);
  });

  it("Vec2 rejects NaN, infinities and missing coordinates", () => {
    expect(issuePaths(Vec2Schema, { x: Number.NaN, y: 0 })).toEqual([["x"]]);
    expect(issuePaths(Vec2Schema, { x: 0, y: Number.POSITIVE_INFINITY })).toEqual([["y"]]);
    expect(issuePaths(Vec2Schema, { x: 0 })).toEqual([["y"]]);
  });

  it.each([
    ["an obstacle with two vertices", { obstacles: [{ vertices: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }, ["obstacles", 0, "vertices"]],
    ["one spawn", { spawns: [{ x: 1, y: 1 }] }, ["spawns"]],
    ["zero width", { width: 0 }, ["width"]],
    ["negative height", { height: -10 }, ["height"]],
    ["a spawn with an infinite coordinate", { spawns: [{ x: 1, y: 1 }, { x: Number.NEGATIVE_INFINITY, y: 2 }] }, ["spawns", 1, "x"]],
    ["an empty id", { id: "" }, ["id"]],
  ])("rejects %s", (_name, change, path) => {
    expect(issuePaths(MapSpecSchema, { ...mapSpec, ...change })).toContainEqual(path);
  });
});

describe("inferred types agree with the internal types", () => {
  it("Vec2Schema infers Vec2", () => {
    expectTypeOf<z.infer<typeof Vec2Schema>>().toEqualTypeOf<Vec2>();
  });
});
