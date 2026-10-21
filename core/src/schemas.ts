// Zod schemas where data enters from outside (DESIGN.md §5.3), plus the parts
// they are built from. Each type is z.infer of its schema (`XSchema` gives `X`)
// and is declared nowhere else.
//
// Strictness:
// - Strict, unknown keys rejected at every level: DecideRequest, the /decide body
//   (browser → Worker → Clef). It is the Worker's abuse boundary: a key nobody
//   expects is an error, never forwarded.
// - Non-strict (z.object, unknown keys dropped on parse): DoerAnswer and Plan,
//   which validate third-party responses (Clef, the thinker model), so a harmless
//   extra key does not fault every call (ISSUES I-009); and MatchLog, its config,
//   prompts and events, and MapSpec, so a field added later does not make an
//   older viewer reject a newer file. Doer and Thinker events reuse the
//   DoerAnswers and Plan schemas.
//
// Units and conventions (§6.1): meters, y down, degrees clockwise-positive with
// 0° = +x, ticks. In zod 4, z.number() already rejects NaN and ±Infinity.

// Namespace import on purpose: `import { z }` keeps every zod locale in a bundle
// (measured: a Worker importing these schemas, 464 KiB minified vs 110 KiB).
import * as z from "zod";
import { HEARING_BANDS, MOVE_CHOICES, SOUND_KINDS, TURN_CHOICES } from "./types";

const Probability = z.number().min(0).max(1);
const TickNumber = z.number().int().min(0);
const AgentId = z.string().min(1); // `a0`…`a15` in slot order (§6.1)
const BulletId = z.string().min(1); // `b<n>`, ascending (§6.1)

export const MoveChoiceSchema = z.enum(MOVE_CHOICES);
export const TurnChoiceSchema = z.enum(TURN_CHOICES);

// ---- Doer wire: browser → Worker → Clef (§5.4; Clef's shape per ISSUES I-004) ----

/** The five fixed doer questions (row 11). Users cannot add questions (§5.4). */
export const QuestionIdSchema = z.enum(["move", "turn", "fire", "target", "escalate"]);
export type QuestionId = z.infer<typeof QuestionIdSchema>;

/** Per-question doer instructions: text, never empty (Clef), at most 500 characters. */
const Instructions = z.string().min(1).max(500);

/** A yes/no question; Clef answers P(yes). */
export const NoulQuestionSchema = z.strictObject({
  type: z.literal("noul"),
  instructions: Instructions,
  criteria: z.strictObject({ true: z.string().optional(), false: z.string().optional() }).optional(),
});
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;

/** A pick-one question: option id → description. Clef takes 2 to 255 options (I-005). */
export const ChoiceQuestionSchema = z.strictObject({
  type: z.literal("choice"),
  instructions: Instructions,
  criteria: z.record(z.string(), z.string()).refine(
    (criteria) => {
      const n = Object.keys(criteria).length;
      return n >= 2 && n <= 255;
    },
    { message: "a choice question needs 2 to 255 options" },
  ),
});
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;

/**
 * The questions of one doer call, keyed by question id. Each id has a fixed type:
 * move, turn and target are choices, fire and escalate are nouls. move and turn
 * offer exactly the fixed choices (an enum-keyed record is exhaustive in zod 4;
 * §5.4: users cannot change choices). target offers the visible enemy ids plus
 * `none` and is left out when nobody is visible (I-005).
 */
export const DoerQuestionsSchema = z
  .strictObject({
    move: ChoiceQuestionSchema.extend({ criteria: z.record(MoveChoiceSchema, z.string()) }).optional(),
    turn: ChoiceQuestionSchema.extend({ criteria: z.record(TurnChoiceSchema, z.string()) }).optional(),
    fire: NoulQuestionSchema.optional(),
    target: ChoiceQuestionSchema.optional(),
    escalate: NoulQuestionSchema.optional(),
  })
  .refine((questions) => Object.values(questions).some((q) => q !== undefined), {
    message: "ask at least one question",
  });
export type DoerQuestions = z.infer<typeof DoerQuestionsSchema>;

/**
 * The doer's `state` (§5.4): what perception gives the agent, plus its current
 * plan text. This is the wire form of `Observation` (types.ts) with `pos` as an
 * [x, y] tuple to save tokens; brain converts between the two (v3.1). Clef
 * truncates `state` to fit, so fields go most important first, and parsing
 * outputs them in this order whatever order they arrived in.
 */
export const DoerStateSchema = z.strictObject({
  self: z.strictObject({
    pos: z.tuple([z.number(), z.number()]),
    facing: z.number(),
    hp: z.number().min(0),
    kills: z.number().int().min(0),
    secondsLeft: z.number().min(0),
  }),
  visible: z.array(
    z.strictObject({ id: AgentId, bearing: z.number(), dist: z.number().min(0), moving: z.boolean() }),
  ),
  heard: z.array(
    z.strictObject({ kind: z.enum(SOUND_KINDS), bearing: z.number(), dist: z.enum(HEARING_BANDS) }),
  ),
  incoming: z.array(z.strictObject({ bearing: z.number() })),
  plan: z.string().max(2000),
});
export type DoerState = z.infer<typeof DoerStateSchema>;

/** `/decide` body, browser → Worker. The Worker adds `model` (DOER_MODEL); the client never picks it. */
export const DecideRequestSchema = z.strictObject({
  state: DoerStateSchema,
  questions: DoerQuestionsSchema,
});
export type DecideRequest = z.infer<typeof DecideRequestSchema>;

/** Clef's answer to a noul question: P(yes). */
export const NoulAnswerSchema = z.object({ type: z.literal("noul"), noul: Probability });
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;

/** Clef's answer to a choice question: the pick, a probability per option, and a confidence. */
export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), Probability),
  confidence: Probability,
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

/**
 * One answer per question asked: same keys and types as DoerQuestions, with the
 * move and turn picks typed to the fixed choices. Any key may be absent; target
 * is not asked when nobody is visible (I-005).
 */
export const DoerAnswersSchema = z.object({
  move: ChoiceAnswerSchema.extend({ choice: MoveChoiceSchema }).optional(),
  turn: ChoiceAnswerSchema.extend({ choice: TurnChoiceSchema }).optional(),
  fire: NoulAnswerSchema.optional(),
  target: ChoiceAnswerSchema.optional(),
  escalate: NoulAnswerSchema.optional(),
});
export type DoerAnswers = z.infer<typeof DoerAnswersSchema>;

/** Doer response, Worker → browser: Clef's response as-is. Bots and fakes may omit `usage`. */
export const DoerAnswerSchema = z.object({
  model: z.string().min(1),
  answers: DoerAnswersSchema,
  usage: z.object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }).optional(),
});
export type DoerAnswer = z.infer<typeof DoerAnswerSchema>;

// ---- Thinker: LLM → browser (§5.4) ----

/** The thinker's structured output: plan text for the doer, and a scratchpad it rewrites each call (row 12). */
export const PlanSchema = z.object({
  text: z.string().min(1).max(2000),
  scratchpad: z.string().max(4000),
});
export type Plan = z.infer<typeof PlanSchema>;

// ---- User config: forms and links ----

export const BotKindSchema = z.enum(["wanderer", "camper"]);
export type BotKind = z.infer<typeof BotKindSchema>;

/** A seat in a match: the user's prompted mind, a doer-only mind (row 32), or a scripted bot (row 23). */
export const SlotSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompted") }),
  z.object({ kind: z.literal("doer") }),
  z.object({ kind: z.literal("bot"), bot: BotKindSchema }),
]);
export type Slot = z.infer<typeof SlotSchema>;

/** 2 to 16 slots: headless tests run 2-bot matches; the UI offers 4 to 16 (row 6). */
export const MatchConfigSchema = z.object({
  mapId: z.string().min(1),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  durationTicks: z.number().int().min(1).max(60_000),
  slots: z.array(SlotSchema).min(2).max(16),
});
export type MatchConfig = z.infer<typeof MatchConfigSchema>;

const DoerInstructionText = z.string().max(500);

/**
 * The prompts that produced a match, so a replay is reproducible (§5.3). Four
 * user-editable doer instructions; escalate's instruction is fixed by kbattle
 * (§5.4). Blank is allowed: the request builder uses the shipped default (I-005).
 */
export const PromptsSchema = z.object({
  thinkerSystem: z.string().max(8000),
  doerInstructions: z.object({
    move: DoerInstructionText,
    turn: DoerInstructionText,
    fire: DoerInstructionText,
    target: DoerInstructionText,
  }),
});
export type Prompts = z.infer<typeof PromptsSchema>;

// ---- Maps (§6.2) ----

/** Same shape as the Vec2 interface in vec2.ts (a test keeps them equal). */
export const Vec2Schema = z.object({ x: z.number(), y: z.number() });

/** A simple polygon that blocks movement, bullets and line of sight. */
export const ObstacleSchema = z.object({ vertices: z.array(Vec2Schema).min(3) });
export type Obstacle = z.infer<typeof ObstacleSchema>;

/** A hand-authored arena spanning x 0..width, y 0..height, fully known to every agent. */
export const MapSpecSchema = z.object({
  id: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  obstacles: z.array(ObstacleSchema),
  spawns: z.array(Vec2Schema).min(2),
});
export type MapSpec = z.infer<typeof MapSpecSchema>;

// ---- Replay file: disk → browser (§5.3) ----

const SpawnEvent = z.object({
  kind: z.literal("Spawn"),
  tick: TickNumber,
  agent: AgentId,
  pos: Vec2Schema,
  facing: z.number(),
});

/**
 * Positions after the step of `tick`, so the renderer never runs the sim.
 * agents: [id, x, y, facing, hp] for agents alive after this tick; a dead agent
 * is left out of this and every later Tick. bullets: [id, x, y]; a bullet that
 * hit something stops appearing. near: [target, fromX, fromY] for each bullet
 * that passed within INCOMING_RADIUS_M of a living agent this tick without
 * hitting it, from = the shooter's position, so a replay can rebuild incoming
 * fire (ISSUES I-016); present only when there is one. The log writer
 * (core/src/sim/log.ts) rounds x and y to 2 decimals and facing to 1; the schema
 * does not enforce that.
 */
const TickEvent = z.object({
  kind: z.literal("Tick"),
  tick: TickNumber,
  agents: z.array(z.tuple([AgentId, z.number(), z.number(), z.number(), z.number()])),
  bullets: z.array(z.tuple([BulletId, z.number(), z.number()])),
  near: z.array(z.tuple([AgentId, z.number(), z.number()])).optional(),
});

const ShotEvent = z.object({ kind: z.literal("Shot"), tick: TickNumber, agent: AgentId, bullet: BulletId });

const HitEvent = z.object({
  kind: z.literal("Hit"),
  tick: TickNumber,
  bullet: BulletId,
  target: AgentId,
  damage: z.number().positive(),
});

const DeathEvent = z.object({ kind: z.literal("Death"), tick: TickNumber, agent: AgentId, killer: AgentId });

/** One doer call (§5.5): answers when it worked; error when not, and the agent keeps its last answer. */
const DoerEvent = z
  .object({
    kind: z.literal("Doer"),
    tick: TickNumber,
    agent: AgentId,
    ok: z.boolean(),
    answers: DoerAnswersSchema.optional(),
    error: z.string().min(1).optional(),
  })
  .refine((e) => !e.ok || e.answers !== undefined, { path: ["answers"], message: "ok: true needs answers" })
  .refine((e) => e.ok || e.error !== undefined, { path: ["error"], message: "ok: false needs an error" });

/**
 * One thinker call. requestedTick is when it was asked for; tick is when its
 * plan was applied, or its failure logged. The mind panel draws both (§5.3).
 * input stays free-form until the thinker client defines it (v3.2), but must be
 * present: every call is logged with its input (principle 4).
 */
const ThinkerEvent = z
  .object({
    kind: z.literal("Thinker"),
    tick: TickNumber,
    requestedTick: TickNumber,
    agent: AgentId,
    input: z.unknown(),
    ok: z.boolean(),
    plan: PlanSchema.optional(),
    error: z.string().min(1).optional(),
  })
  .refine((e) => e.requestedTick <= e.tick, {
    path: ["requestedTick"],
    message: "requestedTick cannot be after tick",
  })
  .refine((e) => !e.ok || e.plan !== undefined, { path: ["plan"], message: "ok: true needs a plan" })
  .refine((e) => e.ok || e.error !== undefined, { path: ["error"], message: "ok: false needs an error" });

/** Last agent alive or time up (§6.2). ranking: agent ids, winner first; empty for a cancelled run (v4.2). */
const MatchEndEvent = z.object({ kind: z.literal("MatchEnd"), tick: TickNumber, ranking: z.array(AgentId) });

/** Everything a replay shows. Kinds are named as in DESIGN.md §5.3. */
export const EventSchema = z.discriminatedUnion("kind", [
  SpawnEvent,
  TickEvent,
  ShotEvent,
  HitEvent,
  DeathEvent,
  DoerEvent,
  ThinkerEvent,
  MatchEndEvent,
]);
export type Event = z.infer<typeof EventSchema>;

/**
 * The replay file (principle 7): one match, enough to watch it and to reproduce
 * it. Every event happens within the match: its tick is at most
 * config.durationTicks (a viewer indexes ticks 0..last, ISSUES I-014).
 */
export const MatchLogSchema = z
  .object({
    version: z.literal(1),
    config: MatchConfigSchema,
    seed: z.number().int(),
    prompts: PromptsSchema,
    events: z.array(EventSchema),
  })
  .refine((log) => log.seed === log.config.seed, { path: ["seed"], message: "seed must equal config.seed" })
  .superRefine((log, ctx) => {
    const last = log.config.durationTicks;
    log.events.forEach((event, i) => {
      if (event.tick <= last) return;
      ctx.addIssue({ code: "custom", path: ["events", i, "tick"], message: `tick is after config.durationTicks (${last})` });
    });
  });
export type MatchLog = z.infer<typeof MatchLogSchema>;

/** The five boundary schemas by name (§5.3): `schemas.MatchLog.parse(json)`. */
export const schemas = Object.freeze({
  DoerAnswer: DoerAnswerSchema,
  Plan: PlanSchema,
  DecideRequest: DecideRequestSchema,
  MatchLog: MatchLogSchema,
  MatchConfig: MatchConfigSchema,
});
