import { describe, expect, it } from "vitest";
import { makeTransform } from "../../src/replay/coords";

describe("makeTransform", () => {
  it("a 100 m wide map in a 500 px canvas gives scale 5", () => {
    const t = makeTransform(100, 100, 500, 500);
    expect(t.scale).toBe(5);
    expect(t.toPx({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(t.toPx({ x: 100, y: 100 })).toEqual({ x: 500, y: 500 });
  });

  it("maps the map center to the canvas center", () => {
    expect(makeTransform(100, 100, 800, 500).toPx({ x: 50, y: 50 })).toEqual({ x: 400, y: 250 });
    expect(makeTransform(100, 100, 500, 800).toPx({ x: 50, y: 50 })).toEqual({ x: 250, y: 400 });
    expect(makeTransform(200, 100, 500, 500).toPx({ x: 100, y: 50 })).toEqual({ x: 250, y: 250 });
  });

  it("keeps y down without flipping: map y 0 is the top edge, x 0 the left edge", () => {
    const t = makeTransform(100, 100, 800, 500); // letterboxed left and right by 150 px
    expect(t.toPx({ x: 0, y: 0 })).toEqual({ x: 150, y: 0 });
    expect(t.toPx({ x: 0, y: 100 })).toEqual({ x: 150, y: 500 });
    expect(t.toPx({ x: 100, y: 0 })).toEqual({ x: 650, y: 0 });
    expect(t.toPx({ x: 25, y: 75 })).toEqual({ x: 275, y: 375 });
  });

  it("letterboxes: the short canvas side limits the scale, the other side is centered", () => {
    const wide = makeTransform(100, 100, 800, 500);
    expect([wide.scale, wide.offsetX, wide.offsetY]).toEqual([5, 150, 0]);
    const tall = makeTransform(100, 100, 500, 800);
    expect([tall.scale, tall.offsetX, tall.offsetY]).toEqual([5, 0, 150]);
    const wideMap = makeTransform(200, 100, 500, 500); // 200 x 100 m map in a square canvas
    expect([wideMap.scale, wideMap.offsetX, wideMap.offsetY]).toEqual([2.5, 0, 125]);
    expect(wideMap.toPx({ x: 200, y: 100 })).toEqual({ x: 500, y: 375 });
  });

  it("keeps the meters-to-pixels aspect at every canvas size (resize)", () => {
    for (const [w, h] of [
      [500, 500],
      [1280, 720],
      [390, 844],
      [1001, 333],
    ] as const) {
      const t = makeTransform(100, 100, w, h);
      const origin = t.toPx({ x: 10, y: 10 });
      const right = t.toPx({ x: 40, y: 10 });
      const down = t.toPx({ x: 10, y: 40 });
      expect(right.x - origin.x).toBeCloseTo(down.y - origin.y, 9); // 30 m is the same length on both axes
      expect(right.y).toBe(origin.y);
      expect(down.x).toBe(origin.x);
      expect(t.scale).toBeCloseTo(Math.min(w, h) / 100, 9);
    }
  });

  it("keeps a margin of padPx on the limiting side", () => {
    const square = makeTransform(100, 100, 500, 500, 50);
    expect(square.scale).toBe(4);
    expect(square.toPx({ x: 0, y: 0 })).toEqual({ x: 50, y: 50 });
    expect(square.toPx({ x: 100, y: 100 })).toEqual({ x: 450, y: 450 });
    const wide = makeTransform(100, 100, 800, 500, 50);
    expect([wide.scale, wide.offsetX, wide.offsetY]).toEqual([4, 200, 50]);
  });

  it("never goes negative or NaN when the canvas is smaller than the padding (hidden, collapsed)", () => {
    for (const t of [makeTransform(100, 100, 60, 60, 50), makeTransform(100, 100, 0, 0)]) {
      expect(t.scale).toBe(0);
      const p = t.toPx({ x: 100, y: 100 });
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
