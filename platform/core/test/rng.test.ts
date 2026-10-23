import { describe, expect, it } from "vitest";
import { createRng, nextFloat, nextUint32, type RngState } from "../src/rng";

// R3: splitmix32, pure integer arithmetic, plain-data state that lives in WorldState.

/** Draws n values, threading the state the way step() does. */
function draw(rng: RngState, n: number, next = nextUint32): { values: number[]; rng: RngState } {
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = next(rng);
    values.push(r.value);
    rng = r.rng;
  }
  return { values, rng };
}

describe("splitmix32 known answers", () => {
  // Computed with an independent closure-style splitmix32 (bryc's reference JS), not this module.
  it.each([
    [0, [1684164658, 3653269916, 2939563536, 2141751570, 3295091513]],
    [1, [1580013426, 350525680, 3524174333, 3011703609, 643872864]],
    [42, [551831576, 144025891, 322543647, 3034809370, 908029994]],
    [4294967295, [3950124170, 4293442868, 1302505678, 2762329221, 3361369063]],
  ])("seed %d gives the reference uint32 sequence", (seed, expected) => {
    expect(draw(createRng(seed), 5).values).toEqual(expected);
  });

  it("nextFloat is the uint32 divided by 2^32", () => {
    expect(draw(createRng(1), 3, nextFloat).values).toEqual([
      0.3678755429573357, 0.08161311969161034, 0.8205357783008367,
    ]);
  });
});

describe("determinism and state", () => {
  it("two generators from one seed produce identical sequences", () => {
    expect(draw(createRng(12345), 1000).values).toEqual(draw(createRng(12345), 1000).values);
  });

  it("different seeds produce different sequences", () => {
    const a = draw(createRng(7), 20).values;
    const b = draw(createRng(8), 20).values;
    expect(a).not.toEqual(b);
    expect(a.filter((v, i) => v === b[i])).toHaveLength(0);
  });

  it("never mutates the state it is given", () => {
    const rng = Object.freeze(createRng(99));
    const before = { ...rng };
    const first = nextFloat(rng);
    expect(rng).toEqual(before);
    expect(nextFloat(rng)).toEqual(first); // same state, same draw
  });

  it("the state is plain data: a JSON round trip resumes the same sequence", () => {
    const mid = draw(createRng(2026), 37).rng;
    const revived = JSON.parse(JSON.stringify(mid)) as RngState;
    expect(revived).toEqual(mid);
    expect(draw(revived, 50).values).toEqual(draw(mid, 50).values);
  });

  it("wraps any number to an unsigned 32-bit seed", () => {
    expect(createRng(2 ** 32 + 5)).toEqual(createRng(5));
    expect(createRng(-1)).toEqual(createRng(4294967295));
  });
});

describe("nextFloat range", () => {
  it("stays in [0, 1) and spreads over the interval", () => {
    const { values } = draw(createRng(3), 10_000, nextFloat);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const deciles = new Array<number>(10).fill(0);
    for (const v of values) deciles[Math.floor(v * 10)]! += 1;
    for (const count of deciles) expect(count).toBeGreaterThan(900); // ~1000 each
  });
});
