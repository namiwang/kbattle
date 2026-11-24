// Geometry of the battle royale: points, angles, and segments against circles, polygons and the map's edge.
// Meters, y down. Angles in degrees, 0° = +x, clockwise on screen; a bearing is relative to a facing, + to the right.
// Keep every operation and its order as written: a reference match is pinned at full precision.

export interface Vec2 {
  x: number;
  y: number;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Unit vector at absolute angle `deg`: fromAngle(90) is (0, 1), down on screen. */
export function fromAngle(deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

/** Any angle wrapped into (-180, 180], never -0. */
export function normalizeDeg(deg: number): number {
  const r = deg % 360;
  const n = r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
  return n === 0 ? 0 : n;
}

/** Absolute angle of `to - from`. */
export function headingTo(from: Vec2, to: Vec2): number {
  return normalizeDeg((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

/** Where `to` lies as seen from `from` facing `facing`: positive = right, 180 = behind. */
export function bearingTo(from: Vec2, facing: number, to: Vec2): number {
  return normalizeDeg(headingTo(from, to) - facing);
}

/** `facing` turned toward `target` by at most `maxStep`, the shorter way; a target exactly behind turns right. */
export function turnToward(facing: number, target: number, maxStep: number): number {
  const delta = normalizeDeg(target - facing);
  if (Math.abs(delta) <= maxStep) return normalizeDeg(target);
  return normalizeDeg(facing + Math.sign(delta) * maxStep);
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

// Below, a moving point goes p0 → p1 and t in [0, 1] is the fraction of the way.

/** Where p0 → p1 meets a → b, as t; null if never. Touching an end counts; parallel segments never meet. */
function segmentSegmentT(p0: Vec2, p1: Vec2, a: Vec2, b: Vec2): number | null {
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

/** First t at which p0 → p1 is within `r` of `c`: 0 if p0 already is; null if never. */
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
  const t = (-b - Math.sqrt(disc)) / (2 * a); // p0 is outside, so the smaller root is the entry
  return t >= 0 && t <= 1 ? t : null;
}

/** Even-odd rule; a point exactly on an edge may count as either side. */
function pointInPolygon(p: Vec2, vertices: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return Math.sqrt(ex * ex + ey * ey); // not Math.hypot: far slower in V8, and nothing overflows at this scale
}

/** Whether a circle overlaps a polygon: its center is inside, or an edge is closer than `r`. Touching is not overlapping. */
export function circleOverlapsPolygon(c: Vec2, r: number, vertices: readonly Vec2[]): boolean {
  if (pointInPolygon(c, vertices)) return true;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    if (pointSegmentDistance(c, vertices[j]!, vertices[i]!) < r) return true;
  }
  return false;
}

/** First t at which p0 → p1 is in the polygon: 0 if p0 is inside, else its first edge crossing; null if never. */
export function segmentPolygonT(p0: Vec2, p1: Vec2, vertices: readonly Vec2[]): number | null {
  if (pointInPolygon(p0, vertices)) return 0;
  let first: number | null = null;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const t = segmentSegmentT(p0, p1, vertices[j]!, vertices[i]!);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

/** First t at which p0 → p1 leaves the map [0, width] × [0, height]: 0 if p0 is outside; null if it stays in. */
export function segmentLeavesMapT(p0: Vec2, p1: Vec2, width: number, height: number): number | null {
  if (p0.x < 0 || p0.x > width || p0.y < 0 || p0.y > height) return 0;
  let first = Infinity;
  if (p1.x < 0) first = Math.min(first, -p0.x / (p1.x - p0.x));
  if (p1.x > width) first = Math.min(first, (width - p0.x) / (p1.x - p0.x));
  if (p1.y < 0) first = Math.min(first, -p0.y / (p1.y - p0.y));
  if (p1.y > height) first = Math.min(first, (height - p0.y) / (p1.y - p0.y));
  return first === Infinity ? null : first;
}

/** Whether a circle lies inside the map; touching its edge is inside. */
export function circleInsideMap(c: Vec2, r: number, width: number, height: number): boolean {
  return c.x - r >= 0 && c.x + r <= width && c.y - r >= 0 && c.y + r <= height;
}

/** Line of sight: a → b crosses or touches no obstacle edge. */
export function hasLineOfSight(a: Vec2, b: Vec2, obstacles: readonly { vertices: readonly Vec2[] }[]): boolean {
  for (const { vertices } of obstacles) {
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      if (segmentSegmentT(a, b, vertices[j]!, vertices[i]!) !== null) return false;
    }
  }
  return true;
}
