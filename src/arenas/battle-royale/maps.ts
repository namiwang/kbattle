// The two maps, written by hand. Plain data: a test checks them, nothing validates them at load.

import type { Vec2 } from "./geometry.ts";

/** A map spans x 0..width, y 0..height. An obstacle is a simple polygon that blocks movement, bullets and sight. */
export type MapSpec = {
  id: string;
  width: number;
  height: number;
  obstacles: { vertices: Vec2[] }[];
  spawns: Vec2[]; // one per agent, taken in a shuffled order
};

export function getMap(id: string): MapSpec {
  if (!Object.hasOwn(MAPS, id)) throw new Error(`no map "${id}"`);
  return MAPS[id]!;
}

export const MAPS: Record<string, MapSpec> = {
  "map-1": {
    id: "map-1",
    width: 100,
    height: 100,
    obstacles: [
      { vertices: [{ x: 42, y: 18 }, { x: 58, y: 18 }, { x: 58, y: 30 }, { x: 42, y: 30 }] },
      { vertices: [{ x: 18, y: 30 }, { x: 30, y: 36 }, { x: 18, y: 42 }] },
      { vertices: [{ x: 82, y: 58 }, { x: 82, y: 70 }, { x: 70, y: 64 }] },
      { vertices: [{ x: 42, y: 70 }, { x: 58, y: 70 }, { x: 58, y: 82 }, { x: 42, y: 82 }] },
    ],
    spawns: [
      { x: 4, y: 4 }, { x: 27, y: 4 }, { x: 50, y: 4 }, { x: 73, y: 4 },
      { x: 96, y: 4 }, { x: 96, y: 27 }, { x: 96, y: 50 }, { x: 96, y: 73 },
      { x: 96, y: 96 }, { x: 73, y: 96 }, { x: 50, y: 96 }, { x: 27, y: 96 },
      { x: 4, y: 96 }, { x: 4, y: 73 }, { x: 4, y: 50 }, { x: 4, y: 27 },
    ],
  },
  "map-2": {
    id: "map-2",
    width: 100,
    height: 100,
    obstacles: [
      { vertices: [{ x: 20, y: 60 }, { x: 66, y: 60 }, { x: 66, y: 62 }, { x: 20, y: 62 }] },
      { vertices: [{ x: 62, y: 14 }, { x: 84, y: 14 }, { x: 84, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 36 }, { x: 62, y: 36 }] },
      { vertices: [{ x: 14, y: 22 }, { x: 26, y: 16 }, { x: 34, y: 24 }, { x: 28, y: 36 }, { x: 16, y: 34 }] },
      { vertices: [{ x: 46, y: 36 }, { x: 54, y: 42 }, { x: 46, y: 48 }, { x: 38, y: 42 }] },
      { vertices: [{ x: 72, y: 72 }, { x: 88, y: 78 }, { x: 76, y: 88 }] },
      { vertices: [{ x: 26, y: 78 }, { x: 36, y: 78 }, { x: 36, y: 86 }, { x: 26, y: 86 }] },
    ],
    spawns: [
      { x: 4, y: 4 }, { x: 21, y: 4 }, { x: 44, y: 4 }, { x: 70, y: 4 },
      { x: 96, y: 4 }, { x: 96, y: 26 }, { x: 96, y: 49 }, { x: 96, y: 72 },
      { x: 96, y: 96 }, { x: 78, y: 96 }, { x: 55, y: 96 }, { x: 31, y: 96 },
      { x: 4, y: 96 }, { x: 4, y: 80 }, { x: 4, y: 55 }, { x: 4, y: 30 },
    ],
  },
};
