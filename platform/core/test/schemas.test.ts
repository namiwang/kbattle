import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as z from "zod";
import {
  DecideRequestSchema,
  DoerAnswerSchema,
  EventSchema,
  MapSpecSchema,
  MatchConfigSchema,
  MatchLogSchema,
  PlanSchema,
  PromptsSchema,
  QuestionIdSchema,
  schemas,
  Vec2Schema,
  type DoerAnswers,
  type DoerQuestions,
  type DoerState,
  type Event,
  type MapSpec,
  type MatchLog,
  type Prompts,
  type QuestionId,
} from "../src/schemas";
import type { MoveChoice, Observation, TurnChoice, WorldState } from "../src/types";
import type { Vec2 } from "../src/vec2";

/** The path of every issue; [] when the value parses. */
function issuePaths(schema: z.ZodType, value: unknown): PropertyKey[][] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

/** A copy without `key`. JSON has no undefined: a missing key is how a field is absent. */
function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

/** The boundary round trip: parse, serialize, parse again. */
function roundTrip<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));
}

const moveCriteria = {
  forward: "Step the way you face.",
  back: "Step away from where you face.",
  left: "Strafe left.",
  right: "Strafe right.",
  stop: "Stand still.",
};
const turnCriteria = {
  left: "Turn left.",
  right: "Turn right.",
  none: "Keep your facing.",
  face_target: "Turn toward the target.",
};

// DESIGN.md §5.4 example request, minus `model` (the Worker adds it).
const decideRequest = {
  state: {
    self: { pos: [62.5, 40], facing: -30, hp: 72, kills: 1, secondsLeft: 241.5 },
    visible: [{ id: "a3", bearing: -12, dist: 38, moving: true }],
    heard: [{ kind: "shot", bearing: 140, dist: "far" }],
    incoming: [{ bearing: 95 }],
    plan: "Hold the east wall, engage anyone crossing the gap, retreat north under 40 HP.",
  },
  questions: {
    move: { type: "choice", instructions: "Move as the plan says.", criteria: moveCriteria },
    turn: { type: "choice", instructions: "Face what matters.", criteria: turnCriteria },
    fire: { type: "noul", instructions: "Fire when an enemy is in front of you." },
    target: {
      type: "choice",
      instructions: "Pick the enemy to face.",
      criteria: { a3: "Enemy a3, 38 m ahead.", none: "No target." },
    },
    escalate: {
      type: "noul",
      instructions: "The plan no longer fits the situation.",
      criteria: { true: "Ask for a new plan.", false: "Keep the plan." },
    },
  },
};

// Clef's response shape (ISSUES I-004).
const doerAnswer = {
  model: "@cf/cloudflare/clef-flash",
  answers: {
    move: {
      type: "choice",
      choice: "forward",
      probabilities: { forward: 0.7, back: 0.05, left: 0.1, right: 0.1, stop: 0.05 },
      confidence: 0.7,
    },
    turn: {
      type: "choice",
      choice: "face_target",
      probabilities: { left: 0.1, right: 0.1, none: 0.2, face_target: 0.6 },
      confidence: 0.6,
    },
    fire: { type: "noul", noul: 0.82 },
    target: { type: "choice", choice: "a3", probabilities: { a3: 0.9, none: 0.1 }, confidence: 0.9 },
    escalate: { type: "noul", noul: 0.04 },
  },
  usage: { input_tokens: 412, output_tokens: 0 },
};

const plan = { text: "Hold the east wall.", scratchpad: "a3 camps the gap." };

// Row 23 default: 8 slots, 1 prompted, 7 bots.
const matchConfig = {
  mapId: "arena-1",
  seed: 42,
  durationTicks: 6000,
  slots: [
    { kind: "prompted" },
    ...Array.from({ length: 7 }, (_, i) => ({ kind: "bot", bot: i % 2 ? "camper" : "wanderer" })),
  ],
};

const prompts = {
  thinkerSystem: "Play carefully and keep to cover.",
  doerInstructions: {
    move: "Follow the plan.",
    turn: "Face the closest enemy.",
    fire: "Fire when it is centered.",
    target: "Prefer the weakest enemy.",
  },
};

const mapSpec = {
  id: "box",
  width: 20,
  height: 10,
  obstacles: [{ vertices: [{ x: 5, y: 2 }, { x: 8, y: 2 }, { x: 6, y: 5 }] }],
  spawns: [{ x: 1, y: 1 }, { x: 19, y: 9 }],
};

// One event of each DESIGN.md §5.3 kind.
const events = {
  Spawn: { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
  Tick: {
    kind: "Tick",
    tick: 12,
    agents: [["a0", 7, 50, 0, 100], ["a1", 93, 50, 180, 80]],
    bullets: [["b0", 40.5, 50.1]],
  },
  Shot: { kind: "Shot", tick: 11, agent: "a0", bullet: "b0" },
  Hit: { kind: "Hit", tick: 25, bullet: "b0", target: "a1", damage: 20 },
  Death: { kind: "Death", tick: 140, agent: "a1", killer: "a0" },
  Doer: { kind: "Doer", tick: 11, agent: "a0", ok: true, answers: doerAnswer.answers },
  Thinker: {
    kind: "Thinker",
    tick: 7,
    requestedTick: 1,
    agent: "a0",
    input: { digest: "Nothing seen yet." },
    ok: true,
    plan,
  },
  MatchEnd: { kind: "MatchEnd", tick: 140, ranking: ["a0", "a1"] },
};

const matchLog = {
  version: 1,
  config: { ...matchConfig, seed: 7 },
  seed: 7,
  prompts,
  events: Object.values(events),
};

describe("DoerAnswer: Worker → browser, Clef's response as-is", () => {
  it("parses a Clef response and round-trips", () => {
    expect(roundTrip(DoerAnswerSchema, doerAnswer)).toEqual(doerAnswer);
  });

  it("accepts a response without usage (bots, fakes) or without a target answer (I-005)", () => {
    const { move, turn, fire, escalate } = doerAnswer.answers;
    const botAnswer = { model: "bot:wanderer", answers: { move, turn, fire, escalate } };
    expect(issuePaths(DoerAnswerSchema, botAnswer)).toEqual([]);
  });

  const answers = doerAnswer.answers;
  it.each([
    ["a probability above 1", { fire: { type: "noul", noul: 1.2 } }, ["answers", "fire", "noul"]],
    [
      "a negative choice probability",
      { move: { ...answers.move, probabilities: { ...answers.move.probabilities, back: -0.1 } } },
      ["answers", "move", "probabilities", "back"],
    ],
    ["a move pick that is not a move", { move: { ...answers.move, choice: "jump" } }, ["answers", "move", "choice"]],
    ["a turn pick that is not a turn", { turn: { ...answers.turn, choice: "spin" } }, ["answers", "turn", "choice"]],
    ["a noul answer where a choice belongs", { move: { type: "noul", noul: 0.5 } }, ["answers", "move", "type"]],
    ["a choice answer where a noul belongs", { fire: answers.target }, ["answers", "fire", "type"]],
    ["a score answer (not modeled)", { escalate: { type: "score", score: 2 } }, ["answers", "escalate", "type"]],
  ])("rejects %s", (_name, change, path) => {
    const value = { ...doerAnswer, answers: { ...answers, ...change } };
    expect(issuePaths(DoerAnswerSchema, value)).toContainEqual(path);
  });

  // A third-party response: a harmless extra key must not fault every call (ISSUES I-009).
  it.each([
    ["an unexpected top-level key", { ...doerAnswer, latencyMs: 30 }, ["latencyMs"]],
    ["an unknown question id", { ...doerAnswer, answers: { ...answers, jump: answers.fire } }, ["answers", "jump"]],
    [
      "an unexpected key inside a noul answer",
      { ...doerAnswer, answers: { ...answers, fire: { ...answers.fire, why: "x" } } },
      ["answers", "fire", "why"],
    ],
    [
      "an unexpected key inside a choice answer",
      { ...doerAnswer, answers: { ...answers, target: { ...answers.target, why: "x" } } },
      ["answers", "target", "why"],
    ],
    [
      "an unexpected key inside a move answer",
      { ...doerAnswer, answers: { ...answers, move: { ...answers.move, why: "x" } } },
      ["answers", "move", "why"],
    ],
    [
      "an unexpected key inside usage",
      { ...doerAnswer, usage: { ...doerAnswer.usage, cached_tokens: 3 } },
      ["usage", "cached_tokens"],
    ],
  ])("strips %s instead of rejecting it", (_name, value, path) => {
    const parsed = DoerAnswerSchema.parse(value);
    expect(parsed).not.toHaveProperty(path);
    expect(parsed).toEqual(doerAnswer);
  });

  it.each([
    ["negative token usage", { ...doerAnswer, usage: { input_tokens: -1, output_tokens: 0 } }, ["usage", "input_tokens"]],
    ["fractional token usage", { ...doerAnswer, usage: { input_tokens: 1.5, output_tokens: 0 } }, ["usage", "input_tokens"]],
    ["a missing answers object", { model: doerAnswer.model }, ["answers"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(DoerAnswerSchema, value)).toContainEqual(path);
  });
});

describe("Plan: thinker → browser", () => {
  it("parses a plan and round-trips; the scratchpad may be empty", () => {
    expect(roundTrip(PlanSchema, plan)).toEqual(plan);
    expect(issuePaths(PlanSchema, { text: "Go.", scratchpad: "" })).toEqual([]);
  });

  it.each([
    ["empty text", { text: "", scratchpad: "" }, ["text"]],
    ["text over 2000 characters", { text: "x".repeat(2001), scratchpad: "" }, ["text"]],
    ["a scratchpad over 4000 characters", { text: "Go.", scratchpad: "x".repeat(4001) }, ["scratchpad"]],
    ["a missing scratchpad", { text: "Go." }, ["scratchpad"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(PlanSchema, value)).toContainEqual(path);
  });

  it("strips an unexpected key instead of rejecting it (a third-party response, ISSUES I-009)", () => {
    const parsed = PlanSchema.parse({ ...plan, reasoning: "because" });
    expect(parsed).not.toHaveProperty("reasoning");
    expect(parsed).toEqual(plan);
  });

  it("accepts the length limits exactly", () => {
    expect(issuePaths(PlanSchema, { text: "x".repeat(2000), scratchpad: "x".repeat(4000) })).toEqual([]);
  });
});

describe("DecideRequest: browser → Worker", () => {
  it("parses the DESIGN.md §5.4 example and round-trips", () => {
    expect(roundTrip(DecideRequestSchema, decideRequest)).toEqual(decideRequest);
  });

  it("outputs state keys most important first, whatever order they came in (Clef truncates)", () => {
    const { self, visible, heard, incoming, plan: planText } = decideRequest.state;
    const shuffled = {
      ...decideRequest,
      state: { plan: planText, incoming, heard, visible, self: { ...self, hp: 50, pos: [1, 2] } },
    };
    const parsed = DecideRequestSchema.parse(shuffled);
    expect(Object.keys(parsed.state)).toEqual(["self", "visible", "heard", "incoming", "plan"]);
    expect(Object.keys(parsed.state.self)).toEqual(["pos", "facing", "hp", "kills", "secondsLeft"]);
  });

  it("accepts a request without the target question (I-005) and with empty perception", () => {
    const { move, turn, fire, escalate } = decideRequest.questions;
    const quiet = {
      state: { ...decideRequest.state, visible: [], heard: [], incoming: [], plan: "" },
      questions: { move, turn, fire, escalate },
    };
    expect(issuePaths(DecideRequestSchema, quiet)).toEqual([]);
  });

  const questions = decideRequest.questions;
  const state = decideRequest.state;
  it.each([
    ["no questions", { questions: {} }, ["questions"]],
    [
      "a target question with one option (I-005)",
      { questions: { ...questions, target: { ...questions.target, criteria: { none: "No target." } } } },
      ["questions", "target", "criteria"],
    ],
    [
      "a target question with 256 options",
      {
        questions: {
          ...questions,
          target: {
            ...questions.target,
            criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, "x"])),
          },
        },
      },
      ["questions", "target", "criteria"],
    ],
    [
      "a move question missing a choice",
      { questions: { ...questions, move: { ...questions.move, criteria: without(moveCriteria, "stop") } } },
      ["questions", "move", "criteria", "stop"],
    ],
    [
      "a move question with an added choice (users cannot change choices)",
      { questions: { ...questions, move: { ...questions.move, criteria: { ...moveCriteria, jump: "Jump." } } } },
      ["questions", "move", "criteria"],
    ],
    [
      "a turn question with an added choice",
      { questions: { ...questions, turn: { ...questions.turn, criteria: { ...turnCriteria, spin: "Spin." } } } },
      ["questions", "turn", "criteria"],
    ],
    [
      "fire asked as a choice",
      { questions: { ...questions, fire: { ...questions.target, instructions: "Fire?" } } },
      ["questions", "fire", "type"],
    ],
    [
      "move asked as a noul",
      { questions: { ...questions, move: questions.fire } },
      ["questions", "move", "type"],
    ],
    [
      "empty instructions",
      { questions: { ...questions, move: { ...questions.move, instructions: "" } } },
      ["questions", "move", "instructions"],
    ],
    [
      "instructions over 500 characters",
      { questions: { ...questions, fire: { ...questions.fire, instructions: "x".repeat(501) } } },
      ["questions", "fire", "instructions"],
    ],
    ["an unknown question id (users cannot add questions)", { questions: { ...questions, jump: questions.fire } }, ["questions"]],
    ["a score question (not modeled)", { questions: { ...questions, escalate: { type: "score", instructions: "?", criteria: ["a", "b"] } } }, ["questions", "escalate", "type"]],
    ["pos as {x, y} instead of [x, y]", { state: { ...state, self: { ...state.self, pos: { x: 1, y: 2 } } } }, ["state", "self", "pos"]],
    ["plan text over 2000 characters", { state: { ...state, plan: "x".repeat(2001) } }, ["state", "plan"]],
    ["an unknown hearing band", { state: { ...state, heard: [{ kind: "shot", bearing: 3, dist: "close" }] } }, ["state", "heard", 0, "dist"]],
    ["an unknown sound", { state: { ...state, heard: [{ kind: "voice", bearing: 3, dist: "near" }] } }, ["state", "heard", 0, "kind"]],
    ["negative kills", { state: { ...state, self: { ...state.self, kills: -1 } } }, ["state", "self", "kills"]],
    ["an unexpected state key", { state: { ...state, map: "arena-1" } }, ["state"]],
    ["a client-chosen model (the Worker sets it)", { model: "@cf/cloudflare/clef" }, []],
  ])("rejects %s", (_name, change, path) => {
    expect(issuePaths(DecideRequestSchema, { ...decideRequest, ...change })).toContainEqual(path);
  });
});

describe("MatchConfig: forms and links", () => {
  it("parses the row 23 default and round-trips", () => {
    expect(roundTrip(MatchConfigSchema, matchConfig)).toEqual(matchConfig);
  });

  it("accepts 2 to 16 slots, including doer-only slots (row 32)", () => {
    const two = { ...matchConfig, slots: [{ kind: "doer" }, { kind: "bot", bot: "camper" }] };
    const sixteen = { ...matchConfig, slots: Array.from({ length: 16 }, () => ({ kind: "doer" })) };
    expect(issuePaths(MatchConfigSchema, two)).toEqual([]);
    expect(issuePaths(MatchConfigSchema, sixteen)).toEqual([]);
  });

  it("accepts the seed range ends", () => {
    expect(issuePaths(MatchConfigSchema, { ...matchConfig, seed: 0 })).toEqual([]);
    expect(issuePaths(MatchConfigSchema, { ...matchConfig, seed: 2 ** 32 - 1 })).toEqual([]);
  });

  const slot = matchConfig.slots[0];
  it.each([
    ["one slot", { slots: [slot] }, ["slots"]],
    ["17 slots", { slots: Array.from({ length: 17 }, () => slot) }, ["slots"]],
    ["a negative seed", { seed: -1 }, ["seed"]],
    ["a seed above 2^32 - 1", { seed: 2 ** 32 }, ["seed"]],
    ["a fractional seed", { seed: 1.5 }, ["seed"]],
    ["zero duration", { durationTicks: 0 }, ["durationTicks"]],
    ["a duration above 60000 ticks", { durationTicks: 60001 }, ["durationTicks"]],
    ["an empty map id", { mapId: "" }, ["mapId"]],
    ["an unknown slot kind", { slots: [slot, { kind: "human" }] }, ["slots", 1, "kind"]],
    ["a bot slot without a bot", { slots: [slot, { kind: "bot" }] }, ["slots", 1, "bot"]],
    ["an unknown bot", { slots: [slot, { kind: "bot", bot: "sniper" }] }, ["slots", 1, "bot"]],
  ])("rejects %s", (_name, change, path) => {
    expect(issuePaths(MatchConfigSchema, { ...matchConfig, ...change })).toContainEqual(path);
  });
});

describe("Prompts: what produced a match", () => {
  it("parses and round-trips; blank doer instructions are allowed (the default fills in, I-005)", () => {
    expect(roundTrip(PromptsSchema, prompts)).toEqual(prompts);
    const blank = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };
    expect(issuePaths(PromptsSchema, blank)).toEqual([]);
  });

  it.each([
    ["a thinker system prompt over 8000 characters", { ...prompts, thinkerSystem: "x".repeat(8001) }, ["thinkerSystem"]],
    [
      "a doer instruction over 500 characters",
      { ...prompts, doerInstructions: { ...prompts.doerInstructions, fire: "x".repeat(501) } },
      ["doerInstructions", "fire"],
    ],
    [
      "a missing target instruction",
      { ...prompts, doerInstructions: { move: "m", turn: "t", fire: "f" } },
      ["doerInstructions", "target"],
    ],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(PromptsSchema, value)).toContainEqual(path);
  });
});

describe("MapSpec and Vec2", () => {
  it("parses a map", () => {
    expect(roundTrip(MapSpecSchema, mapSpec)).toEqual(mapSpec);
  });

  it("Vec2 rejects NaN, infinities and missing coordinates", () => {
    expect(issuePaths(Vec2Schema, { x: Number.NaN, y: 0 })).toEqual([["x"]]);
    expect(issuePaths(Vec2Schema, { x: 0, y: Number.POSITIVE_INFINITY })).toEqual([["y"]]);
    expect(issuePaths(Vec2Schema, { x: 0 })).toEqual([["y"]]);
  });

  it.each([
    ["an obstacle with two vertices", { obstacles: [{ vertices: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }, ["obstacles", 0, "vertices"]],
    ["one spawn", { spawns: [{ x: 1, y: 1 }] }, ["spawns"]],
    ["zero width", { width: 0 }, ["width"]],
    ["negative height", { height: -10 }, ["height"]],
    ["a spawn with an infinite coordinate", { spawns: [{ x: 1, y: 1 }, { x: Number.NEGATIVE_INFINITY, y: 2 }] }, ["spawns", 1, "x"]],
    ["an empty id", { id: "" }, ["id"]],
  ])("rejects %s", (_name, change, path) => {
    expect(issuePaths(MapSpecSchema, { ...mapSpec, ...change })).toContainEqual(path);
  });
});

describe("Event: the replay's discriminated union", () => {
  it("names exactly the DESIGN.md §5.3 kinds", () => {
    const kinds = EventSchema.options.map((option) => option.shape.kind.value);
    expect(kinds).toEqual(["Spawn", "Tick", "Shot", "Hit", "Death", "Doer", "Thinker", "MatchEnd"]);
  });

  it.each(Object.entries(events))("parses a %s event and round-trips", (_kind, event) => {
    expect(roundTrip(EventSchema, event)).toEqual(event);
  });

  it("accepts faults: Doer and Thinker with ok: false and an error (§5.5)", () => {
    const doerFault = { kind: "Doer", tick: 41, agent: "a0", ok: false, error: "timeout" };
    const thinkerFault = { ...without(events.Thinker, "plan"), ok: false, error: "refusal" };
    expect(issuePaths(EventSchema, doerFault)).toEqual([]);
    expect(issuePaths(EventSchema, thinkerFault)).toEqual([]);
  });

  it("parses a Tick with near-miss rows [target, fromX, fromY] and round-trips (ISSUES I-016)", () => {
    const tick = { ...events.Tick, near: [["a1", 7, 50], ["a1", 12.25, 48.5]] };
    expect(roundTrip(EventSchema, tick)).toEqual(tick);
  });

  it("accepts a MatchEnd with an empty ranking (cancelled run) and a Thinker with any input", () => {
    expect(issuePaths(EventSchema, { kind: "MatchEnd", tick: 3, ranking: [] })).toEqual([]);
    expect(issuePaths(EventSchema, { ...events.Thinker, input: "free text" })).toEqual([]);
    expect(issuePaths(EventSchema, { ...events.Thinker, input: null })).toEqual([]);
  });

  it("drops an unknown event field instead of rejecting it (non-strict, for older viewers)", () => {
    expect(EventSchema.parse({ ...events.Shot, spread: 1.5 })).toEqual(events.Shot);
  });

  it("drops an unknown key inside a Thinker plan (Plan strips, ISSUES I-009)", () => {
    const parsed = EventSchema.parse({ ...events.Thinker, plan: { ...plan, mood: "calm" } });
    expect(parsed).not.toHaveProperty(["plan", "mood"]);
    expect(parsed).toEqual(events.Thinker);
  });

  it.each([
    ["an unknown kind", { kind: "Teleport", tick: 1, agent: "a0" }, ["kind"]],
    ["Doer ok: true without answers", without(events.Doer, "answers"), ["answers"]],
    ["Doer ok: false without error", { ...events.Doer, ok: false }, ["error"]],
    ["Thinker ok: true without a plan", without(events.Thinker, "plan"), ["plan"]],
    ["Thinker ok: false without error", { ...events.Thinker, ok: false }, ["error"]],
    ["Thinker requested after it was applied", { ...events.Thinker, requestedTick: 9 }, ["requestedTick"]],
    ["Thinker without input", without(events.Thinker, "input"), ["input"]],
    ["a Tick agent row without hp", { ...events.Tick, agents: [["a0", 7, 50, 0]] }, ["agents", 0]],
    ["a Tick bullet row with a non-numeric x", { ...events.Tick, bullets: [["b0", "40", 50]] }, ["bullets", 0, 1]],
    ["a Tick near row without the shooter's y", { ...events.Tick, near: [["a1", 7]] }, ["near", 0]],
    ["a Tick near row with a non-numeric x", { ...events.Tick, near: [["a1", "7", 50]] }, ["near", 0, 1]],
    ["a Tick near row with an empty target", { ...events.Tick, near: [["", 7, 50]] }, ["near", 0, 0]],
    ["a fractional tick", { ...events.Shot, tick: 1.5 }, ["tick"]],
    ["a negative tick", { ...events.Shot, tick: -1 }, ["tick"]],
    ["a Hit with no damage", { ...events.Hit, damage: 0 }, ["damage"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(EventSchema, value)).toContainEqual(path);
  });
});

describe("MatchLog: the replay file", () => {
  it("parses a log and round-trips", () => {
    expect(roundTrip(MatchLogSchema, matchLog)).toEqual(matchLog);
  });

  // ISSUES I-014: the viewer indexes 0..lastTick, so a crafted tick of 1e8 would hang the tab.
  it("accepts event ticks from 0 up to config.durationTicks", () => {
    const last = { kind: "MatchEnd", tick: matchLog.config.durationTicks, ranking: ["a0", "a1"] };
    expect(issuePaths(MatchLogSchema, { ...matchLog, events: [...matchLog.events, last] })).toEqual([]);
  });

  it.each([
    ["one tick after config.durationTicks", 6001],
    ["a tick of 1e8", 1e8],
  ])("rejects an event at %s, at that event's tick (ISSUES I-014)", (_name, tick) => {
    const late = { ...events.Shot, tick };
    const value = { ...matchLog, events: [...matchLog.events, late] };
    expect(issuePaths(MatchLogSchema, value)).toEqual([["events", matchLog.events.length, "tick"]]);
  });

  it("reports every event past config.durationTicks, each at its own path", () => {
    const short = { ...matchLog, config: { ...matchLog.config, durationTicks: 100 } };
    // Event ticks 0, 12, 11, 25, 140 (Death), 11, 7, 140 (MatchEnd): two are past 100.
    expect(issuePaths(MatchLogSchema, short)).toEqual([
      ["events", 4, "tick"],
      ["events", 7, "tick"],
    ]);
  });

  it("drops an unknown top-level field instead of rejecting it (non-strict)", () => {
    expect(MatchLogSchema.parse({ ...matchLog, producer: "decision-arena 0.4" })).toEqual(matchLog);
  });

  it.each([
    ["version 2", { ...matchLog, version: 2 }, ["version"]],
    ["a seed that is not config.seed", { ...matchLog, seed: 8 }, ["seed"]],
    ["a bad event", { ...matchLog, events: [events.Spawn, { ...events.Hit, bullet: "" }] }, ["events", 1, "bullet"]],
    ["missing prompts", without(matchLog, "prompts"), ["prompts"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(MatchLogSchema, value)).toContainEqual(path);
  });
});

describe("schemas: the five boundaries by name (DESIGN.md §5.3)", () => {
  it("maps each boundary name to its schema", () => {
    expect(schemas).toEqual({
      DoerAnswer: DoerAnswerSchema,
      Plan: PlanSchema,
      DecideRequest: DecideRequestSchema,
      MatchLog: MatchLogSchema,
      MatchConfig: MatchConfigSchema,
    });
    expect(Object.isFrozen(schemas)).toBe(true);
  });
});

describe("fixtures", () => {
  const fixtures = new URL("../fixtures/", import.meta.url);
  const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));

  it("sample-log.json validates against MatchLog and round-trips", () => {
    const sample = readJson("sample-log.json");
    expect(roundTrip(MatchLogSchema, sample)).toEqual(sample);
  });

  it("sample-log.json has every Event kind at least once", () => {
    const sample = MatchLogSchema.parse(readJson("sample-log.json"));
    const seen = [...new Set(sample.events.map((event) => event.kind))];
    for (const option of EventSchema.options) {
      expect(seen).toContain(option.shape.kind.value);
    }
  });

  it("sample-log.json stays under 50 KB (plan budget)", () => {
    expect(statSync(new URL("sample-log.json", fixtures)).size).toBeLessThan(50 * 1024);
  });

  it("decide-request.json validates against DecideRequest and round-trips", () => {
    const request = readJson("decide-request.json");
    expect(roundTrip(DecideRequestSchema, request)).toEqual(request);
  });

  // Each bad fixture is a valid minimal log with one defect: exactly one issue, at this path.
  const badFixtures: Record<string, PropertyKey[]> = {
    "wrong-version.json": ["version"],
    "unknown-event-kind.json": ["events", 5, "kind"],
    "probability-above-1.json": ["events", 3, "answers", "move", "probabilities", "forward"],
    "seed-mismatch.json": ["seed"],
    "one-slot.json": ["config", "slots"],
    "doer-ok-without-answers.json": ["events", 3, "answers"],
  };

  // The same for /decide bodies (the Worker answers them with 400): decide-request.json with one defect.
  const badRequests: Record<string, PropertyKey[]> = {
    "decide-request-client-model.json": [],
    "decide-request-unknown-question.json": ["questions"],
    "decide-request-one-target-option.json": ["questions", "target", "criteria"],
  };

  it("bad/ holds exactly the expected fixtures", () => {
    const expected = [...Object.keys(badFixtures), ...Object.keys(badRequests)];
    expect(readdirSync(new URL("bad/", fixtures)).sort()).toEqual(expected.sort());
  });

  it.each(Object.entries(badFixtures))("bad/%s fails with one issue at %j", (name, path) => {
    expect(issuePaths(MatchLogSchema, readJson(`bad/${name}`))).toEqual([path]);
  });

  it.each(Object.entries(badRequests))("bad/%s fails DecideRequest with one issue at %j", (name, path) => {
    expect(issuePaths(DecideRequestSchema, readJson(`bad/${name}`))).toEqual([path]);
  });
});

describe("inferred types agree with the internal types", () => {
  it("Vec2Schema infers Vec2", () => {
    expectTypeOf<z.infer<typeof Vec2Schema>>().toEqualTypeOf<Vec2>();
  });

  it("DoerState is Observation plus plan, with pos as an [x, y] tuple", () => {
    expectTypeOf<DoerState["visible"]>().toEqualTypeOf<Observation["visible"]>();
    expectTypeOf<DoerState["heard"]>().toEqualTypeOf<Observation["heard"]>();
    expectTypeOf<DoerState["incoming"]>().toEqualTypeOf<Observation["incoming"]>();
    expectTypeOf<Omit<DoerState["self"], "pos">>().toEqualTypeOf<Omit<Observation["self"], "pos">>();
    expectTypeOf<DoerState["self"]["pos"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<DoerState["plan"]>().toEqualTypeOf<string>();
  });

  it("questions and answers are keyed by QuestionId, with typed move and turn picks", () => {
    expectTypeOf<keyof DoerQuestions>().toEqualTypeOf<QuestionId>();
    expectTypeOf<keyof DoerAnswers>().toEqualTypeOf<QuestionId>();
    expectTypeOf<NonNullable<DoerAnswers["move"]>["choice"]>().toEqualTypeOf<MoveChoice>();
    expectTypeOf<NonNullable<DoerAnswers["turn"]>["choice"]>().toEqualTypeOf<TurnChoice>();
    expectTypeOf<NonNullable<DoerAnswers["fire"]>["noul"]>().toEqualTypeOf<number>();
    expectTypeOf<keyof Prompts["doerInstructions"]>().toEqualTypeOf<Exclude<QuestionId, "escalate">>();
    expect(Object.keys(DecideRequestSchema.shape.questions.shape)).toEqual(QuestionIdSchema.options);
  });

  it("the sim's WorldState uses the schema's MapSpec, and a log's events are Events", () => {
    expectTypeOf<WorldState["map"]>().toEqualTypeOf<MapSpec>();
    expectTypeOf<MatchLog["events"][number]>().toEqualTypeOf<Event>();
  });
});
