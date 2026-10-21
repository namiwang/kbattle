// The page (DESIGN.md §7, one page, no routes): a header, the Key, Mind and
// Match sections, and a Replay section the replay page mounts in. Run (item 4)
// arrives with v4.2 and goes between Match and Replay.

import { el } from "./dom";
import { createKeySection } from "./key";
import { createMatchSection } from "./match";
import { createMindSection } from "./mind";
import type { Store } from "./state";
import "./ui.css";

export interface UiShell {
  /** Where the replay page mounts, under the "Replay" heading. */
  readonly replayHost: HTMLElement;
  /** Run match: disabled until v4.2 wires the runner to it. */
  readonly runButton: HTMLButtonElement;
  /** Checks the saved state as Run match does, shows the result under the button and returns its text. */
  validateForm(): string;
}

export function createShell(host: HTMLElement, store: Store): UiShell {
  const match = createMatchSection(store);
  const replayHost = el("div", { className: "ui-replay-host" });
  const page = el(
    "main",
    { className: "ui-page" },
    el(
      "header",
      { className: "ui-header" },
      el("h1", { textContent: "kbattle" }),
      el("p", {
        textContent: "LLM agents play a top-down battle royale. Write a mind for yours, run a match, watch the replay.",
      }),
    ),
    createKeySection(store),
    createMindSection(store),
    match.element,
    el("section", { className: "ui-replay" }, el("div", { className: "ui-replay-head" }, el("h2", { textContent: "Replay" })), replayHost),
  );
  host.append(page);
  return { replayHost, runButton: match.runButton, validateForm: match.validate };
}
