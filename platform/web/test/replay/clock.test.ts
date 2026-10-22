import { describe, expect, it } from "vitest";
import { createClock } from "../../src/replay/clock";

// TICK_MS is 50 (DESIGN.md row 10): 20 ticks per second of sim time at 1x.
const LAST = 142; // the sample log's last tick

function playing(from = 0) {
  const clock = createClock(LAST);
  clock.seek(from);
  clock.play();
  return clock;
}

describe("clock", () => {
  it("opens paused at tick 0 at 1x", () => {
    const clock = createClock(LAST);
    expect([clock.tick, clock.playing, clock.speed, clock.lastTick]).toEqual([0, false, 1, LAST]);
  });

  it("advancing 1000 ms at 1x moves 20 ticks", () => {
    const clock = playing();
    clock.advance(1000);
    expect(clock.tick).toBe(20);
  });

  it("scales sim time by speed: 1000 ms is 80 ticks at 4x, 40 at 2x, 10 at 0.5x, 5 at 0.25x", () => {
    for (const [speed, ticks] of [
      [4, 80],
      [2, 40],
      [0.5, 10],
      [0.25, 5],
    ] as const) {
      const clock = playing();
      clock.setSpeed(speed);
      clock.advance(1000);
      expect(clock.tick, `${speed}x`).toBe(ticks);
    }
  });

  it("carries the partial tick across frames: 60 frames of 1/60 s make 20 ticks at 1x and 5 at 0.25x", () => {
    for (const [speed, ticks] of [
      [1, 20],
      [0.25, 5],
    ] as const) {
      const clock = playing();
      clock.setSpeed(speed);
      for (let frame = 0; frame < 60; frame++) clock.advance(1000 / 60);
      expect(clock.tick, `${speed}x`).toBe(ticks);
    }
  });

  it("visits every tick in order when frames are one tick long", () => {
    const clock = playing();
    const seen: number[] = [];
    while (clock.playing) {
      clock.advance(50);
      seen.push(clock.tick);
    }
    expect(seen).toEqual(Array.from({ length: LAST }, (_, i) => i + 1));
  });

  it("pause freezes the tick; play resumes from it", () => {
    const clock = playing();
    clock.advance(500);
    clock.pause();
    clock.advance(10_000);
    expect([clock.tick, clock.playing]).toEqual([10, false]);
    clock.play();
    clock.advance(50);
    expect(clock.tick).toBe(11);
  });

  it("toggle flips between playing and paused", () => {
    const clock = createClock(LAST);
    clock.toggle();
    expect(clock.playing).toBe(true);
    clock.toggle();
    expect(clock.playing).toBe(false);
  });

  it("stops at the last tick and pauses there, however long the frame", () => {
    const clock = playing(130);
    clock.advance(60_000);
    expect([clock.tick, clock.playing]).toEqual([LAST, false]);
  });

  it("play at the last tick starts over from tick 0", () => {
    const clock = createClock(LAST);
    clock.seek(LAST);
    clock.play();
    expect([clock.tick, clock.playing]).toEqual([0, true]);
  });

  it("seek clamps to 0..lastTick, floors fractions and ignores NaN", () => {
    const clock = createClock(LAST);
    clock.seek(-3);
    expect(clock.tick).toBe(0);
    clock.seek(500);
    expect(clock.tick).toBe(LAST);
    clock.seek(7.9);
    expect(clock.tick).toBe(7);
    clock.seek(Number.NaN);
    expect(clock.tick).toBe(7);
  });

  it("seek starts the new tick fresh: time accumulated before it does not leak over", () => {
    const clock = playing();
    clock.advance(30); // 30 of 50 ms into tick 0
    clock.seek(100);
    clock.advance(30);
    expect([clock.tick, clock.playing]).toEqual([100, true]);
    clock.advance(20);
    expect(clock.tick).toBe(101);
  });

  it("step moves one tick, pauses, and stays put at either end", () => {
    const clock = playing(50);
    clock.step(1);
    expect([clock.tick, clock.playing]).toEqual([51, false]);
    clock.step(-1);
    clock.step(-1);
    expect(clock.tick).toBe(49);
    clock.seek(LAST);
    clock.step(1);
    expect(clock.tick).toBe(LAST);
    clock.seek(0);
    clock.step(-1);
    expect(clock.tick).toBe(0);
  });

  it("changing speed mid-play keeps the tick and applies from the next frame", () => {
    const clock = playing();
    clock.advance(1000);
    clock.setSpeed(2);
    expect(clock.tick).toBe(20);
    clock.advance(1000);
    expect(clock.tick).toBe(60);
  });

  it("rejects speeds other than 0.25, 0.5, 1, 2 and 4", () => {
    const clock = createClock(LAST);
    expect(() => clock.setSpeed(3)).toThrow(RangeError);
    expect(() => clock.setSpeed(0)).toThrow(RangeError);
    expect(clock.speed).toBe(1);
  });
});
