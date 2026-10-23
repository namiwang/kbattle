import { describe, expect, it } from "vitest";
import {
  bearingTo,
  deg2rad,
  headingTo,
  normalizeDeg,
  rad2deg,
  turnToward,
} from "../src/angles";

// Conventions under test (DESIGN.md §6.1, row 24): degrees, 0° = +x,
// clockwise-positive on screen. With y down, +90° points to +y.

describe("deg2rad / rad2deg", () => {
  it("convert between degrees and radians", () => {
    expect(deg2rad(180)).toBe(Math.PI);
    expect(deg2rad(-90)).toBe(-Math.PI / 2);
    expect(rad2deg(Math.PI / 2)).toBe(90);
    expect(rad2deg(deg2rad(37.5))).toBeCloseTo(37.5, 12);
  });
});

describe("normalizeDeg wraps into (-180, 180]", () => {
  it.each([
    [0, 0],
    [180, 180],
    [-180, 180],
    [540, 180],
    [-540, 180],
    [270, -90],
    [-90, -90],
    [181, -179],
    [-181, 179],
    [360, 0],
    [-360, 0],
    [719, -1],
  ])("normalizeDeg(%d) is %d", (input, expected) => {
    expect(normalizeDeg(input)).toBe(expected);
  });

  it("never returns -0", () => {
    expect(Object.is(normalizeDeg(0), 0)).toBe(true);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
    expect(Object.is(normalizeDeg(-360), 0)).toBe(true);
    expect(Object.is(normalizeDeg(720), 0)).toBe(true);
  });
});

describe("headingTo: absolute angle of to - from", () => {
  const origin = { x: 0, y: 0 };

  it.each([
    [{ x: 10, y: 0 }, 0],
    [{ x: 0, y: 10 }, 90], // +y is down on screen: 90° clockwise from +x
    [{ x: -10, y: 0 }, 180],
    [{ x: 0, y: -10 }, -90],
    [{ x: 10, y: 10 }, 45],
  ])("from the origin to %o is %d", (to, expected) => {
    expect(headingTo(origin, to)).toBe(expected);
  });

  it("is measured from the `from` point", () => {
    expect(headingTo({ x: 5, y: 5 }, { x: 5, y: 15 })).toBe(90);
  });

  it("gives 180, not -180, straight along -x even when dy is -0", () => {
    // atan2(-0, -10) is -π; the result must still land in (-180, 180].
    expect(headingTo(origin, { x: -10, y: -0 })).toBe(180);
  });
});

describe("bearingTo: relative to facing, (-180, 180], positive = right", () => {
  const origin = { x: 0, y: 0 };

  it.each([
    [0, { x: 10, y: 0 }, 0], // dead ahead
    [0, { x: 0, y: 10 }, 90], // facing +x, +y (down) is to the right
    [0, { x: 0, y: -10 }, -90],
    [0, { x: -10, y: 0 }, 180], // straight behind is +180, never -180
    [90, { x: 10, y: 0 }, -90], // facing down, +x is to the left
    [180, { x: 0, y: 10 }, -90], // facing -x, down is to the left
    [135, { x: -10, y: 0 }, 45],
    [-135, { x: -10, y: 0 }, -45], // across the ±180 seam
  ])("facing %d, target %o is at %d", (facing, to, expected) => {
    expect(bearingTo(origin, facing, to)).toBe(expected);
  });

  it("wraps across the seam: facing 170, target at heading -170 is 20 to the right", () => {
    const rad = deg2rad(-170);
    const to = { x: 10 * Math.cos(rad), y: 10 * Math.sin(rad) };
    expect(bearingTo(origin, 170, to)).toBeCloseTo(20, 9);
  });
});

describe("turnToward: at most maxStepDeg, the shorter way", () => {
  it("turns by the step toward the target", () => {
    expect(turnToward(0, 90, 9)).toBe(9);
    expect(turnToward(0, -90, 9)).toBe(-9);
  });

  it("stops at the target instead of overshooting", () => {
    expect(turnToward(10, 15, 9)).toBe(15);
  });

  it("crosses the ±180 seam the short way", () => {
    expect(turnToward(170, -150, 30)).toBe(-160);
    expect(turnToward(-170, 150, 30)).toBe(160);
    expect(turnToward(170, -170, 30)).toBe(-170);
  });

  it("turns right (clockwise) when the target is exactly behind", () => {
    expect(turnToward(0, 180, 30)).toBe(30);
  });

  it("returns a normalized facing", () => {
    expect(turnToward(175, 190, 30)).toBe(-170);
  });
});
