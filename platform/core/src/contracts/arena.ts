// The arena contract (DESIGN.md §5.2, rows 42 and 46; ruling R21.c): a game is
// a plugin. The match loop calls an arena through these plain functions, once
// per tick or per call, and never reads its state; the arena owns its rules,
// ending, ranking, events, what its agents perceive and how answers become
// actions. Core names no arena and knows no renderer: the web's registry entry
// pairs an arena with its renderer (R1.1).

import * as z from "zod";
import type { RngState } from "../rng";
import type { AgentId, Memory } from "./agent";
import type { Model } from "./model";
import type { Answers, QuestionId, Questions } from "./question";

/**
 * What every arena config has (R21.c): the loop seeds the RNG with `seed` and
 * bounds event ticks with `durationTicks`. An arena's config schema extends it
 * (`BaseConfigSchema.extend({ ... })`) and validates the rest.
 */
export const BaseConfigSchema = z.object({
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  durationTicks: z.number().int().min(1).max(60_000),
});
export type BaseConfig = z.infer<typeof BaseConfigSchema>;

/** What a player starts from (§5.4): the planner prompt, the instructions per actor question, and the plan of an agent without a planner. */
export interface AgentDefaults {
  planner: string;
  actor: Record<QuestionId, string>;
  fixedPlan: string;
}

/** What every arena event has: its kind (never Call, Tick or MatchEnd, the platform's) and the tick it happened on. */
export type EventBase = { kind: string; tick: number };

/** How a match ends: agent ids best first, and the arena's own outcome per agent when it has one (laps, value extracted). */
export interface MatchOutcome {
  ranking: AgentId[];
  results?: Record<AgentId, unknown>;
}

/**
 * The types one arena fills in (R21.c's type bag): its config (the base plus its
 * own fields), its world state, what one agent perceives, the action an agent
 * keeps until its next answer, its event union, and its Tick payload.
 */
export interface ArenaTypes {
  Config: BaseConfig;
  State: unknown;
  Obs: unknown;
  Action: unknown;
  Event: EventBase;
  TickData: unknown;
}

export interface Arena<T extends ArenaTypes = ArenaTypes> {
  /** "battle-royale"; what agent specs and logs name. */
  id: string;
  title: string;
  /** Team shapes, the default first ("solo"). */
  modes: readonly string[];
  /** Ids of the arena's hand-authored worlds; the arena loads them itself. */
  maps: readonly string[];
  /** The arena's config, BaseConfigSchema extended. */
  config: z.ZodType<T["Config"]>;
  /** Wall time of one tick for a runner that paces the match; the platform's TICK_MS (50) when absent. */
  tickMs?: number;
  /** Ticks between actor decisions; ACTOR_INTERVAL_TICKS (10) when absent. */
  actorIntervalTicks?: number;

  /** The world at tick 0 for these agents (the platform's ids, slot order), and the events that announce it. Draws from `rng` only. */
  spawn(config: T["Config"], agents: readonly AgentId[], rng: RngState): { state: T["State"]; events: T["Event"][] };
  /** What one agent knows now (principle 3). Pure. */
  perceive(state: T["State"], agent: AgentId): T["Obs"];
  /** The actor's questions for this observation, with the arena's default instructions; the loop puts the player's in. */
  questions(obs: T["Obs"], memory: Memory): Questions;
  /**
   * The action an agent keeps until its next answer, from checked answers (each
   * answer has its question's type, any may be missing). `previous` is the agent's
   * current action, undefined before its first. Thresholds live here.
   */
  actionFrom(answers: Answers, obs: T["Obs"], previous: T["Action"] | undefined): T["Action"];
  /**
   * The next tick: every active agent's current action (an agent with none yet is
   * absent) applied to `state`, which it must not change; the events of that tick.
   */
  step(state: T["State"], actions: Record<AgentId, T["Action"]>): { state: T["State"]; events: T["Event"][] };
  /** The Tick payload for this state: what a replay draws from. The loop logs it as it is, so it must not share anything step changes later. */
  tick(state: T["State"]): T["TickData"];
  /** Validates Tick.data when a log is read (§10: how Tick.data is typed per arena). */
  tickData: z.ZodType<T["TickData"]>;
  /** Validates the arena's events when a log is read: a discriminated union of its kinds. */
  events: z.ZodType<T["Event"]>;
  /** The agents still asked, in slot order: in the world and able to act (one that left alive is not). */
  active(state: T["State"]): AgentId[];
  /** The outcome once the match is over, null while it runs. At durationTicks it must not be null. */
  ended(state: T["State"]): MatchOutcome | null;
  /** What every agent knows before the match: the world and the rules in a few lines (row 48). */
  staticText(config: T["Config"]): string;
  /** One observation as text, for the planner's message. */
  observationText(obs: T["Obs"]): string;
  /** Scripted agents by name, used as `bot/<name>`: a fresh model per slot, deterministic given (seed, slot). */
  bots: Record<string, (seed: number, slot: number) => Model>;
  defaults: AgentDefaults;
}
