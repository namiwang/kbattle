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
