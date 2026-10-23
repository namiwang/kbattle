// Arena floor, bounds and obstacles of a MapSpec, drawn once in map meters
// inside the world container.

import type { MapSpec } from "@decision-arena/kit-shooter";
import { Graphics } from "pixi.js";
import { COLORS } from "./theme";

const BOUNDS_WIDTH_M = 0.4;
const OBSTACLE_EDGE_M = 0.25;

export function drawMap(map: MapSpec): Graphics {
  const g = new Graphics({ label: `map ${map.id}` });
  g.rect(0, 0, map.width, map.height).fill(COLORS.floor).stroke({ width: BOUNDS_WIDTH_M, color: COLORS.bounds });
  for (const obstacle of map.obstacles) {
    g.poly(
      obstacle.vertices.flatMap((v) => [v.x, v.y]),
      true,
    )
      .fill(COLORS.obstacle)
      .stroke({ width: OBSTACLE_EDGE_M, color: COLORS.obstacleEdge, join: "round" });
  }
  return g;
}
