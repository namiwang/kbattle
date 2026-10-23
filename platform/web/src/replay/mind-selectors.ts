// What the mind panel (DESIGN.md row 27, §7 item 5) shows for one agent at one
// tick: its perception (core.perceive on the world rebuilt from the log, §5.3),
// the plan and the doer answers in force (the log's Thinker and Doer events),
// the perception those answers were decided on, and the timeline markers. Pure
// and DOM-free: mindView is the whole panel as data, mind-panel.ts only draws it.
//
// A doer call at tick T is asked about the world before T's step, the world of
// tick T − 1 (sim ruling R1), so the Doer section shows perceive on that world,
// "saw at tick T − 1, answered at tick T" (R18), while the Perception block at
// the top shows the tick on screen.
//
// "In force" follows the fault model (§5.5): a failed call keeps the last plan
// (thinker) or the last answers (doer), so what shows is the latest ok: true
// event at or before the tick, and the failure itself is shown beside it.
// Thinker.tick is when a plan was applied (or its failure logged), requestedTick
// when it was asked for; the plan counts from `tick`.

import { ESCALATE_THRESHOLD } from "@decision-arena/core";
import type { ChoiceAnswer, DoerAnswers, QuestionId } from "@decision-arena/core/legacy";
import { FIRE_THRESHOLD, perceive, type Observation, type PerceptionState } from "@decision-arena/kit-shooter";
import type { DoerEvent, LogIndex, SlotKind, ThinkerEvent } from "./log-index";

/** What core.perceive gives an agent in one world, whether it is alive there, and the lines that show it. */
export interface PerceptionView {
  readonly observation: Observation;
  readonly alive: boolean;
  readonly lines: PerceptionLines;
}

/** The mind panel's content for one agent at one tick. */
export interface MindView {
  readonly tick: number;
  readonly agent: string;
  /** What the agent perceives at the tick on screen. */
  readonly perception: PerceptionView;
  readonly plan: {
    /** The plan text in force; null before the first plan. */
    readonly text: string | null;
    /** "applied at tick T (requested at R)", or why there is no plan. */
    readonly caption: string;
    /** The latest thinker call when it failed (so after the plan in force): what failed and what was kept. */
    readonly fault: string | null;
  };
  readonly doer: {
    /** "answered at tick T", "kept from tick T" when the latest call failed, or "(no answers yet)". */
    readonly caption: string;
    /** The latest doer call when it failed, with its error. */
    readonly fault: string | null;
    /**
     * What the agent perceived when it gave the answers in force (R18): the world of
     * tick T − 1 for the call answered at T, captioned "saw at tick T − 1, answered at
     * tick T"; null before the first answer.
     */
    readonly perception: (PerceptionView & { readonly tick: number; readonly caption: string }) | null;
    /** The answers in force as rows; empty before the first answer. */
    readonly rows: readonly AnswerRow[];
  };
}

/** Why an agent shows no plan, by slot kind (rows 23, 32): only prompted slots have a thinker. */
const NO_PLAN: Readonly<Record<SlotKind, string>> = Object.freeze({
  prompted: "(no plan yet)",
  doer: "(doer-only slot: fixed plan, no thinker)",
  bot: "(scripted bot: no plan)",
});

/**
 * The mind panel for `agent` at `tick`. `stateAt` gives the world at a tick (stateFromTick, or the
 * viewer's memo of it): the tick on screen, and the tick before the doer call in force. Throws if
 * no agent has that id.
 */
export function mindView(index: LogIndex, stateAt: (tick: number) => PerceptionState, tick: number, agent: string): MindView {
  const state = stateAt(tick);
  const { applied, last } = latestPlanAt(index, agent, state.tick);
  const thinkerFault = last && !last.ok ? last : undefined;
  const doer = latestDoerAt(index, agent, state.tick);
  const doerFault = doer.kept ? doer.last : undefined;
  const answeredAt = doer.answered?.tick;
  const saw = answeredAt === undefined ? null : Math.max(0, answeredAt - 1);
  return {
    tick: state.tick,
    agent,
    perception: perceptionView(state, agent),
    plan: {
      text: applied?.plan?.text ?? null,
      caption: applied ? `applied at tick ${applied.tick} (requested at ${applied.requestedTick})` : NO_PLAN[index.kindOf(agent) ?? "prompted"],
      fault: thinkerFault
        ? `Thinker fault at tick ${thinkerFault.tick}: ${thinkerFault.error ?? ""} — ${applied ? `kept the plan from tick ${applied.tick}` : "no plan yet"}`
        : null,
    },
    doer: {
      caption: doer.answered ? `${doer.kept ? "kept from" : "answered at"} tick ${doer.answered.tick}` : "(no answers yet)",
      fault: doerFault ? `Doer fault at tick ${doerFault.tick}: ${doerFault.error ?? ""}` : null,
      perception:
        saw === null
          ? null
          : { tick: saw, caption: `saw at tick ${saw}, answered at tick ${answeredAt}`, ...perceptionView(stateAt(saw), agent) },
      rows: doer.answered?.answers ? answerRows(doer.answered.answers) : [],
    },
  };
}

/** What `agent` perceives in `state`, as data and as lines. */
function perceptionView(state: PerceptionState, agent: string): PerceptionView {
  const observation = perceive(state, agent);
  const alive = state.agents.find((a) => a.id === agent)?.alive ?? false;
  return { observation, alive, lines: perceptionLines(observation, alive) };
}

/** An Observation as text: one line for self, one per entry of each list. */
export interface PerceptionLines {
  readonly self: string;
  readonly visible: readonly string[];
  readonly heard: readonly string[];
  readonly incoming: readonly string[];
}

/** Position in meters, absolute facing, relative bearings signed by side (§6.1: + is to the right). */
export function perceptionLines(observation: Observation, alive: boolean): PerceptionLines {
  const { pos, facing, hp, kills, secondsLeft } = observation.self;
  return {
    self: `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)} · facing ${facing.toFixed(1)}° · HP ${hp}${alive ? "" : " (dead)"} · kills ${kills} · ${secondsLeft.toFixed(1)} s left`,
    visible: observation.visible.map((v) => `${v.id} · ${bearing(v.bearing)} · ${v.dist} m · ${v.moving ? "moving" : "still"}`),
    heard: observation.heard.map((h) => `${h.kind} · ${bearing(h.bearing)} · ${h.dist}`),
    incoming: observation.incoming.map((i) => bearing(i.bearing)),
  };
}

const bearing = (degrees: number) => `${degrees > 0 ? "+" : ""}${degrees}°`;

export interface PlanAt {
  /** The plan in force: the latest Thinker event with ok: true at or before the tick; undefined before the first. */
  readonly applied: ThinkerEvent | undefined;
  /** The latest Thinker event of any kind at or before the tick. When it failed, it is newer than `applied`: the fault line. */
  readonly last: ThinkerEvent | undefined;
}

/** The plan `agent` follows at `tick`, and its latest thinker call (for the fault line). */
export function latestPlanAt(index: LogIndex, agent: string, tick: number): PlanAt {
  const calls = index.thinkerCalls.get(agent) ?? [];
  const i = lastAtOrBefore(calls, tick);
  return { applied: calls[latestOk(calls, i)], last: calls[i] };
}

export interface DoerAt {
  /** The latest Doer event at or before the tick, ok or not; undefined before the agent's first call. */
  readonly last: DoerEvent | undefined;
  /** The latest Doer event with ok: true at or before the tick: the answers in force. */
  readonly answered: DoerEvent | undefined;
  /** True when `last` failed: the answers in force (if any) were kept from `answered` (§5.5). */
  readonly kept: boolean;
}

/** The doer answers `agent` acts on at `tick`, and its latest doer call. */
export function latestDoerAt(index: LogIndex, agent: string, tick: number): DoerAt {
  const calls = index.doerCalls.get(agent) ?? [];
  const i = lastAtOrBefore(calls, tick);
  const last = calls[i];
  return { last, answered: calls[latestOk(calls, i)], kept: last !== undefined && !last.ok };
}

export interface MindMarkers {
  /** Every Thinker call of the agent, in tick order: applied (or failed) at `tick`, asked for at `requestedTick`. */
  readonly thinker: readonly { tick: number; requestedTick: number; ok: boolean }[];
  /** Every failed call (ok: false) of the agent, Doer and Thinker, in tick order; within a tick the thinker's first. */
  readonly faults: readonly { tick: number; kind: "Doer" | "Thinker"; error: string }[];
}

/** The timeline markers of `agent`: its thinker calls and its faults. */
export function markersFor(index: LogIndex, agent: string): MindMarkers {
  const thinkerCalls = index.thinkerCalls.get(agent) ?? [];
  const faults: { tick: number; kind: "Doer" | "Thinker"; error: string }[] = [];
  for (const call of thinkerCalls) if (!call.ok) faults.push({ tick: call.tick, kind: "Thinker", error: call.error ?? "" });
  for (const call of index.doerCalls.get(agent) ?? []) if (!call.ok) faults.push({ tick: call.tick, kind: "Doer", error: call.error ?? "" });
  // Stable: a thinker result lands before the doer is asked on the same tick, as the match loop logs them.
  faults.sort((a, b) => a.tick - b.tick);
  return { thinker: thinkerCalls.map(({ tick, requestedTick, ok }) => ({ tick, requestedTick, ok })), faults };
}

/** One mark under the timeline, with its hover text. Drawn in array order: later shapes on top. */
export type MarkerShape =
  /** A thin line from a call's requested tick to its applied tick. */
  | { readonly kind: "link"; readonly from: number; readonly to: number }
  /** A hollow dot where a call was asked for, when that is before it was applied. */
  | { readonly kind: "requested"; readonly tick: number; readonly title: string }
  /** A filled dot where a call's plan was applied (or its failure logged). */
  | { readonly kind: "applied"; readonly tick: number; readonly ok: boolean; readonly title: string }
  /** A red tick at a failed call. */
  | { readonly kind: "fault"; readonly tick: number; readonly source: "Doer" | "Thinker"; readonly title: string };

/**
 * The marks for `markers`: links, then requested dots, then applied dots, then
 * fault ticks. A call applied on the tick it was asked for is one dot.
 */
export function markerShapes(markers: MindMarkers): MarkerShape[] {
  const later = markers.thinker.filter((c) => c.requestedTick !== c.tick);
  return [
    ...later.map((c): MarkerShape => ({ kind: "link", from: c.requestedTick, to: c.tick })),
    ...later.map(
      (c): MarkerShape => ({
        kind: "requested",
        tick: c.requestedTick,
        title: `Thinker call requested at tick ${c.requestedTick}, ${c.ok ? "applied" : "failed"} at tick ${c.tick}`,
      }),
    ),
    ...markers.thinker.map(
      (c): MarkerShape => ({
        kind: "applied",
        tick: c.tick,
        ok: c.ok,
        title: `Thinker ${c.ok ? "plan applied" : "call failed"} at tick ${c.tick} (requested at ${c.requestedTick})`,
      }),
    ),
    ...markers.faults.map(
      (f): MarkerShape => ({ kind: "fault", tick: f.tick, source: f.kind, title: `${f.kind} fault at tick ${f.tick}: ${f.error}` }),
    ),
  ];
}

/** A `choice` answer as display rows: every option with its probability. */
export interface ChoiceRow {
  readonly question: QuestionId;
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  /** The answer's options, most likely first (ties keep the answer's order), the pick flagged. */
  readonly options: readonly { option: string; probability: number; chosen: boolean }[];
}

/** A `noul` answer (P(yes)) with the threshold that turns it into an action (row 25). */
export interface NoulRow {
  readonly question: QuestionId;
  readonly type: "noul";
  readonly probability: number;
  /** FIRE_THRESHOLD for fire, ESCALATE_THRESHOLD for escalate. */
  readonly threshold: number;
  /** probability ≥ threshold: the agent fires, or asks for its thinker. */
  readonly crossed: boolean;
}

export type AnswerRow = ChoiceRow | NoulRow;

/** One row per question answered, in the fixed order move, turn, fire, target, escalate (§5.4). */
export function answerRows(answers: DoerAnswers): AnswerRow[] {
  const rows: AnswerRow[] = [];
  if (answers.move) rows.push(choiceRow("move", answers.move));
  if (answers.turn) rows.push(choiceRow("turn", answers.turn));
  if (answers.fire) rows.push(noulRow("fire", answers.fire.noul, FIRE_THRESHOLD));
  if (answers.target) rows.push(choiceRow("target", answers.target)); // not asked when nobody is visible (I-005)
  if (answers.escalate) rows.push(noulRow("escalate", answers.escalate.noul, ESCALATE_THRESHOLD));
  return rows;
}

/** A probability as a percent with at most one decimal: 0.86 → "86%", 0.035 → "3.5%". */
export function formatProbability(p: number): string {
  return `${Math.round(p * 1000) / 10}%`;
}

/**
 * A row in one line: a choice as its pick and confidence ("forward · 58%"), a
 * noul as its comparison with the threshold and what that makes the agent do
 * ("34% < 50% · holds fire").
 */
export function answerSummary(row: AnswerRow): string {
  if (row.type === "choice") return `${row.choice} · ${formatProbability(row.confidence)}`;
  const verdict =
    row.question === "escalate" ? (row.crossed ? "escalates" : "does not escalate") : row.crossed ? "fires" : "holds fire";
  return `${formatProbability(row.probability)} ${row.crossed ? "≥" : "<"} ${formatProbability(row.threshold)} · ${verdict}`;
}

/** What the mind panel shows, for the smoke and devtools: its MindView and the markers under the timeline. */
export type DrawnMind = MindView & { readonly markers: readonly MarkerShape[] };

function choiceRow(question: QuestionId, answer: ChoiceAnswer): ChoiceRow {
  const options = Object.entries(answer.probabilities)
    .map(([option, probability]) => ({ option, probability, chosen: option === answer.choice }))
    .sort((a, b) => b.probability - a.probability); // stable
  return { question, type: "choice", choice: answer.choice, confidence: answer.confidence, options };
}

function noulRow(question: QuestionId, probability: number, threshold: number): NoulRow {
  return { question, type: "noul", probability, threshold, crossed: probability >= threshold };
}

/** Index of the last call at or before `tick` in `calls` (sorted by tick); -1 when there is none. */
function lastAtOrBefore(calls: readonly { tick: number }[], tick: number): number {
  let lo = 0;
  let hi = calls.length; // binary search for the first call after `tick`
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((calls[mid]?.tick ?? Infinity) <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Index of the latest call with ok: true at or before index `i`; -1 when there is none. */
function latestOk(calls: readonly { ok: boolean }[], i: number): number {
  let j = i;
  while (j >= 0 && calls[j]?.ok !== true) j--;
  return j;
}
