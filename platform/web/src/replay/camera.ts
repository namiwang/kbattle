// Follow camera of the replay (DESIGN.md §7 item 5): a dropdown of "free" and
// every agent of the match. Free shows the whole arena as fitted; following
// keeps that zoom and moves the world so the agent sits at the middle of the
// canvas, re-centered every tick. Only the offset changes, never the scale.

import type { Vec2 } from "@decision-arena/core";
import type { Transform } from "./coords";
import type { LogIndex } from "./log-index";

/** The follow choice that shows the whole arena. */
export const FREE = "free";

/** The follow dropdown's choices: FREE, then every agent of the match in slot order. */
export function followChoices(index: LogIndex): string[] {
  return [FREE, ...index.agents];
}

/** The transform at `scale` pixels per meter that draws map point `center` at the middle of a screenW × screenH canvas. */
export function centerOn(center: Vec2, scale: number, screenW: number, screenH: number): Transform {
  const offsetX = screenW / 2 - center.x * scale;
  const offsetY = screenH / 2 - center.y * scale;
  return { scale, offsetX, offsetY, toPx: (v) => ({ x: offsetX + v.x * scale, y: offsetY + v.y * scale }) };
}

/** What the world shows: `fit` itself when free (center null), else `fit`'s zoom centered on `center`. */
export function cameraTransform(fit: Transform, center: Vec2 | null, screenW: number, screenH: number): Transform {
  return center ? centerOn(center, fit.scale, screenW, screenH) : fit;
}

/** The follow dropdown, named "Follow", on FREE. Its value is the choice. */
export function createFollowSelect(choices: readonly string[]): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "replay-follow";
  select.setAttribute("aria-label", "Follow");
  for (const choice of choices) select.append(new Option(choice, choice));
  select.value = FREE;
  return select;
}
