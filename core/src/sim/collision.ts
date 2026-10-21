// Geometry for the sim (DESIGN.md §6.2; sim rulings R4, R5, R7): bullets as
// segments against obstacle edges, the arena box and agent circles; agent
// bodies against obstacles; line of sight. Plain functions on Vec2, no state.
// A moving segment is p0 → p1 and t ∈ [0, 1] is the fraction of it travelled.
// Every check is O(edges); the sim calls them per bullet and per agent, which
// is fine at PoC scale (≤ 16 agents, a few dozen bullets, a handful of edges).

import type { Obstacle } from "../schemas";
import type { Vec2 } from "../vec2";

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Where segment p0 → p1 meets segment a → b, as t along p0 → p1; null if they do
 * not meet. Touching an end of either segment counts. Parallel and collinear
 * segments give null: a path grazing along an obstacle edge is caught by the
 * neighbouring edge at the shared vertex.
 */
export function segmentSegmentT(p0: Vec2, p1: Vec2, a: Vec2, b: Vec2): number | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = cross(dx, dy, ex, ey);
  if (denom === 0) return null;
  const fx = a.x - p0.x;
  const fy = a.y - p0.y;
  const t = cross(fx, fy, ex, ey) / denom;
  const u = cross(fx, fy, dx, dy) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** First t at which segment p0 → p1 is within `r` of `c`: 0 if p0 already is; null if never. */
export function segmentCircleT(p0: Vec2, p1: Vec2, c: Vec2, r: number): number | null {
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const k = fx * fx + fy * fy - r * r;
  if (k <= 0) return 0;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  // p0 is outside, so both roots share a sign; the smaller one is the entry.
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Even-odd rule. A point exactly on an edge may count as either side. */
export function pointInPolygon(p: Vec2, vertices: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from `p` to the segment a → b. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return Math.sqrt(ex * ex + ey * ey); // not Math.hypot: ~20× slower in V8, and no overflow risk at arena scale
}

/** Whether a circle overlaps a polygon: its center is inside, or an edge is closer than `r`. Touching is not overlapping. */
export function circleOverlapsPolygon(c: Vec2, r: number, vertices: readonly Vec2[]): boolean {
  if (pointInPolygon(c, vertices)) return true;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    if (pointSegmentDistance(c, vertices[j]!, vertices[i]!) < r) return true;
  }
  return false;
}

/** First t at which segment p0 → p1 is in the polygon: 0 if p0 is inside, else its first edge crossing; null if never. */
export function segmentPolygonT(p0: Vec2, p1: Vec2, vertices: readonly Vec2[]): number | null {
  if (pointInPolygon(p0, vertices)) return 0;
  let first: number | null = null;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const t = segmentSegmentT(p0, p1, vertices[j]!, vertices[i]!);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

/** First t at which segment p0 → p1 leaves the arena box [0, width] × [0, height]: 0 if p0 is outside; null if it stays in. */
export function segmentLeavesArenaT(p0: Vec2, p1: Vec2, width: number, height: number): number | null {
  if (p0.x < 0 || p0.x > width || p0.y < 0 || p0.y > height) return 0;
  let first = Infinity;
  if (p1.x < 0) first = Math.min(first, -p0.x / (p1.x - p0.x));
  if (p1.x > width) first = Math.min(first, (width - p0.x) / (p1.x - p0.x));
  if (p1.y < 0) first = Math.min(first, -p0.y / (p1.y - p0.y));
  if (p1.y > height) first = Math.min(first, (height - p0.y) / (p1.y - p0.y));
  return first === Infinity ? null : first;
}

/** Whether a circle lies inside the arena box; touching a wall is inside. */
export function circleInsideArena(c: Vec2, r: number, width: number, height: number): boolean {
  return c.x - r >= 0 && c.x + r <= width && c.y - r >= 0 && c.y + r <= height;
}

/** Line of sight (R7): the segment a → b crosses or touches no obstacle edge. */
export function hasLineOfSight(a: Vec2, b: Vec2, obstacles: readonly Obstacle[]): boolean {
  for (const { vertices } of obstacles) {
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      if (segmentSegmentT(a, b, vertices[j]!, vertices[i]!) !== null) return false;
    }
  }
  return true;
}
