// Playback clock of the replay: which tick is on screen, whether it plays, and
// how fast. A plain state machine (no DOM, no timers): the caller feeds it
// frame time with advance(dtMs). One tick is TICK_MS of sim time (row 10), so
// at speed s a second of wall time is s × 20 ticks. Ticks stay in 0..lastTick;
// playing stops on the last one.

import { TICK_MS } from "@kbattle/core";

export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4] as const);
export type Speed = (typeof SPEEDS)[number];

export interface Clock {
  readonly tick: number;
  readonly playing: boolean;
  readonly speed: Speed;
  readonly lastTick: number;
  /** Plays from the current tick; from tick 0 when already at the last one. */
  play(): void;
  pause(): void;
  toggle(): void;
  /** Jumps to `tick`, floored and clamped; keeps playing if it was. NaN is ignored. */
  seek(tick: number): void;
  /** One of SPEEDS; anything else throws a RangeError. */
  setSpeed(speed: number): void;
  /** One tick back or forward, clamped; pauses. */
  step(delta: 1 | -1): void;
  /** Feeds `dtMs` of wall time; moves the tick only while playing. */
  advance(dtMs: number): void;
}

const isSpeed = (speed: number): speed is Speed => (SPEEDS as readonly number[]).includes(speed);

// Frame times like 1000/60 do not sum exactly; without this, 60 of them make 19 ticks.
const EPSILON_TICKS = 1e-9;

export function createClock(lastTick: number): Clock {
  let tick = 0;
  let playing = false;
  let speed: Speed = 1;
  let partialMs = 0; // sim time spent inside the current tick

  const clamp = (t: number) => Math.min(Math.max(Math.floor(t), 0), lastTick);
  const jump = (t: number) => {
    tick = clamp(t);
    partialMs = 0;
  };

  const clock: Clock = {
    get tick() {
      return tick;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
    lastTick,
    play() {
      if (tick >= lastTick) jump(0);
      playing = true;
    },
    pause() {
      playing = false;
    },
    toggle() {
      if (playing) clock.pause();
      else clock.play();
    },
    seek(t) {
      if (!Number.isNaN(t)) jump(t);
    },
    setSpeed(s) {
      if (!isSpeed(s)) throw new RangeError(`speed must be one of ${SPEEDS.join(", ")}, got ${s}`);
      speed = s;
    },
    step(delta) {
      playing = false;
      jump(tick + delta);
    },
    advance(dtMs) {
      if (!playing || !(dtMs > 0)) return;
      partialMs += dtMs * speed;
      const ticks = Math.floor(partialMs / TICK_MS + EPSILON_TICKS);
      if (ticks === 0) return;
      partialMs = Math.max(0, partialMs - ticks * TICK_MS);
      tick = Math.min(tick + ticks, lastTick);
      if (tick === lastTick) {
        playing = false;
        partialMs = 0;
      }
    },
  };
  return clock;
}
