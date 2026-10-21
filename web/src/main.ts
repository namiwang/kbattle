// Web app entry. For now the page is the replay viewer on the sample log
// (core/fixtures/sample-log.json); P4 composes the full page (DESIGN.md §7).

import { MatchLogSchema } from "@kbattle/core";
import sampleLogUrl from "../../core/fixtures/sample-log.json?url";
import type { KbattleDebug } from "./replay/debug";
import { mountReplay } from "./replay/viewer";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function main(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#app");
  if (!host) throw new Error("index.html has no #app element");
  const response = await fetch(sampleLogUrl);
  if (!response.ok) throw new Error(`sample log: HTTP ${response.status}`);
  const log = MatchLogSchema.parse(await response.json());
  const viewer = await mountReplay(host, log);

  const debug: KbattleDebug = {
    ready: false,
    get tick() {
      return viewer.tick;
    },
    lastTick: viewer.index.lastTick,
    get scale() {
      return viewer.transform.scale;
    },
    toPx: (v) => viewer.transform.toPx(v),
    drawnAgents: () => viewer.drawnAgents(),
  };
  window.__kbattle = debug;
  await nextFrame(); // Pixi's ticker draws on animation frames: after two, tick 0 is on screen
  await nextFrame();
  debug.ready = true;
}

main().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement("pre");
  message.textContent = `Could not open the replay: ${error instanceof Error ? error.message : String(error)}`;
  document.body.append(message);
});
