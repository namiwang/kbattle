// The mind panel of the replay (DESIGN.md row 27, §7 item 5): for the followed
// agent at the tick on screen, what it perceives, the plan it follows, the doer
// answers it acts on, and markers under the timeline for its thinker calls and
// its failed calls. The content is mindView (mind-selectors.ts), rebuilt only
// when the tick or the agent changes, and only the sections that changed are
// rewritten. Markers are rebuilt when the agent changes. CSS places them along
// the timeline's thumb track, so a resize moves them without any script.
// Element listeners only: nothing on document or window.

import type { PerceptionState } from "@kbattle/core";
import type { LogIndex } from "./log-index";
import {
  answerSummary,
  formatProbability,
  markerShapes,
  markersFor,
  mindView,
  type AnswerRow,
  type DrawnMind,
  type MarkerShape,
  type MindView,
} from "./mind-selectors";
import { kindColor } from "./theme";
import "./mind-panel.css";

/** The User Timing measure of a panel update. Each update replaces the previous one, so the timeline never fills up. */
export const MIND_RENDER_MEASURE = "mind-render";

export interface MindPanel {
  /** The panel: the viewer places it beside the canvas, or below it on a narrow window. */
  readonly element: HTMLElement;
  /** The marker strip: the viewer places it right under the timeline, exactly as wide. */
  readonly markers: HTMLElement;
  /** Shows `agent`'s mind at `tick`; null asks to follow an agent. Does nothing when neither changed. */
  render(tick: number, agent: string | null): void;
  /** What the panel shows, or null while nobody is followed. */
  drawn(): DrawnMind | null;
}

export interface MindPanelDeps {
  readonly index: LogIndex;
  /** The world at a tick: the viewer's per-tick memo, shared with the camera and the overlay. */
  readonly stateAt: (tick: number) => PerceptionState;
  /** Moves the clock to a tick: a marker was clicked. */
  readonly seek: (tick: number) => void;
}

export function createMindPanel({ index, stateAt, seek }: MindPanelDeps): MindPanel {
  const element = h("section", "replay-mind");
  const empty = h("p", "replay-mind-empty", "Follow an agent to see its mind");
  const body = h("div", "replay-mind-body");
  body.hidden = true;

  const swatch = h("span", "replay-mind-swatch");
  const title = h("h3", "replay-mind-title");
  const meta = h("span", "replay-mind-meta");
  const head = h("header", "replay-mind-head");
  head.append(swatch, title, meta);

  const self = h("dd", "replay-mind-self");
  const visible = h("dd", "replay-mind-visible");
  const heard = h("dd", "replay-mind-heard");
  const incoming = h("dd", "replay-mind-incoming");
  const facts = h("dl", "replay-mind-facts");
  facts.append(h("dt", "", "self"), self, h("dt", "", "visible"), visible, h("dt", "", "heard"), heard, h("dt", "", "incoming"), incoming);

  const planText = h("p", "replay-mind-plan-text");
  const planCaption = h("p", "replay-mind-caption replay-mind-plan-caption");
  const planFault = h("p", "replay-mind-fault replay-mind-plan-fault");

  const doerCaption = h("p", "replay-mind-caption replay-mind-doer-caption");
  const doerFault = h("p", "replay-mind-fault replay-mind-doer-fault");
  const answers = h("div", "replay-mind-answers");

  body.append(
    head,
    section("Perception", facts),
    section("Plan", planText, planCaption, planFault),
    section("Doer", doerCaption, doerFault, answers),
  );
  element.append(empty, body);

  const markers = h("div", "replay-mind-markers");
  // A pointer click must not leave focus on the marker, or the next space would click it
  // again instead of playing. Keyboard focus (Tab) still reaches it.
  markers.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest(".replay-mind-marker")) event.preventDefault();
  });
  markers.addEventListener("click", (event) => {
    const mark = event.target instanceof Element ? event.target.closest<HTMLElement>(".replay-mind-marker") : null;
    if (mark?.dataset.tick !== undefined) seek(Number(mark.dataset.tick));
  });

  let shownTick = Number.NaN;
  let shownAgent: string | null | undefined;
  let view: MindView | null = null;
  let shapes: readonly MarkerShape[] = [];
  // What each section shows: an update rewrites only the sections whose content changed.
  let shown = { perception: "", plan: "", doer: "" };

  const fill = (v: MindView) => {
    setText(meta, `${index.kindOf(v.agent) ?? "unknown slot"} · tick ${v.tick}`);

    const { lines } = v.perception;
    const perceptionKey = JSON.stringify(lines);
    if (perceptionKey !== shown.perception) {
      shown.perception = perceptionKey;
      self.textContent = lines.self;
      entries(visible, lines.visible);
      entries(heard, lines.heard);
      entries(incoming, lines.incoming);
    }

    const planKey = JSON.stringify(v.plan);
    if (planKey !== shown.plan) {
      shown.plan = planKey;
      planText.textContent = v.plan.text ?? "";
      planText.hidden = v.plan.text === null;
      planCaption.textContent = v.plan.caption;
      planFault.textContent = v.plan.fault ?? "";
      planFault.hidden = v.plan.fault === null;
    }

    // The caption names the call the answers come from, so it and the fault decide the rows.
    const doerKey = `${v.doer.caption}\n${v.doer.fault ?? ""}`;
    if (doerKey !== shown.doer) {
      shown.doer = doerKey;
      doerCaption.textContent = v.doer.caption;
      doerFault.textContent = v.doer.fault ?? "";
      doerFault.hidden = v.doer.fault === null;
      answers.replaceChildren(...v.doer.rows.map(answerElement));
    }
  };

  return {
    element,
    markers,
    render(tick, agent) {
      if (tick === shownTick && agent === shownAgent) return;
      const start = performance.now();
      if (agent !== shownAgent) {
        shapes = agent === null ? [] : markerShapes(markersFor(index, agent));
        markers.replaceChildren(...shapes.map((s) => markerElement(s, index.lastTick)));
        shown = { perception: "", plan: "", doer: "" };
        title.textContent = agent;
        swatch.style.background = `#${kindColor(agent === null ? undefined : index.kindOf(agent)).toString(16).padStart(6, "0")}`;
      }
      shownTick = tick;
      shownAgent = agent;
      element.dataset.tick = String(tick);
      if (agent === null) {
        delete element.dataset.agent;
        view = null;
      } else {
        element.dataset.agent = agent;
        view = mindView(index, stateAt(tick), agent);
        fill(view);
      }
      empty.hidden = view !== null;
      body.hidden = view === null;
      performance.clearMeasures(MIND_RENDER_MEASURE);
      performance.measure(MIND_RENDER_MEASURE, { start });
    },
    drawn: () => view && { ...view, markers: shapes },
  };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Writes `text` only when the element shows something else: no DOM mutation for an unchanged line. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function section(heading: string, ...children: HTMLElement[]): HTMLElement {
  const element = h("section", "replay-mind-section");
  element.append(h("h4", "", heading), ...children);
  return element;
}

/** One line per entry, or a muted "none". */
function entries(into: HTMLElement, lines: readonly string[]): void {
  into.replaceChildren(...(lines.length > 0 ? lines.map((line) => h("span", "replay-mind-entry", line)) : [h("span", "replay-mind-none", "none")]));
}

/** A question: its name and summary, then a bar per option (the pick lit), or one P(yes) bar with its threshold mark. */
function answerElement(row: AnswerRow): HTMLElement {
  const element = h("div", row.type === "noul" ? "replay-mind-q is-noul" : "replay-mind-q");
  element.dataset.question = row.question;
  const head = h("div", "replay-mind-q-head");
  head.append(h("span", "replay-mind-q-name", row.question), h("span", "replay-mind-q-sum", answerSummary(row)));
  element.append(head);
  if (row.type === "choice") {
    for (const o of row.options) element.append(bar(o.option, o.probability, o.chosen ? "is-chosen" : ""));
    return element;
  }
  const threshold = h("span", "replay-mind-bar-threshold");
  threshold.style.left = `${row.threshold * 100}%`;
  threshold.title = `threshold ${formatProbability(row.threshold)}`;
  element.append(bar("P(yes)", row.probability, row.crossed ? "is-crossed" : "", threshold));
  return element;
}

function bar(label: string, probability: number, state: string, mark?: HTMLElement): HTMLElement {
  const element = h("div", state ? `replay-mind-bar ${state}` : "replay-mind-bar");
  const track = h("span", "replay-mind-bar-track");
  const fill = h("span", "replay-mind-bar-fill");
  fill.style.width = `${Math.min(Math.max(probability, 0), 1) * 100}%`;
  track.append(fill);
  if (mark) track.append(mark);
  element.append(h("span", "replay-mind-bar-label", label), track, h("span", "replay-mind-bar-value", formatProbability(probability)));
  return element;
}

/** Where `tick` sits along the timeline, 0 to 1. */
const along = (tick: number, lastTick: number) => String(lastTick > 0 ? tick / lastTick : 0);

/** A marker element: a link line, or a button that seeks to its tick, titled with its hover text. */
function markerElement(shape: MarkerShape, lastTick: number): HTMLElement {
  if (shape.kind === "link") {
    const link = h("span", "replay-mind-link");
    link.dataset.kind = "link";
    link.dataset.from = String(shape.from);
    link.dataset.to = String(shape.to);
    link.style.setProperty("--from", along(shape.from, lastTick));
    link.style.setProperty("--to", along(shape.to, lastTick));
    return link;
  }
  const mark = h("button", `replay-mind-marker is-${shape.kind}${shape.kind === "applied" && !shape.ok ? " is-failed" : ""}`);
  mark.type = "button";
  mark.dataset.kind = shape.kind;
  mark.dataset.tick = String(shape.tick);
  mark.title = shape.title;
  mark.style.setProperty("--at", along(shape.tick, lastTick));
  return mark;
}
