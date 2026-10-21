// Internal sim types (DESIGN.md §5.3: plain TS interfaces inside the process).
// Boundary types (MatchConfig, Slot, Plan, DoerAnswer, DecideRequest, MatchLog,
// Event) are zod schemas with z.infer types, defined once in v0.3.
// Units (§6.1): meters, y down, degrees clockwise-positive with 0° = +x, ticks.

import type { Vec2 } from "./vec2";

/** `a0`…`a15` in slot order (§6.1). */
export type AgentId = string;

/** Doer `move` answer (§5.4), relative to facing. */
export type MoveChoice = "forward" | "back" | "left" | "right" | "stop";

/** Doer `turn` answer (§5.4). `face_target` with no target means `none`. */
export type TurnChoice = "left" | "right" | "none" | "face_target";

/** What was heard (§6.2). */
export type SoundKind = "shot" | "steps";

/** Coarse hearing distance (§6.2); band edges are HEARING_BANDS_M. */
export type HearingBand = "near" | "mid" | "far";

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

/** Simple polygon that blocks movement, bullets and line of sight (§6.2). */
export interface Obstacle {
  vertices: Vec2[];
}

/** Hand-authored arena, fully known to every agent (§6.2). */
export interface MapSpec {
  id: string;
  width: number; // m
  height: number; // m
  obstacles: Obstacle[];
  spawns: Vec2[];
}

export interface Agent {
  id: AgentId;
  slot: number; // index into the match's slots
  pos: Vec2;
  facing: number; // absolute degrees, (-180, 180]
  hp: number;
  alive: boolean;
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

export interface WorldState {
  tick: number;
  map: MapSpec;
  agents: Agent[]; // slot order
  bullets: Bullet[];
  nextBulletId: number; // n of the next `b<n>`
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
