import { MatchLogSchema } from "@kbattle/core";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../core/fixtures/sample-log.json" with { type: "json" };
import { createTrailBuffer, trailAlpha, TRAIL_TICKS, type BulletRow, type Trail } from "../../src/replay/bullets";
import { indexLog } from "../../src/replay/log-index";

const N = TRAIL_TICKS;

/** Bullet `id` flies one meter per tick along x, in the Tick rows from tick `from` to tick `to`. */
function straight(id: string, from: number, to: number): (tick: number) => BulletRow[] {
  return (tick) => (tick >= from && tick <= to ? [[id, tick, 50]] : []);
}

const xs = (trail: Trail | undefined) => trail?.points.map((p) => p.x);
const ages = (trail: Trail | undefined) => trail?.points.map((p) => p.age);

describe("trail buffer", () => {
  it("holds the last N = 6 ticks", () => {
    expect(N).toBe(6);
    expect(createTrailBuffer().capacity).toBe(6);
  });

  it("is a ring: once full, each new tick pushes the oldest out; points come oldest first", () => {
    const buffer = createTrailBuffer();
    const at = straight("b0", 0, 100);
    for (let t = 0; t <= 9; t++) buffer.push(t, at(t));
    expect(buffer.tick).toBe(9);
    const [trail, ...others] = buffer.trails();
    expect(others).toEqual([]);
    expect(trail?.id).toBe("b0");
    expect(xs(trail)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(ages(trail)).toEqual([5, 4, 3, 2, 1, 0]); // age 0 is the tick on screen
  });

  it("keeps fewer points while the bullet is young", () => {
    const buffer = createTrailBuffer();
    const at = straight("b0", 3, 100);
    for (let t = 0; t <= 4; t++) buffer.push(t, at(t));
    expect(xs(buffer.trails()[0])).toEqual([3, 4]);
  });

  it("expires a trail N ticks after its bullet left the Tick rows, shrinking from the tail meanwhile", () => {
    const buffer = createTrailBuffer();
    const at = straight("b1", 0, 10); // last in Tick 10, gone from Tick 11
    const seen: Record<number, number[] | undefined> = {};
    for (let t = 0; t <= 20; t++) {
      buffer.push(t, at(t));
      seen[t] = xs(buffer.trails().find((trail) => trail.id === "b1"));
    }
    expect(seen[10]).toEqual([5, 6, 7, 8, 9, 10]);
    expect(seen[11]).toEqual([6, 7, 8, 9, 10]);
    expect(seen[13]).toEqual([8, 9, 10]);
    expect(seen[15]).toEqual([10]);
    expect(seen[16]).toBeUndefined(); // 10 + N: removed within N ticks of leaving
    for (let t = 16; t <= 20; t++) expect(seen[t], `tick ${t}`).toBeUndefined();
    expect(buffer.trails()).toEqual([]);
  });

  it("keeps the newest point of a gone bullet at age ≥ 1, so nothing marks it as still flying", () => {
    const buffer = createTrailBuffer();
    const at = straight("b2", 0, 4);
    for (let t = 0; t <= 6; t++) buffer.push(t, at(t));
    expect(ages(buffer.trails()[0])).toEqual([5, 4, 3, 2]);
  });

  it("tracks bullets separately, in order of first appearance", () => {
    const buffer = createTrailBuffer();
    buffer.push(0, [["b5", 1, 1]]);
    buffer.push(1, [
      ["b5", 2, 1],
      ["b6", 9, 9],
    ]);
    buffer.push(2, [
      ["b6", 8, 9],
      ["b5", 3, 1],
    ]);
    expect(buffer.trails().map((t) => [t.id, xs(t)])).toEqual([
      ["b5", [1, 2, 3]],
      ["b6", [9, 8]],
    ]);
  });

  it("starts over when pushed any tick but the next one", () => {
    const buffer = createTrailBuffer();
    const at = straight("b0", 0, 100);
    for (let t = 0; t <= 5; t++) buffer.push(t, at(t));
    buffer.push(9, at(9));
    expect([buffer.tick, xs(buffer.trails()[0])]).toEqual([9, [9]]);
    buffer.push(4, at(4)); // backwards
    expect([buffer.tick, xs(buffer.trails()[0])]).toEqual([4, [4]]);
    buffer.clear();
    expect([buffer.tick, buffer.trails()]).toEqual([-1, []]);
  });

  it("rejects a capacity that is not a whole number of ticks", () => {
    expect(() => createTrailBuffer(0)).toThrow(RangeError);
    expect(() => createTrailBuffer(2.5)).toThrow(RangeError);
  });
});

describe("trail buffer seek", () => {
  /** A frame reader that records which ticks were read. */
  function reader(at: (tick: number) => BulletRow[]) {
    const reads: number[] = [];
    return { reads, read: (tick: number) => (reads.push(tick), at(tick)) };
  }

  it("appends the ticks since the newest when the tick moves forward by less than N", () => {
    const buffer = createTrailBuffer();
    const { reads, read } = reader(straight("b0", 0, 100));
    buffer.seek(10, read);
    reads.length = 0;
    buffer.seek(11, read); // a 1x frame
    buffer.seek(13, read); // a frame at 4x can move two ticks
    expect(reads).toEqual([11, 12, 13]);
    expect(xs(buffer.trails()[0])).toEqual([8, 9, 10, 11, 12, 13]);
  });

  it("reads only the last N ticks after a jump, forward or back, and never before tick 0", () => {
    const buffer = createTrailBuffer();
    const { reads, read } = reader(straight("b0", 0, 100));
    buffer.seek(50, read);
    expect(reads).toEqual([45, 46, 47, 48, 49, 50]);
    reads.length = 0;
    buffer.seek(20, read);
    expect(reads).toEqual([15, 16, 17, 18, 19, 20]);
    reads.length = 0;
    buffer.seek(2, read);
    expect(reads).toEqual([0, 1, 2]);
    reads.length = 0;
    buffer.seek(2, read); // same tick: nothing to read
    expect(reads).toEqual([]);
  });

  it("gives the same trails whether the tick was reached by playing, stepping or scrubbing", () => {
    const index = indexLog(MatchLogSchema.parse(sampleJson));
    const bulletsAt = (t: number) => index.byTick(t).bullets;
    const played = createTrailBuffer();
    const visits = [0, 1, 2, 70, 71, 72, 74, 75, 81, 100, 101, 103, 104, 105, 107, 110, 111, 140, 139, 141, 142, 3];
    for (const tick of visits) {
      played.seek(tick, bulletsAt);
      const scrubbed = createTrailBuffer();
      scrubbed.seek(tick, bulletsAt);
      expect(played.trails(), `tick ${tick}`).toEqual(scrubbed.trails());
    }
  });

  it("on the sample log: b3 (last in Tick 104, hit at 105) fades until 109 and is gone at 110", () => {
    const index = indexLog(MatchLogSchema.parse(sampleJson));
    const buffer = createTrailBuffer();
    const b3 = (tick: number) => {
      buffer.seek(tick, (t) => index.byTick(t).bullets);
      return buffer.trails().find((trail) => trail.id === "b3");
    };
    expect(ages(b3(104))).toEqual([5, 4, 3, 2, 1, 0]);
    expect(ages(b3(105))).toEqual([5, 4, 3, 2, 1]);
    expect(ages(b3(109))).toEqual([5]);
    expect(b3(110)).toBeUndefined();
  });
});

describe("trailAlpha", () => {
  it("fades with age: full on the tick on screen, a sliver at the end of the trail, nothing beyond it", () => {
    expect(trailAlpha(0)).toBe(1);
    const alphas = [0, 1, 2, 3, 4, 5].map((age) => trailAlpha(age));
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1] ?? 0);
    expect(trailAlpha(N - 1)).toBeGreaterThan(0);
    expect(trailAlpha(N)).toBe(0);
  });
});
