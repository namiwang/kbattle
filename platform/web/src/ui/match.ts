// The Match section (DESIGN.md §7 item 3): map, seed, how many slots and of
// which kind, duration, and Run match. Without a key the prompted count shows 0
// and is locked (no-key mode, row 32); the saved form keeps the user's number
// for when a key comes back. The line under Run match is the check Run match
// makes (validateForm), kept current as the form changes.

import { MAP_IDS } from "@kbattle/core";
import type { SlotKind } from "../replay/log-index";
import { KIND_COLORS } from "../replay/theme";
import { el, showNumber, showText } from "./dom";
import { botsLabel, secondsLabel } from "./format";
import {
  DURATION_RANGE,
  effectiveConfig,
  formatFormResult,
  hasKey,
  SEED_RANGE,
  SLOT_RANGE,
  validateForm,
  type MatchForm,
  type Store,
} from "./state";

export interface MatchSection {
  readonly element: HTMLElement;
  /** Run match: disabled until v4.2 wires the runner to it. A click runs validate(). */
  readonly runButton: HTMLButtonElement;
  /** Checks the saved state as Run match does, shows the result under the button and returns its text. */
  validate(): string;
}

function numberInput(id: string, range: { min: number; max?: number }): HTMLInputElement {
  const input = el("input", { id, type: "number", step: "1", inputMode: "numeric", min: String(range.min) });
  if (range.max !== undefined) input.max = String(range.max);
  return input;
}

/** A dot in the replay's color for a slot kind, so the form reads like the replay's legend. */
function swatch(kind: SlotKind): HTMLElement {
  const dot = el("span", { className: "ui-swatch" });
  dot.style.background = `#${KIND_COLORS[kind].toString(16).padStart(6, "0")}`;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/** A labelled control; `rest` sits beside the control on its line. */
function field(caption: HTMLElement, control: HTMLElement, ...rest: HTMLElement[]): HTMLElement {
  const line = rest.length > 0 ? el("div", { className: "ui-inline" }, control, ...rest) : control;
  return el("div", { className: "ui-field" }, caption, line);
}

function label(forId: string, text: string, kind?: SlotKind): HTMLLabelElement {
  return el("label", { htmlFor: forId }, ...(kind ? [swatch(kind)] : []), text);
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

export function createMatchSection(store: Store): MatchSection {
  const map = el("select", { id: "ui-map" });
  for (const id of MAP_IDS) map.append(new Option(id, id));
  const seed = numberInput("ui-seed", SEED_RANGE);
  const random = el("button", { type: "button", className: "ui-button", textContent: "Random" });
  const slots = numberInput("ui-slots", SLOT_RANGE);
  const prompted = numberInput("ui-prompted", { min: 0 });
  const doerOnly = numberInput("ui-doer-only", { min: 0 });
  const bots = el("output", { id: "ui-bots" });
  bots.setAttribute("for", "ui-slots ui-prompted ui-doer-only");
  const duration = numberInput("ui-duration", DURATION_RANGE);
  const seconds = el("span", { className: "ui-seconds" });
  const noKey = el("p", {
    className: "ui-hint ui-nokey",
    textContent:
      "No key saved, so no prompted slots. Doer-only slots run without one: the default doer instructions " +
      "and a fixed plan, no thinker. Save a key above to play your own mind.",
  });
  const runButton = el("button", { type: "button", className: "ui-button ui-primary", textContent: "Run match", disabled: true });
  const result = el("pre", { className: "ui-result" });
  result.setAttribute("role", "status");

  const element = el(
    "section",
    { className: "ui-section ui-match" },
    el("h2", { textContent: "Match" }),
    el(
      "div",
      { className: "ui-grid" },
      field(label(map.id, "Map"), map),
      field(label(seed.id, "Seed"), seed, random),
      field(label(slots.id, "Slots"), slots),
      field(label(prompted.id, "Prompted slots", "prompted"), prompted),
      field(label(doerOnly.id, "Doer-only slots", "doer"), doerOnly),
      field(label(bots.id, "Bots", "bot"), bots),
      field(label(duration.id, "Duration"), duration, el("span", { className: "ui-unit", textContent: "ticks" }), seconds),
    ),
    el("p", {
      className: "ui-hint",
      textContent:
        "Prompted slots play your mind. Doer-only slots play the default doer instructions with a fixed plan and no " +
        `thinker. The rest are scripted bots, wanderer and camper in turn. ${SLOT_RANGE.min} to ${SLOT_RANGE.max} slots.`,
    }),
    noKey,
    el(
      "div",
      { className: "ui-run" },
      runButton,
      el("span", { className: "ui-hint", textContent: "Running a match from this page is the next step; for now the form is checked as you edit it." }),
    ),
    result,
  );

  const fields: Record<keyof MatchForm, HTMLElement> = { mapId: map, seed, slots, prompted, doerOnly, durationTicks: duration };
  const maxAttr = (n: number) => (Number.isFinite(n) ? String(Math.max(0, n)) : "");

  const render = () => {
    const { key, config } = store.state;
    const shown = effectiveConfig(config, key);
    showText(map, shown.mapId);
    showNumber(seed, shown.seed);
    showNumber(slots, shown.slots);
    showNumber(prompted, shown.prompted);
    showNumber(doerOnly, shown.doerOnly);
    showNumber(duration, shown.durationTicks);
    prompted.disabled = !hasKey(key);
    noKey.hidden = hasKey(key);
    prompted.max = maxAttr(shown.slots - shown.doerOnly);
    doerOnly.max = maxAttr(shown.slots - shown.prompted);
    bots.value = botsLabel(shown);
    const secs = secondsLabel(shown.durationTicks);
    seconds.textContent = secs === "" ? "" : `= ${secs}`;

    const outcome = validateForm(store.state);
    result.textContent = formatFormResult(outcome);
    result.classList.toggle("is-error", !outcome.ok);
    const bad = new Set(outcome.ok ? [] : outcome.issues.map((issue) => issue.path));
    for (const [path, control] of Object.entries(fields)) {
      if (bad.has(path)) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
  };

  const update = (patch: Partial<MatchForm>) => store.set({ config: { ...store.state.config, ...patch } });
  map.addEventListener("change", () => update({ mapId: map.value }));
  seed.addEventListener("input", () => update({ seed: seed.valueAsNumber }));
  random.addEventListener("click", () => update({ seed: randomSeed() }));
  slots.addEventListener("input", () => update({ slots: slots.valueAsNumber }));
  prompted.addEventListener("input", () => update({ prompted: prompted.valueAsNumber }));
  doerOnly.addEventListener("input", () => update({ doerOnly: doerOnly.valueAsNumber }));
  duration.addEventListener("input", () => update({ durationTicks: duration.valueAsNumber }));

  const validate = () => {
    render();
    return result.textContent ?? "";
  };
  runButton.addEventListener("click", validate);
  store.subscribe(render);
  render();
  return { element, runButton, validate };
}
