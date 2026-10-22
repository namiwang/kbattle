// Web app entry: the one page of DESIGN.md §7. The Key, Mind and Match sections
// (v4.1) over the replay viewer, which opens on the sample log
// (platform/core/fixtures/sample-log.json); Upload, a drop or Download replace or save it.

import sampleLogUrl from "../../core/fixtures/sample-log.json?url";
import type { KbattleDebug } from "./replay/debug";
import { createReplayPage } from "./replay/page";
import { createShell } from "./ui/shell";
import { createStore } from "./ui/state";
import { browserStorage } from "./ui/storage";

async function main(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#app");
  if (!host) throw new Error("index.html has no #app element");
  const store = createStore(browserStorage());
  store.load();
  const shell = createShell(host, store);
  const page = createReplayPage(shell.replayHost);

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
    get follow() {
      return page.viewer?.follow ?? null;
    },
    drawnBullets: () => page.viewer?.drawnBullets() ?? { dots: [], trails: [] },
    drawnOverlay: () => page.viewer?.drawnOverlay() ?? null,
    drawnMind: () => page.viewer?.drawnMind() ?? null,
    validateForm: () => shell.validateForm(),
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
