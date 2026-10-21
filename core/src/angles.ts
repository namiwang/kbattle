// Angle helpers (DESIGN.md §6.1, row 24). Angles are degrees, 0° = +x,
// clockwise-positive on screen; with y down, +90° points to +y.
// Bearings are relative to facing, in (-180, 180], positive = to the right.

import type { Vec2 } from "./vec2";

export function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps any angle into (-180, 180]. Never returns -0. */
export function normalizeDeg(deg: number): number {
  const r = deg % 360; // (-360, 360), exact
  const n = r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
  return n === 0 ? 0 : n; // -0 === 0, so this also turns -0 into +0
}

/** Absolute angle of `to - from`, normalized. */
export function headingTo(from: Vec2, to: Vec2): number {
  return normalizeDeg(rad2deg(Math.atan2(to.y - from.y, to.x - from.x)));
}

/** Where `to` lies as seen from `from` facing `facing`: positive = right, 180 = behind. */
export function bearingTo(from: Vec2, facing: number, to: Vec2): number {
  return normalizeDeg(headingTo(from, to) - facing);
}

/**
 * The facing after turning from `facing` toward `targetFacing` by at most
 * `maxStepDeg`, the shorter way; stops at the target. A target exactly
 * behind turns right (clockwise). Result is normalized.
 */
export function turnToward(facing: number, targetFacing: number, maxStepDeg: number): number {
  const delta = normalizeDeg(targetFacing - facing);
  if (Math.abs(delta) <= maxStepDeg) return normalizeDeg(targetFacing);
  return normalizeDeg(facing + Math.sign(delta) * maxStepDeg);
}
