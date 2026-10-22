// Bullets of the replay (DESIGN.md §7 item 5): each bullet of the Tick on
// screen as a small dot, and a fading trail through its positions over the last
// TRAIL_TICKS ticks. When a bullet leaves the Tick rows (it hit something,
// §5.3), its trail shrinks from the tail into the last recorded position and is
// gone TRAIL_TICKS ticks later. Trails are a window over the log, not playback
// history: playing, stepping and scrubbing to a tick all show the same trails.

import { Graphics } from "pixi.js";
import type { TickEvent } from "./log-index";
import { BULLET } from "./theme";

/** Ticks of positions a trail runs through (the plan's N). */
export const TRAIL_TICKS = 6;

/** A bullet in a Tick row: `[id, x, y]`. */
export type BulletRow = TickEvent["bullets"][number];

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  /** Ticks before the newest frame held: 0 is the tick on screen. */
  readonly age: number;
}

export interface Trail {
  readonly id: string;
  /** Oldest first, one per held tick whose row has the bullet. Its newest point has age 0 while the bullet flies. */
  readonly points: readonly TrailPoint[];
}

/** A ring buffer of the bullets of the last `capacity` ticks. */
export interface TrailBuffer {
  readonly capacity: number;
  /** The newest tick held; -1 while empty. */
  readonly tick: number;
  /**
   * Adds the bullets of `tick`. The tick after the newest is appended, and once
   * full the oldest tick drops out; any other tick starts the buffer over with it.
   */
  push(tick: number, bullets: readonly BulletRow[]): void;
  /**
   * Makes `tick` the newest, reading rows with `bulletsAt`: forward by less than
   * `capacity` it appends the ticks since the newest; any other jump refills the
   * last `capacity` ticks (never before tick 0); the same tick reads nothing.
   */
  seek(tick: number, bulletsAt: (tick: number) => readonly BulletRow[]): void;
  /** The trail of every bullet in the held ticks, in order of first appearance. */
  trails(): Trail[];
  clear(): void;
}

export function createTrailBuffer(capacity = TRAIL_TICKS): TrailBuffer {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`a trail holds a whole number of ticks, at least 1; got ${capacity}`);
  }
  const ring = new Array<{ tick: number; bullets: readonly BulletRow[] } | undefined>(capacity).fill(undefined);
  let oldest = 0; // ring index of the oldest frame
  let count = 0;
  let newest = -1;

  const buffer: TrailBuffer = {
    capacity,
    get tick() {
      return newest;
    },
    push(tick, bullets) {
      if (count > 0 && tick !== newest + 1) buffer.clear();
      if (count < capacity) {
        ring[(oldest + count) % capacity] = { tick, bullets };
        count++;
      } else {
        ring[oldest] = { tick, bullets };
        oldest = (oldest + 1) % capacity;
      }
      newest = tick;
    },
    seek(tick, bulletsAt) {
      if (count > 0 && tick === newest) return;
      const forward = count > 0 && tick > newest && tick - newest < capacity;
      if (!forward) buffer.clear();
      for (let t = forward ? newest + 1 : Math.max(0, tick - capacity + 1); t <= tick; t++) buffer.push(t, bulletsAt(t));
    },
    trails() {
      const byId = new Map<string, TrailPoint[]>();
      for (let i = 0; i < count; i++) {
        const frame = ring[(oldest + i) % capacity];
        if (!frame) continue;
        for (const [id, x, y] of frame.bullets) {
          let points = byId.get(id);
          if (!points) byId.set(id, (points = []));
          points.push({ x, y, age: newest - frame.tick });
        }
      }
      return [...byId].map(([id, points]) => ({ id, points }));
    },
    clear() {
      ring.fill(undefined);
      oldest = 0;
      count = 0;
      newest = -1;
    },
  };
  return buffer;
}

/** Opacity of the part of a trail that ends at a point of this age: 1 now, down to 0 at `capacity` ticks old. */
export function trailAlpha(age: number, capacity = TRAIL_TICKS): number {
  return Math.max(0, 1 - age / capacity);
}

/** What the bullet layer drew last, for the smoke and devtools. */
export interface DrawnBullets {
  /** Bullets in flight on the tick on screen, at their recorded position (meters). */
  dots: { id: string; x: number; y: number }[];
  /** Trails drawn as lines: bullet id and how many positions each runs through. Empty while trails are off. */
  trails: { id: string; points: number }[];
}

export interface BulletLayer {
  /** The trail lines: add them under the agents. */
  readonly trails: Graphics;
  /**
   * The dots: add them over the agents. Markers keep a fixed size on screen, so near a
   * target a bullet would otherwise vanish under its marker just before it hits.
   */
  readonly dots: Graphics;
  /** Draws a dot for each bullet still flying in `trails` and, with `showTrails`, the line through its points. */
  render(trails: readonly Trail[], showTrails: boolean): void;
  /** Tells the layer how many pixels a meter is, so dots and lines keep their size on screen. */
  setPixelsPerMeter(scale: number): void;
  drawn(): DrawnBullets;
}

export function createBulletLayer(capacity = TRAIL_TICKS): BulletLayer {
  const lines = new Graphics({ label: "bullet trails" });
  const dots = new Graphics({ label: "bullets" });
  let metersPerPx = 1;
  let shown: { trails: readonly Trail[]; showTrails: boolean } = { trails: [], showTrails: true };
  let drawn: DrawnBullets = { dots: [], trails: [] };

  const draw = () => {
    const { trails, showTrails } = shown;
    lines.clear();
    dots.clear();
    const drawnTrails: DrawnBullets["trails"] = [];
    if (showTrails) {
      // One stroke per age: every segment that ends at a point of that age shares its fade.
      for (let age = 0; age < capacity - 1; age++) {
        let any = false;
        for (const { points } of trails) {
          for (let i = 1; i < points.length; i++) {
            const from = points[i - 1];
            const to = points[i];
            if (!from || !to || to.age !== age) continue;
            lines.moveTo(from.x, from.y).lineTo(to.x, to.y);
            any = true;
          }
        }
        const alpha = BULLET.trailAlpha * trailAlpha(age, capacity);
        if (any) lines.stroke({ width: BULLET.trailWidthPx * metersPerPx, color: BULLET.color, alpha, cap: "round" });
      }
      for (const { id, points } of trails) if (points.length > 1) drawnTrails.push({ id, points: points.length });
    }
    const flying: DrawnBullets["dots"] = [];
    for (const { id, points } of trails) {
      const head = points.at(-1);
      if (head?.age === 0) {
        dots.circle(head.x, head.y, BULLET.dotRadiusPx * metersPerPx);
        flying.push({ id, x: head.x, y: head.y });
      }
    }
    if (flying.length > 0) dots.fill(BULLET.color);
    drawn = { dots: flying, trails: drawnTrails };
  };

  return {
    trails: lines,
    dots,
    render(trails, showTrails) {
      shown = { trails, showTrails };
      draw();
    },
    setPixelsPerMeter(scale) {
      metersPerPx = scale > 0 ? 1 / scale : 1;
      draw();
    },
    drawn: () => drawn,
  };
}
