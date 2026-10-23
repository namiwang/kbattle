// 2D vectors in meters, screen convention: +x right, +y down (DESIGN.md §6.1, row 24).
// Angles are degrees, 0° = +x, clockwise-positive on screen. Helpers never mutate inputs.

import { deg2rad, normalizeDeg, rad2deg } from "./angles";

export interface Vec2 {
  x: number;
  y: number;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Unit vector along `v`; the zero vector stays zero. */
export function norm(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/** Rotates `v` by `deg`; positive turns clockwise on screen (+x toward +y). */
export function rot(v: Vec2, deg: number): Vec2 {
  const r = deg2rad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Unit vector pointing at absolute angle `deg`: fromAngle(90) is (0, 1), down on screen. */
export function fromAngle(deg: number): Vec2 {
  const r = deg2rad(deg);
  return { x: Math.cos(r), y: Math.sin(r) };
}

/** Absolute angle of `v` in (-180, 180]; inverse of fromAngle. */
export function angleOf(v: Vec2): number {
  return normalizeDeg(rad2deg(Math.atan2(v.y, v.x)));
}
