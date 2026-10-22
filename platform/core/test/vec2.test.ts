import { describe, expect, it } from "vitest";
import { normalizeDeg } from "../src/angles";
import {
  add,
  angleOf,
  dist,
  dot,
  fromAngle,
  len,
  norm,
  rot,
  scale,
  sub,
  type Vec2,
} from "../src/vec2";

// Meters, y down, degrees clockwise-positive with 0° = +x (DESIGN.md §6.1).
// toBeCloseTo(v, 9) means |error| < 5e-10.
function expectVec(actual: Vec2, expected: Vec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("vec2 arithmetic", () => {
  it("add, sub, scale, dot", () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: -5 })).toEqual({ x: 4, y: -3 });
    expect(sub({ x: 1, y: 2 }, { x: 3, y: -5 })).toEqual({ x: -2, y: 7 });
    expect(scale({ x: 1, y: -2 }, 3)).toEqual({ x: 3, y: -6 });
    expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
  });

  it("len and dist", () => {
    expect(len({ x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
    expect(dist({ x: 4, y: 5 }, { x: 1, y: 1 })).toBe(5);
  });

  it("norm returns a unit vector", () => {
    expectVec(norm({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });
    expect(len(norm({ x: -7, y: 2 }))).toBeCloseTo(1, 12);
  });

  it("norm leaves the zero vector at zero", () => {
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("returns new vectors and leaves the inputs alone", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    const sum = add(a, b);
    expect(sum).not.toBe(a);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 3, y: 4 });
  });
});

describe("fromAngle: unit vector for an absolute angle", () => {
  it.each([
    [0, { x: 1, y: 0 }],
    [90, { x: 0, y: 1 }], // the y-down guard: +90° from +x points to +y
    [180, { x: -1, y: 0 }],
    [-90, { x: 0, y: -1 }],
    [270, { x: 0, y: -1 }],
  ])("fromAngle(%d) is %o", (deg, expected) => {
    expectVec(fromAngle(deg), expected);
  });
});

describe("rot: clockwise-positive rotation on screen", () => {
  it("rotates +x by 90° onto +y", () => {
    expectVec(rot({ x: 1, y: 0 }, 90), { x: 0, y: 1 });
  });

  it("rotates +x by -90° onto -y", () => {
    expectVec(rot({ x: 1, y: 0 }, -90), { x: 0, y: -1 });
  });

  it("rotates +y (down) by 90° onto -x (left)", () => {
    expectVec(rot({ x: 0, y: 1 }, 90), { x: -1, y: 0 });
  });

  it("keeps length and agrees with fromAngle", () => {
    const v = rot({ x: 2, y: 0 }, 45);
    expectVec(v, { x: Math.SQRT2, y: Math.SQRT2 });
    expect(len(rot({ x: 3, y: -4 }, 123))).toBeCloseTo(5, 12);
    expectVec(rot(fromAngle(30), 60), fromAngle(90));
  });
});

describe("angleOf: inverse of fromAngle", () => {
  it.each([0, 30, 90, 135, 180, -45, -179, -180, 270, 540])(
    "angleOf(fromAngle(%d)) is the same direction",
    (deg) => {
      expect(normalizeDeg(angleOf(fromAngle(deg)) - deg)).toBeCloseTo(0, 9);
    },
  );

  it("returns exact axis angles in (-180, 180]", () => {
    expect(angleOf({ x: 5, y: 0 })).toBe(0);
    expect(angleOf({ x: 0, y: 5 })).toBe(90);
    expect(angleOf({ x: 0, y: -5 })).toBe(-90);
    expect(angleOf({ x: -5, y: 0 })).toBe(180);
  });

  it("gives 180, not -180, for -x reached through -0", () => {
    // scale({1, 0}, -1) is {-1, -0}; atan2(-0, -1) is -π.
    expect(angleOf(scale({ x: 1, y: 0 }, -1))).toBe(180);
  });
});
