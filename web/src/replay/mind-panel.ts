// The mind panel of the replay (DESIGN.md row 27, §7 item 5): for the followed
// agent at the tick on screen, what it perceives, the plan it follows, the doer
// answers it acts on with the perception they were decided on ("saw at tick
// T − 1, answered at tick T", R18), and markers under the timeline for its
// thinker calls and its failed calls. The content is mindView
// (mind-selectors.ts), rebuilt only when the tick or the agent changes, and
// only the sections that changed are rewritten. Markers are rebuilt when the
// agent changes. CSS places them along the timeline's thumb track, so a resize
// moves them without any script. Element listeners only: nothing on document
// or window.

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
  type PerceptionLines,
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
  /** The world at a tick: the viewer's memo, shared with the camera and the overlay (the panel also asks for the tick before a doer call). */
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

  const facts = factsList("replay-mind", "replay-mind-facts");

  const planText = h("p", "replay-mind-plan-text");
  const planCaption = h("p", "replay-mind-caption replay-mind-plan-caption");
  const planFault = h("p", "replay-mind-fault replay-mind-plan-fault");

  const doerCaption = h("p", "replay-mind-caption replay-mind-doer-caption");
  const doerFault = h("p", "replay-mind-fault replay-mind-doer-fault");
  // What the answers in force were decided on: its own class names, so selectors for the Perception block above never reach it.
  const sawCaption = h("p", "replay-mind-caption replay-mind-saw-caption");
  const saw = factsList("replay-mind-saw", "replay-mind-facts replay-mind-saw-facts");
  const answers = h("div", "replay-mind-answers");

  body.append(
    head,
    section("Perception", facts.element),
    section("Plan", planText, planCaption, planFault),
    section("Doer", doerCaption, doerFault, sawCaption, saw.element, answers),
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
      facts.show(lines);
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

    // The captions name the call the answers come from, so they and the fault decide the perception and the rows.
    const decided = v.doer.perception;
    const doerKey = `${v.doer.caption}\n${v.doer.fault ?? ""}\n${decided?.caption ?? ""}`;
    if (doerKey !== shown.doer) {
      shown.doer = doerKey;
      doerCaption.textContent = v.doer.caption;
      doerFault.textContent = v.doer.fault ?? "";
      doerFault.hidden = v.doer.fault === null;
      sawCaption.textContent = decided?.caption ?? "";
      sawCaption.hidden = decided === null;
      saw.element.hidden = decided === null;
      if (decided) saw.show(decided.lines);
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
        view = mindView(index, stateAt, tick, agent);
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

/** A perception as a list: self, visible, heard, incoming, each a <dd> classed `${prefix}-self` and so on. */
function factsList(prefix: string, className: string): { element: HTMLElement; show(lines: PerceptionLines): void } {
  const self = h("dd", `${prefix}-self`);
  const visible = h("dd", `${prefix}-visible`);
  const heard = h("dd", `${prefix}-heard`);
  const incoming = h("dd", `${prefix}-incoming`);
  const element = h("dl", className);
  element.append(h("dt", "", "self"), self, h("dt", "", "visible"), visible, h("dt", "", "heard"), heard, h("dt", "", "incoming"), incoming);
  return {
    element,
    show(lines) {
      self.textContent = lines.self;
      entries(visible, lines.visible);
      entries(heard, lines.heard);
      entries(incoming, lines.incoming);
    },
  };
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
