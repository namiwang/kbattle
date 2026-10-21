// Bundled maps: hand-authored JSON in core/maps (DESIGN.md §6.2). Each goes
// through loadMap on first use: parsed with MapSpecSchema, checked by
// validateMap, then cached and deeply frozen, so a caller that mutates a spawn
// point fails loudly instead of corrupting the shared map.

import arena1 from "../maps/arena-1.json" with { type: "json" };
import arena2 from "../maps/arena-2.json" with { type: "json" };
import { AGENT_RADIUS_M } from "./constants";
import { MapSpecSchema, type MapSpec } from "./schemas";
import { pointPolygonDistance, segmentsIntersect } from "./sim/collision";
import { roundTo } from "./sim/round";
import { dist, type Vec2 } from "./vec2";

const BUNDLED: Readonly<Record<string, unknown>> = { "arena-1": arena1, "arena-2": arena2 };

/** Ids of the bundled maps. */
export const MAP_IDS: readonly string[] = Object.freeze(Object.keys(BUNDLED));

/** A spawn's clearance from every obstacle and wall: an agent body plus 1 m. */
export const SPAWN_CLEARANCE_M = AGENT_RADIUS_M + 1;

/** The least distance between two spawns. */
export const SPAWN_SPACING_M = 8;

const parsed = new Map<string, MapSpec>();

/** The bundled map with this id. Throws on an unknown id. */
export function getMap(id: string): MapSpec {
  const cached = parsed.get(id);
  if (cached) return cached;
  if (!Object.hasOwn(BUNDLED, id)) {
    throw new Error(`unknown map id "${id}" (known: ${MAP_IDS.join(", ")})`);
  }
  const map = loadMap(BUNDLED[id]);
  parsed.set(id, map);
  return map;
}

/**
 * A map from JSON: parsed with MapSpecSchema (throws a ZodError), checked with
 * validateMap (throws listing every problem), deeply frozen.
 */
export function loadMap(raw: unknown): MapSpec {
  const map = MapSpecSchema.parse(raw);
  const problems = validateMap(map);
  if (problems.length > 0) throw new Error(`map "${map.id}" is not sound:\n- ${problems.join("\n- ")}`);
  return deepFreeze(map);
}

/**
 * The geometry problems of a map, one sentence each; empty when it is sound.
 * Obstacles: at least 3 vertices, all inside the arena, a simple polygon (no
 * two edges cross or touch except neighbours at their shared vertex, no fold
 * back, some area). Spawns: inside the arena, at least SPAWN_CLEARANCE_M from
 * every wall and obstacle, at least SPAWN_SPACING_M from each other.
 */
export function validateMap(map: MapSpec): string[] {
  const problems: string[] = [];
  const inArena = (p: Vec2) => p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height;
  const polygons = map.obstacles.map((o) => o.vertices);

  polygons.forEach((vertices, i) => {
    if (vertices.length < 3) {
      problems.push(`obstacle ${i} has ${vertices.length} vertices; a polygon needs at least 3`);
      return;
    }
    for (const v of vertices.filter((v) => !inArena(v))) {
      problems.push(`obstacle ${i} has vertex ${at(v)} outside the ${map.width} × ${map.height} m arena`);
    }
    if (!isSimplePolygon(vertices)) {
      problems.push(`obstacle ${i} is not a simple polygon: edges cross, touch or fold back, or it has no area`);
    }
  });

  const clear = `spawns need ${SPAWN_CLEARANCE_M} m`;
  map.spawns.forEach((spawn, i) => {
    const named = `spawn ${i} at ${at(spawn)}`;
    const wall = Math.min(spawn.x, spawn.y, map.width - spawn.x, map.height - spawn.y);
    if (wall < 0) problems.push(`${named} is outside the arena`);
    else if (wall < SPAWN_CLEARANCE_M) problems.push(`${named} is ${roundTo(wall, 2)} m from the arena wall; ${clear}`);
    polygons.forEach((vertices, j) => {
      if (vertices.length < 3) return;
      const d = pointPolygonDistance(spawn, vertices);
      if (d === 0) problems.push(`${named} is inside obstacle ${j}`);
      else if (d < SPAWN_CLEARANCE_M) problems.push(`${named} is ${roundTo(d, 2)} m from obstacle ${j}; ${clear}`);
    });
  });

  for (let i = 0; i < map.spawns.length; i++) {
    for (let j = i + 1; j < map.spawns.length; j++) {
      const d = dist(map.spawns[i]!, map.spawns[j]!);
      if (d >= SPAWN_SPACING_M) continue;
      problems.push(`spawns ${i} and ${j} are ${roundTo(d, 2)} m apart; spawns need ${SPAWN_SPACING_M} m`);
    }
  }
  return problems;
}

/** No edge meets another except its two neighbours, at their shared vertex; no zero-length edge; non-zero area. */
function isSimplePolygon(vertices: readonly Vec2[]): boolean {
  const n = vertices.length;
  const v = (k: number) => vertices[((k % n) + n) % n]!;
  let doubleArea = 0;
  for (let i = 0; i < n; i++) doubleArea += v(i).x * v(i + 1).y - v(i + 1).x * v(i).y;
  if (Math.abs(doubleArea) < 1e-9) return false;
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [v(i - 1), v(i), v(i + 1)];
    if (b.x === c.x && b.y === c.y) return false; // zero-length edge
    // Neighbours a → b → c fold back when c turns straight back along b → a.
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const along = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (turn === 0 && along < 0) return false;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the first and last edges are neighbours
      if (segmentsIntersect(v(i), v(i + 1), v(j), v(j + 1))) return false;
    }
  }
  return true;
}

function at(p: Vec2): string {
  return `(${p.x}, ${p.y})`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
