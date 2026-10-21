// The `window.__kbattle` hook: read-only state for the headless smoke
// (scripts/smoke.ts) and for poking at the viewer from devtools, plus the form
// check behind Run match (v4.1), which the smoke calls while the button is disabled.

import type { Vec2 } from "@kbattle/core";

export interface DrawnAgent {
  id: string;
  /** Position in map meters and facing in degrees, read back from the scene graph. */
  x: number;
  y: number;
  facing: number;
  /** Where the tip of the facing line is on the canvas, in CSS pixels, per Pixi's transforms. */
  tip: { x: number; y: number };
}

export interface KbattleDebug {
  /** True once a log is open and its first frame drawn; false while a file loads. */
  readonly ready: boolean;
  /** The tick on screen. */
  readonly tick: number;
  readonly lastTick: number;
  /** Current pixels per meter. */
  readonly scale: number;
  /** Map meters to canvas CSS pixels under the current transform. */
  toPx(v: Vec2): { x: number; y: number };
  drawnAgents(): DrawnAgent[];
  /** Checks the form as Run match does, shows the result under the button and returns its text ("Config OK" or the problems). */
  validateForm(): string;
}

declare global {
  interface Window {
    __kbattle?: KbattleDebug;
  }
}
