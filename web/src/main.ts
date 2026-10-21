// Web app entry. For now the page is the replay viewer, opened on the sample log
// (core/fixtures/sample-log.json); Upload, a drop or Download replace or save it.
// P4 composes the full page (DESIGN.md §7).

import sampleLogUrl from "../../core/fixtures/sample-log.json?url";
import type { KbattleDebug } from "./replay/debug";
import { createReplayPage } from "./replay/page";

async function main(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#app");
  if (!host) throw new Error("index.html has no #app element");
  const page = createReplayPage(host);

  // Reads whichever viewer is on screen, so it follows uploads.
  const debug: KbattleDebug = {
    get ready() {
      return page.ready;
    },
    get tick() {
      return page.viewer?.tick ?? 0;
    },
    get lastTick() {
      return page.viewer?.index.lastTick ?? 0;
    },
    get scale() {
      return page.viewer?.transform.scale ?? 0;
    },
    toPx: (v) => page.viewer?.transform.toPx(v) ?? { x: Number.NaN, y: Number.NaN },
    drawnAgents: () => page.viewer?.drawnAgents() ?? [],
  };
  window.__kbattle = debug;

  const response = await fetch(sampleLogUrl);
  if (!response.ok) throw new Error(`sample log: HTTP ${response.status}`);
  await page.open(new File([await response.blob()], "sample-log.json", { type: "application/json" }));
}

main().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement("pre");
  message.textContent = `Could not open the replay: ${error instanceof Error ? error.message : String(error)}`;
  document.body.append(message);
});
