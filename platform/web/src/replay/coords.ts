// Meters-to-pixels transform for the replay (DESIGN.md §6.1): map meters are
// y down like the canvas, so the transform is a uniform scale plus an offset,
// never a flip. The map keeps its aspect inside any canvas (letterbox).

import type { Vec2 } from "@decision-arena/core";

export interface Transform {
  /** Pixels per meter, the same on both axes; 0 when the canvas has no room. */
  readonly scale: number;
  /** Canvas pixel of map point (0, 0). */
  readonly offsetX: number;
  readonly offsetY: number;
  toPx(v: Vec2): { x: number; y: number };
}

/**
 * Fits a mapW × mapH meter map into a canvasW × canvasH pixel canvas: the
 * largest uniform scale that leaves padPx free on every side, centered.
 */
export function makeTransform(mapW: number, mapH: number, canvasW: number, canvasH: number, padPx = 0): Transform {
  const scale = Math.max(0, Math.min((canvasW - 2 * padPx) / mapW, (canvasH - 2 * padPx) / mapH));
  const offsetX = (canvasW - mapW * scale) / 2;
  const offsetY = (canvasH - mapH * scale) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    toPx: (v) => ({ x: offsetX + v.x * scale, y: offsetY + v.y * scale }),
  };
}
