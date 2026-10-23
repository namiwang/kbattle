import { ESCALATE_THRESHOLD } from "@decision-arena/core";
import { MatchLogSchema, type DoerAnswers, type MatchLog } from "@decision-arena/core/legacy";
import { FIRE_THRESHOLD, perceive } from "@decision-arena/kit-shooter";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../../kits/shooter/fixtures/sample-log.json" with { type: "json" };
import { indexLog } from "../../src/replay/log-index";
import {
  answerRows,
  answerSummary,
  formatProbability,
  latestDoerAt,
  latestPlanAt,
  markerShapes,
  markersFor,
  mindView,
  perceptionLines,
} from "../../src/replay/mind-selectors";
import { stateFromTick } from "../../src/replay/state-from-tick";

const sample = MatchLogSchema.parse(sampleJson);
const index = indexLog(sample);
const FIRST_PLAN = /^Walk the middle lane east\. /;
const REFUSAL = "refusal (stop_reason: refusal)";
const DOER_TIMEOUT = "timeout: no answer within 2000 ms";

describe("latestPlanAt on the sample log", () => {
  it("has no plan before the first Thinker event lands, though it was asked for at tick 1", () => {
    for (const t of [0, 1, 6]) expect(latestPlanAt(index, "a0", t)).toEqual({ applied: undefined, last: undefined });
  });

  it("tick 7: the plan asked for at tick 1 is applied", () => {
    const { applied, last } = latestPlanAt(index, "a0", 7);
    expect(applied).toMatchObject({ kind: "Thinker", tick: 7, requestedTick: 1, ok: true });
    expect(applied?.plan?.text).toMatch(FIRST_PLAN);
    expect(last).toBe(applied);
  });

  it("tick 77: still the plan of tick 7, nothing newer", () => {
    const { applied, last } = latestPlanAt(index, "a0", 77);
    expect(applied?.tick).toBe(7);
    expect(last).toBe(applied);
  });

  it("tick 78: the refusal is the latest call, the plan of tick 7 stays applied", () => {
    const { applied, last } = latestPlanAt(index, "a0", 78);
    expect(applied?.tick).toBe(7);
    expect(applied?.plan?.text).toMatch(FIRST_PLAN);
    expect(last).toMatchObject({ tick: 78, requestedTick: 71, ok: false, error: REFUSAL });
  });

  it("tick 142, the end, and any tick past it: the same", () => {
    for (const t of [142, 10_000]) {
      const { applied, last } = latestPlanAt(index, "a0", t);
      expect([applied?.tick, last?.tick]).toEqual([7, 78]);
    }
  });

  it("a1, a scripted bot, never has a plan", () => {
    expect(latestPlanAt(index, "a1", 142)).toEqual({ applied: undefined, last: undefined });
  });
});

describe("latestDoerAt on the sample log", () => {
  it("has nothing before the first call", () => {
    expect(latestDoerAt(index, "a0", 0)).toEqual({ last: undefined, answered: undefined, kept: false });
  });

  it("ticks 1 to 10 show the answers of tick 1", () => {
    for (const t of [1, 10]) {
      const doer = latestDoerAt(index, "a0", t);
      expect(doer.last?.tick).toBe(1);
      expect(doer.answered).toBe(doer.last);
      expect(doer.kept).toBe(false);
    }
  });

  it("tick 41, the call that timed out: its error, and the answers of tick 31 kept", () => {
    const doer = latestDoerAt(index, "a0", 41);
    expect(doer.last).toMatchObject({ kind: "Doer", tick: 41, ok: false, error: DOER_TIMEOUT });
    expect(doer.answered).toMatchObject({ tick: 31, ok: true });
    expect(doer.answered?.answers?.escalate?.noul).toBe(0.08);
    expect(doer.kept).toBe(true);
  });

  it("stays kept until the next call answers (tick 50), then shows it (tick 51)", () => {
    expect(latestDoerAt(index, "a0", 50)).toMatchObject({ last: { tick: 41 }, answered: { tick: 31 }, kept: true });
    expect(latestDoerAt(index, "a0", 51)).toMatchObject({ last: { tick: 51 }, answered: { tick: 51 }, kept: false });
  });

  it("a1 has no logged doer calls in the sample", () => {
    expect(latestDoerAt(index, "a1", 100)).toEqual({ last: undefined, answered: undefined, kept: false });
  });
});

describe("markersFor on the sample log", () => {
  it("a0: both thinker calls with their two ticks, and a fault for each failed call", () => {
    expect(markersFor(index, "a0")).toEqual({
      thinker: [
        { tick: 7, requestedTick: 1, ok: true },
        { tick: 78, requestedTick: 71, ok: false },
      ],
      faults: [
        { tick: 41, kind: "Doer", error: DOER_TIMEOUT },
        { tick: 78, kind: "Thinker", error: REFUSAL },
      ],
    });
  });

  it("the fault markers are exactly the agent's ok: false events", () => {
    const failed = sample.events.filter((e) => (e.kind === "Doer" || e.kind === "Thinker") && e.agent === "a0" && !e.ok);
    expect(markersFor(index, "a0").faults.map((f) => f.tick)).toEqual(failed.map((e) => e.tick));
  });

  it("a1 and an unknown agent have none", () => {
    expect(markersFor(index, "a1")).toEqual({ thinker: [], faults: [] });
    expect(markersFor(index, "a9")).toEqual({ thinker: [], faults: [] });
  });
});

describe("markerShapes", () => {
  it("sample a0: a hollow requested dot linked to each filled applied dot, then a red tick per fault, drawn in that order", () => {
    expect(markerShapes(markersFor(index, "a0"))).toEqual([
      { kind: "link", from: 1, to: 7 },
      { kind: "link", from: 71, to: 78 },
      { kind: "requested", tick: 1, title: "Thinker call requested at tick 1, applied at tick 7" },
      { kind: "requested", tick: 71, title: "Thinker call requested at tick 71, failed at tick 78" },
      { kind: "applied", tick: 7, ok: true, title: "Thinker plan applied at tick 7 (requested at 1)" },
      { kind: "applied", tick: 78, ok: false, title: "Thinker call failed at tick 78 (requested at 71)" },
      { kind: "fault", tick: 41, source: "Doer", title: `Doer fault at tick 41: ${DOER_TIMEOUT}` },
      { kind: "fault", tick: 78, source: "Thinker", title: `Thinker fault at tick 78: ${REFUSAL}` },
    ]);
  });

  it("a call applied on the tick it was asked for is one dot: no requested dot, no link", () => {
    expect(markerShapes({ thinker: [{ tick: 25, requestedTick: 25, ok: true }], faults: [] })).toEqual([
      { kind: "applied", tick: 25, ok: true, title: "Thinker plan applied at tick 25 (requested at 25)" },
    ]);
  });

  it("no calls, no shapes", () => {
    expect(markerShapes({ thinker: [], faults: [] })).toEqual([]);
  });
});

describe("answerRows", () => {
  const answersAt = (tick: number): DoerAnswers => {
    const answers = latestDoerAt(index, "a0", tick).answered?.answers;
    if (!answers) throw new Error(`sample: no answers at tick ${tick}`);
    return answers;
  };

  it("the sample's contact answer (tick 71): fixed question order, options most likely first with the pick flagged, nouls against their thresholds", () => {
    expect(answerRows(answersAt(71))).toEqual([
      {
        question: "move",
        type: "choice",
        choice: "forward",
        confidence: 0.58,
        options: [
          { option: "forward", probability: 0.58, chosen: true },
          { option: "back", probability: 0.105, chosen: false },
          { option: "left", probability: 0.105, chosen: false },
          { option: "right", probability: 0.105, chosen: false },
          { option: "stop", probability: 0.105, chosen: false },
        ],
      },
      {
        question: "turn",
        type: "choice",
        choice: "face_target",
        confidence: 0.66,
        options: [
          { option: "face_target", probability: 0.66, chosen: true },
          { option: "left", probability: 0.113, chosen: false },
          { option: "right", probability: 0.113, chosen: false },
          { option: "none", probability: 0.113, chosen: false },
        ],
      },
      { question: "fire", type: "noul", probability: 0.34, threshold: FIRE_THRESHOLD, crossed: false },
      {
        question: "target",
        type: "choice",
        choice: "a1",
        confidence: 0.94,
        options: [
          { option: "a1", probability: 0.94, chosen: true },
          { option: "none", probability: 0.06, chosen: false },
        ],
      },
      { question: "escalate", type: "noul", probability: 0.84, threshold: ESCALATE_THRESHOLD, crossed: true },
    ]);
  });

  it("tick 81: fire crosses its threshold, escalate does not", () => {
    const nouls = answerRows(answersAt(81)).filter((r) => r.type === "noul");
    expect(nouls).toEqual([
      { question: "fire", type: "noul", probability: 0.72, threshold: 0.5, crossed: true },
      { question: "escalate", type: "noul", probability: 0.12, threshold: 0.7, crossed: false },
    ]);
  });

  it("a noul exactly at its threshold crosses it (row 25: fire at ≥ 0.5, escalate at ≥ 0.7)", () => {
    const rows = answerRows({ fire: { type: "noul", noul: FIRE_THRESHOLD }, escalate: { type: "noul", noul: ESCALATE_THRESHOLD } });
    expect(rows.map((r) => r.type === "noul" && r.crossed)).toEqual([true, true]);
    const below = answerRows({ fire: { type: "noul", noul: 0.4999 }, escalate: { type: "noul", noul: 0.6999 } });
    expect(below.map((r) => r.type === "noul" && r.crossed)).toEqual([false, false]);
  });

  it("flags the pick even when it is not the most likely option; ties keep the answer's order", () => {
    const [turn] = answerRows({
      turn: { type: "choice", choice: "right", probabilities: { left: 0.2, none: 0.2, right: 0.25, face_target: 0.35 }, confidence: 0.25 },
    });
    expect(turn).toEqual({
      question: "turn",
      type: "choice",
      choice: "right",
      confidence: 0.25,
      options: [
        { option: "face_target", probability: 0.35, chosen: false },
        { option: "right", probability: 0.25, chosen: true },
        { option: "left", probability: 0.2, chosen: false },
        { option: "none", probability: 0.2, chosen: false },
      ],
    });
  });

  it("keeps the fixed question order whatever order the answer lists them in", () => {
    const rows = answerRows({
      escalate: { type: "noul", noul: 0 },
      target: { type: "choice", choice: "a3", probabilities: { a3: 1 }, confidence: 1 },
      fire: { type: "noul", noul: 1 },
      move: { type: "choice", choice: "stop", probabilities: { stop: 1 }, confidence: 1 },
    });
    expect(rows.map((r) => r.question)).toEqual(["move", "fire", "target", "escalate"]);
  });

  it("a bot's crisp answer has one option per choice; questions not asked have no row; no answers, no rows", () => {
    const rows = answerRows({
      move: { type: "choice", choice: "forward", probabilities: { forward: 1 }, confidence: 1 },
      turn: { type: "choice", choice: "none", probabilities: { none: 1 }, confidence: 1 },
      fire: { type: "noul", noul: 0 },
      escalate: { type: "noul", noul: 0 },
    });
    expect(rows.map((r) => r.question)).toEqual(["move", "turn", "fire", "escalate"]); // target: nobody visible (I-005)
    expect(rows[0]).toMatchObject({ options: [{ option: "forward", probability: 1, chosen: true }] });
    expect(answerRows({})).toEqual([]);
  });
});

// ---- a hand-built log: a0 prompted, a1 doer-only, a2 a bot ----

const answers = (fire: number, escalate: number): DoerAnswers => ({
  move: { type: "choice", choice: "forward", probabilities: { forward: 0.6, back: 0.1, left: 0.1, right: 0.1, stop: 0.1 }, confidence: 0.6 },
  fire: { type: "noul", noul: fire },
  escalate: { type: "noul", noul: escalate },
});
const plan = (text: string) => ({ text, scratchpad: "" });

// a0: a thinker timeout before any plan (3), a plan (6), a thinker failure and a doer
// failure on the same tick (11), a second doer failure in a row (21), a plan applied on
// the tick it was asked for (25), two thinker failures in a row (40, 50).
// a1: its first doer call fails (1), later calls answer. a2: answers every call.
const crafted: MatchLog = {
  version: 1,
  config: { mapId: "map-1", seed: 5, durationTicks: 60, slots: [{ kind: "prompted" }, { kind: "doer" }, { kind: "bot", bot: "camper" }] },
  seed: 5,
  prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
  events: [
    { kind: "Tick", tick: 0, agents: [["a0", 10, 50, 0, 100], ["a1", 50, 50, 0, 100], ["a2", 90, 50, 180, 100]], bullets: [] },
    { kind: "Doer", tick: 1, agent: "a0", ok: true, answers: answers(0.1, 0.9) },
    { kind: "Doer", tick: 1, agent: "a1", ok: false, error: DOER_TIMEOUT },
    { kind: "Doer", tick: 1, agent: "a2", ok: true, answers: answers(0, 0) },
    { kind: "Thinker", tick: 3, requestedTick: 1, agent: "a0", input: {}, ok: false, error: "timeout: no reply within 20000 ms" },
    { kind: "Thinker", tick: 6, requestedTick: 4, agent: "a0", input: {}, ok: true, plan: plan("Hold the east wall.") },
    { kind: "Thinker", tick: 11, requestedTick: 8, agent: "a0", input: {}, ok: false, error: "server: 529 overloaded" },
    { kind: "Doer", tick: 11, agent: "a0", ok: false, error: "server: 502" },
    { kind: "Doer", tick: 11, agent: "a1", ok: true, answers: answers(0.6, 0.1) },
    { kind: "Doer", tick: 11, agent: "a2", ok: true, answers: answers(1, 0) },
    { kind: "Doer", tick: 21, agent: "a0", ok: false, error: DOER_TIMEOUT },
    { kind: "Doer", tick: 21, agent: "a1", ok: true, answers: answers(0.2, 0.1) },
    { kind: "Thinker", tick: 25, requestedTick: 25, agent: "a0", input: {}, ok: true, plan: plan("Push north.") },
    { kind: "Doer", tick: 31, agent: "a0", ok: true, answers: answers(0.7, 0.2) },
    { kind: "Thinker", tick: 40, requestedTick: 33, agent: "a0", input: {}, ok: false, error: REFUSAL },
    { kind: "Thinker", tick: 50, requestedTick: 45, agent: "a0", input: {}, ok: false, error: "invalid_output: not JSON" },
    { kind: "MatchEnd", tick: 50, ranking: [] },
  ],
};
const craftedIndex = indexLog(MatchLogSchema.parse(crafted));

describe("selectors on a hand-built log", () => {
  const plans = (agent: string, ticks: number[]) =>
    ticks.map((t) => {
      const { applied, last } = latestPlanAt(craftedIndex, agent, t);
      return [t, applied?.tick ?? null, last?.tick ?? null, last?.ok ?? null];
    });

  it("latestPlanAt: a failure before any plan, failures after one, a plan applied on the tick it was asked for", () => {
    expect(plans("a0", [2, 3, 5, 6, 10, 11, 24, 25, 39, 40, 49, 50, 60])).toEqual([
      [2, null, null, null],
      [3, null, 3, false], // timed out before the first plan: no plan yet
      [5, null, 3, false],
      [6, 6, 6, true],
      [10, 6, 6, true],
      [11, 6, 11, false],
      [24, 6, 11, false],
      [25, 25, 25, true],
      [39, 25, 25, true],
      [40, 25, 40, false],
      [49, 25, 40, false],
      [50, 25, 50, false], // the newer of two failures in a row
      [60, 25, 50, false],
    ]);
    expect(latestPlanAt(craftedIndex, "a0", 30).applied?.plan?.text).toBe("Push north.");
  });

  it("latestPlanAt reads only the agent asked about", () => {
    expect(plans("a1", [0, 25, 60])).toEqual([
      [0, null, null, null],
      [25, null, null, null],
      [60, null, null, null],
    ]);
  });

  it("latestDoerAt: two failures in a row keep the same older answers; a failed first call has nothing to keep", () => {
    const view = (agent: string, t: number) => {
      const { last, answered, kept } = latestDoerAt(craftedIndex, agent, t);
      return [last?.tick ?? null, last?.ok ?? null, answered?.tick ?? null, kept];
    };
    expect([1, 10, 11, 20, 21, 30, 31, 50].map((t) => view("a0", t))).toEqual([
      [1, true, 1, false],
      [1, true, 1, false],
      [11, false, 1, true],
      [11, false, 1, true],
      [21, false, 1, true],
      [21, false, 1, true],
      [31, true, 31, false],
      [31, true, 31, false],
    ]);
    expect(latestDoerAt(craftedIndex, "a0", 21).last?.error).toBe(DOER_TIMEOUT);
    expect([1, 10, 11].map((t) => view("a1", t))).toEqual([
      [1, false, null, true],
      [1, false, null, true],
      [11, true, 11, false],
    ]);
    expect(view("a2", 30)).toEqual([11, true, 11, false]);
  });

  it("markersFor: every thinker call, and every failure in tick order, the thinker's first within a tick (it lands before the doer is asked)", () => {
    expect(markersFor(craftedIndex, "a0")).toEqual({
      thinker: [
        { tick: 3, requestedTick: 1, ok: false },
        { tick: 6, requestedTick: 4, ok: true },
        { tick: 11, requestedTick: 8, ok: false },
        { tick: 25, requestedTick: 25, ok: true },
        { tick: 40, requestedTick: 33, ok: false },
        { tick: 50, requestedTick: 45, ok: false },
      ],
      faults: [
        { tick: 3, kind: "Thinker", error: "timeout: no reply within 20000 ms" },
        { tick: 11, kind: "Thinker", error: "server: 529 overloaded" },
        { tick: 11, kind: "Doer", error: "server: 502" },
        { tick: 21, kind: "Doer", error: DOER_TIMEOUT },
        { tick: 40, kind: "Thinker", error: REFUSAL },
        { tick: 50, kind: "Thinker", error: "invalid_output: not JSON" },
      ],
    });
    expect(markersFor(craftedIndex, "a1")).toEqual({ thinker: [], faults: [{ tick: 1, kind: "Doer", error: DOER_TIMEOUT }] });
    expect(markersFor(craftedIndex, "a2")).toEqual({ thinker: [], faults: [] });
  });

  it("markerShapes: a link and a requested dot exactly for the calls applied on a later tick", () => {
    const shapes = markerShapes(markersFor(craftedIndex, "a0"));
    const of = (kind: string) => shapes.flatMap((s): (number | number[])[] => (s.kind !== kind ? [] : s.kind === "link" ? [[s.from, s.to]] : [s.tick]));
    expect(of("link")).toEqual([
      [1, 3],
      [4, 6],
      [8, 11],
      [33, 40],
      [45, 50],
    ]);
    expect(of("requested")).toEqual([1, 4, 8, 33, 45]);
    expect(of("applied")).toEqual([3, 6, 11, 25, 40, 50]);
    expect(of("fault")).toEqual([3, 11, 11, 21, 40, 50]);
  });
});

describe("perceptionLines", () => {
  const at = (tick: number, agent = "a0") => {
    const state = stateFromTick(index, sample, tick);
    return perceptionLines(perceive(state, agent), state.agents.find((a) => a.id === agent)?.alive ?? false);
  };

  it("tick 115: self, a1 straight ahead, its shot of tick 111 heard (the window, R15), the hit's source as a bearing", () => {
    expect(at(115)).toEqual({
      self: "26.50, 50.00 · facing 0.0° · HP 80 · kills 0 · 4.3 s left",
      visible: ["a1 · 0° · 41 m · moving"],
      heard: ["shot · 0° · mid"],
      incoming: ["0°"],
    });
  });

  it("tick 141: a shot heard at mid range", () => {
    expect(at(141)).toEqual({
      self: "26.57, 47.50 · facing 3.7° · HP 80 · kills 0 · 3.0 s left",
      visible: ["a1 · 0° · 34 m · moving"],
      heard: ["shot · 0° · mid"],
      incoming: [],
    });
  });

  it("a dead agent says so", () => {
    expect(at(142, "a1").self).toBe("60.76, 49.73 · facing -176.3° · HP 0 (dead) · kills 0 · 2.9 s left");
  });

  it("bearings carry their side: + right, - left (§6.1), 0 straight ahead", () => {
    const lines = perceptionLines(
      {
        self: { pos: { x: 1, y: 2.5 }, facing: 90, hp: 100, kills: 2, secondsLeft: 12.25 },
        visible: [{ id: "a3", bearing: -12, dist: 38, moving: false }],
        heard: [{ kind: "steps", bearing: 140, dist: "near" }],
        incoming: [{ bearing: 180 }, { bearing: 0 }],
      },
      true,
    );
    expect(lines).toEqual({
      self: "1.00, 2.50 · facing 90.0° · HP 100 · kills 2 · 12.3 s left",
      visible: ["a3 · -12° · 38 m · still"],
      heard: ["steps · +140° · near"],
      incoming: ["+180°", "0°"],
    });
  });
});

describe("mindView", () => {
  const view = (tick: number, agent = "a0", at = index, log = sample) => mindView(at, (t) => stateFromTick(at, log, t), tick, agent);
  const rowsAt = (tick: number) => {
    const answers = latestDoerAt(index, "a0", tick).answered?.answers;
    if (!answers) throw new Error(`sample: no answers at tick ${tick}`);
    return answerRows(answers);
  };
  const firstPlan = latestPlanAt(index, "a0", 7).applied?.plan?.text;
  /** The Doer section's perception for a0's call answered at `answered`: core.perceive on the world of tick answered − 1. */
  const decided = (answered: number) => {
    const observation = perceive(stateFromTick(index, sample, answered - 1), "a0");
    return { tick: answered - 1, caption: `saw at tick ${answered - 1}, answered at tick ${answered}`, observation, alive: true, lines: perceptionLines(observation, true) };
  };

  it("tick 0: perception from core.perceive, no plan yet, no answers yet", () => {
    const state = stateFromTick(index, sample, 0);
    expect(view(0)).toEqual({
      tick: 0,
      agent: "a0",
      perception: { observation: perceive(state, "a0"), alive: true, lines: perceptionLines(perceive(state, "a0"), true) },
      plan: { text: null, caption: "(no plan yet)", fault: null },
      doer: { caption: "(no answers yet)", fault: null, perception: null, rows: [] },
    });
  });

  it("the Doer section shows the perception its answers came from: perceive on the world of tick T − 1 for the call answered at T (R18)", () => {
    // The scrub tick, and the call whose answers are in force then: tick 1 saw the spawn (tick 0);
    // 41 keeps the answers of 31 after a timeout; 115 and 142 are between and on doer ticks.
    for (const [tick, answered] of [[1, 1], [10, 1], [41, 31], [77, 71], [115, 111], [141, 141], [142, 141]] as const) {
      expect(view(tick).doer.perception, `tick ${tick}`).toEqual(decided(answered));
    }
    expect(decided(1).observation).toEqual(perceive(stateFromTick(index, sample, 0), "a0")); // answered at 1: the spawn
  });

  it("tick 115: the top block is the world on screen, the Doer block the world the answers of 111 were decided on (tick 110)", () => {
    const at115 = view(115);
    expect(at115.perception.lines).toMatchObject({ self: "26.50, 50.00 · facing 0.0° · HP 80 · kills 0 · 4.3 s left", incoming: ["0°"] });
    expect(at115.doer.perception?.lines).toEqual({
      self: "26.50, 50.00 · facing 0.0° · HP 100 · kills 0 · 4.5 s left",
      visible: ["a1 · 0° · 42 m · moving"],
      heard: ["shot · 0° · mid"], // a1's shot of tick 101, in the window of tick 110 (R15)
      incoming: [],
    });
    expect(at115.doer.caption).toBe("answered at tick 111");
  });

  it("tick 7: the plan applied this tick, the answers of tick 1", () => {
    expect(view(7).plan).toEqual({ text: firstPlan, caption: "applied at tick 7 (requested at 1)", fault: null });
    expect(view(7).doer).toEqual({ caption: "answered at tick 1", fault: null, perception: decided(1), rows: rowsAt(1) });
  });

  it("tick 41: the doer timed out, the answers of tick 31 are kept", () => {
    expect(view(41).doer).toEqual({
      caption: "kept from tick 31",
      fault: "Doer fault at tick 41: timeout: no answer within 2000 ms",
      perception: decided(31), // the kept answers' own input, not the failed call's
      rows: rowsAt(31),
    });
  });

  it("tick 77: the plan of tick 7, no fault line, the answers of tick 71", () => {
    expect(view(77).plan).toEqual({ text: firstPlan, caption: "applied at tick 7 (requested at 1)", fault: null });
    expect(view(77).doer).toEqual({ caption: "answered at tick 71", fault: null, perception: decided(71), rows: rowsAt(71) });
  });

  it("tick 78 and the end: the refusal on the fault line, the plan of tick 7 still in view", () => {
    for (const t of [78, 142]) {
      expect(view(t).plan).toEqual({
        text: firstPlan,
        caption: "applied at tick 7 (requested at 1)",
        fault: "Thinker fault at tick 78: refusal (stop_reason: refusal) — kept the plan from tick 7",
      });
    }
    expect(view(142).doer.caption).toBe("answered at tick 141");
  });

  it("each slot kind says why it has no plan: a bot never has one", () => {
    expect(view(100, "a1").plan).toEqual({ text: null, caption: "(scripted bot: no plan)", fault: null });
    expect(view(100, "a1").perception.lines.visible).toEqual(["a0 · 0° · 45 m · still"]);
  });

  it("hand-built log: a thinker failure before any plan; a doer-only slot whose first call failed", () => {
    expect(view(3, "a0", craftedIndex, crafted).plan).toEqual({
      text: null,
      caption: "(no plan yet)",
      fault: "Thinker fault at tick 3: timeout: no reply within 20000 ms — no plan yet",
    });
    expect(view(5, "a1", craftedIndex, crafted)).toMatchObject({
      plan: { text: null, caption: "(doer-only slot: fixed plan, no thinker)", fault: null },
      doer: { caption: "(no answers yet)", fault: `Doer fault at tick 1: ${DOER_TIMEOUT}`, rows: [] },
    });
    expect(view(30, "a2", craftedIndex, crafted).plan.caption).toBe("(scripted bot: no plan)");
  });
});

describe("formatProbability and answerSummary", () => {
  it("shows probabilities as percents to at most one decimal", () => {
    expect([0.86, 0.035, 0.105, 0.113, 1, 0, 0.0351, 0.12345, 0.9999].map(formatProbability)).toEqual([
      "86%",
      "3.5%",
      "10.5%",
      "11.3%",
      "100%",
      "0%",
      "3.5%",
      "12.3%",
      "100%",
    ]);
  });

  it("sums a choice up as its pick and confidence, a noul as its comparison and what the agent does", () => {
    const [move, , fire, target, escalate] = answerRows(latestDoerAt(index, "a0", 71).answered?.answers ?? {});
    expect([move, fire, target, escalate].map((r) => (r ? answerSummary(r) : null))).toEqual([
      "forward · 58%",
      "34% < 50% · holds fire",
      "a1 · 94%",
      "84% ≥ 70% · escalates",
    ]);
    const [fire81, escalate81] = answerRows({ fire: { type: "noul", noul: 0.72 }, escalate: { type: "noul", noul: 0.12 } });
    expect([fire81, escalate81].map((r) => (r ? answerSummary(r) : null))).toEqual(["72% ≥ 50% · fires", "12% < 70% · does not escalate"]);
  });
});
