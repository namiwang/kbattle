// Colors and marker sizes of the replay. Plain data, no Pixi, so the browser
// smoke (scripts/smoke.ts) checks screenshot pixels against the same values.

import type { SlotKind } from "./log-index";

export const COLORS = Object.freeze({
  background: 0x0e1014, // page and letterbox around the arena
  floor: 0x1c212b,
  bounds: 0x56606e,
  obstacle: 0x465061,
  obstacleEdge: 0x6b7686,
  facing: 0xf4f6fa,
  label: 0xd5dbe3,
  unknownKind: 0x9aa4b2,
});

/** One color per slot kind (DESIGN.md row 23, 32): the user's mind, doer-only, scripted bot. */
export const KIND_COLORS: Readonly<Record<SlotKind, number>> = Object.freeze({
  prompted: 0xf2b134,
  doer: 0x3fc1e8,
  bot: 0xe2625b,
});

export function kindColor(kind: SlotKind | undefined): number {
  return kind === undefined ? COLORS.unknownKind : KIND_COLORS[kind];
}

/** Agent markers keep a fixed size on screen, in CSS pixels. */
export const MARKER = Object.freeze({ bodyRadiusPx: 6, facingLengthPx: 15, facingWidthPx: 2, labelSizePx: 11 });

/** Free space around the arena inside the canvas, in CSS pixels. */
export const STAGE_PAD_PX = 16;

/** Bullets (v2.3): a dot per bullet in flight and a fading trail behind it, sized in CSS pixels. */
export const BULLET = Object.freeze({ color: 0xffe08a, dotRadiusPx: 2.25, trailWidthPx: 1.5, trailAlpha: 0.8 });

/**
 * The followed agent's perception (v2.3): its vision cone, a ring around each
 * enemy it sees, a red tick toward each source of incoming fire. Sizes in CSS pixels.
 */
export const OVERLAY = Object.freeze({
  cone: 0xf4f6fa,
  coneFillAlpha: 0.12,
  coneEdgeAlpha: 0.45,
  coneEdgePx: 1,
  seen: 0x5ee08a,
  seenRingPx: 11,
  seenWidthPx: 2,
  incoming: 0xff3b3b,
  incomingFromPx: 18,
  incomingToPx: 30,
  incomingWidthPx: 2.5,
});
