// Internal sim types (DESIGN.md §5.3: plain TS interfaces inside the process).
// Types of data that enters from outside (MatchConfig, Slot, Plan, DoerAnswer,
// DecideRequest, MatchLog, Event) are z.infer types in core's version-1 schemas
// (platform/core/src/legacy/schemas.ts), and MapSpec, which is loaded from JSON, is
// one in ./maps; each is defined once there.
// Units (§6.1): meters, y down, degrees clockwise-positive with 0° = +x, ticks.

import type { RngState } from "@decision-arena/core";
import type { MapSpec } from "./maps";
import type { Vec2 } from "./vec2";

/** `a0`…`a15` in slot order (§6.1). */
export type AgentId = string;

// Each string union below is derived from a frozen list, so zod enums
// (schemas.ts) are built from the same list instead of repeating it.

/** Doer `move` choices (§5.4), relative to facing; also the `move` criteria keys. */
export const MOVE_CHOICES = Object.freeze(["forward", "back", "left", "right", "stop"] as const);
export type MoveChoice = (typeof MOVE_CHOICES)[number];

/** Doer `turn` choices (§5.4). `face_target` with no target means `none`. */
export const TURN_CHOICES = Object.freeze(["left", "right", "none", "face_target"] as const);
export type TurnChoice = (typeof TURN_CHOICES)[number];

/** What was heard (§6.2). */
export const SOUND_KINDS = Object.freeze(["shot", "steps"] as const);
export type SoundKind = (typeof SOUND_KINDS)[number];

/** Coarse hearing distance (§6.2), nearest first; band edges are HEARING_BANDS_M. */
export const HEARING_BANDS = Object.freeze(["near", "mid", "far"] as const);
export type HearingBand = (typeof HEARING_BANDS)[number];

/** What an agent does every tick until its next doer answer replaces it (§5.4). */
export interface Action {
  move: MoveChoice;
  turn: TurnChoice;
  fire: boolean;
  target: AgentId | null;
}

/** Default action: stand still, keep facing, hold fire. Frozen: copy it before changing a field. */
export const STOP_ACTION: Readonly<Action> = Object.freeze({
  move: "stop",
  turn: "none",
  fire: false,
  target: null,
});

export interface Agent {
  id: AgentId;
  slot: number; // index into the match's slots
  pos: Vec2;
  facing: number; // absolute degrees, (-180, 180]
  hp: number;
  alive: boolean;
  deathTick: number | null; // the tick it died on, null while alive (for ranking)
  kills: number;
  cooldownTicks: number; // ticks until the weapon can fire again
  action: Action; // persists until the next doer answer
  moved: boolean; // moved this tick: footsteps, and `moving` for whoever sees it
}

export interface Bullet {
  id: string; // `b<n>`, ascending (§6.1)
  owner: AgentId;
  pos: Vec2;
  vel: Vec2; // m per tick
  spawnTick: number;
}

/**
 * What happened during one step that perception reads and the state keeps
 * nowhere else (sim rulings R6, R15): step t's shots, hits and near misses.
 * `pos` and `from` are where the shooter stood at tick t (after its move), which
 * perception reports as a bearing.
 */
export interface TickFacts {
  shots: { agent: AgentId; pos: Vec2 }[]; // who fired, standing where
  hits: { target: AgentId; from: Vec2 }[];
  nearMisses: { target: AgentId; from: Vec2 }[]; // bullets that passed within INCOMING_RADIUS_M without hitting
}

export interface WorldState {
  tick: number;
  durationTicks: number; // the match's length (MatchConfig), for perception's time left
  map: MapSpec;
  agents: Agent[]; // slot order
  bullets: Bullet[];
  nextBulletId: number; // n of the next `b<n>`
  rng: RngState; // seeded from MatchConfig.seed; the spawn shuffle and bullet spread draw from it (R3)
  /**
   * The perception window (R15): the facts of the newest steps, oldest first, at
   * most PERCEPTION_WINDOW_TICKS of them; the last entry is the step that produced
   * `tick`, and spawn starts it empty. Every slot decides once per
   * PERCEPTION_WINDOW_TICKS ticks (R1), so each fact reaches exactly one decision.
   */
  recent: TickFacts[];
}

/**
 * What perception gives one agent at one tick (§6.2, §3 principle 3).
 * Fields are ordered most-important-first because Clef truncates its state
 * (§5.4). Bearings are relative to facing, (-180, 180], positive = right.
 */
export interface Observation {
  self: { pos: Vec2; facing: number; hp: number; kills: number; secondsLeft: number };
  visible: { id: AgentId; bearing: number; dist: number; moving: boolean }[];
  heard: { kind: SoundKind; bearing: number; dist: HearingBand }[];
  incoming: { bearing: number }[];
}
