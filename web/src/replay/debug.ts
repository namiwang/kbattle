// The `window.__kbattle` hook: read-only state for the headless smoke
// (scripts/smoke.ts) and for poking at the viewer from devtools, plus the form
// check behind Run match (v4.1), which the smoke calls while the button is disabled.

import type { Vec2 } from "@kbattle/core";
import type { DrawnBullets } from "./bullets";
import type { DrawnOverlay } from "./overlay";

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
  /** The agent the follow camera centers on, or null when it is free (v2.3). */
  readonly follow: string | null;
  /** Bullet dots and trails as last drawn (v2.3). */
  drawnBullets(): DrawnBullets;
  /** The perception overlay as last drawn, or null while it is off or nobody is followed (v2.3). */
  drawnOverlay(): DrawnOverlay | null;
  /** Checks the form as Run match does, shows the result under the button and returns its text ("Config OK" or the problems). */
  validateForm(): string;
}

declare global {
  interface Window {
    __kbattle?: KbattleDebug;
  }
}
