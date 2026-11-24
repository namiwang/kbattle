// The battle royale's world and what one agent is shown of it.

import type { RngState } from "../../core/numbers.ts";
import type { Vec2 } from "./geometry.ts";
import type { MapSpec } from "./maps.ts";

/** Relative to the facing, which a move never changes. */
export type Move = "forward" | "back" | "left" | "right" | "stop";
export type Turn = "left" | "right" | "none" | "face_target";

/** What an agent does on every tick until an answer changes it. `target` is whom face_target follows. */
export interface Action {
  move: Move;
  turn: Turn;
  fire: boolean;
  target: string | null;
}

export interface Fighter {
  id: string;
  pos: Vec2;
  facing: number; // absolute degrees, (-180, 180]
  hp: number;
  alive: boolean;
  deathTick: number | null; // for the ranking
  kills: number;
  cooldownTicks: number; // until it can fire again
  action: Action;
  moved: boolean; // in the newest step: footsteps, and `moving` for whoever sees it
}

export interface Bullet {
  id: string; // b<n>, ascending
  owner: string;
  pos: Vec2;
  vel: Vec2; // m per tick
  spawnTick: number;
}

/** What happened in one step that the world keeps nowhere else. `pos` and `from` are where the shooter stood in that step. */
export interface TickFacts {
  shots: { agent: string; pos: Vec2 }[];
  hits: { target: string; from: Vec2 }[];
  nearMisses: { target: string; from: Vec2 }[]; // bullets that passed within INCOMING_RADIUS_M without hitting
}

/** The world after `tick` steps. Read-only: a step builds a new one. */
export interface WorldState {
  tick: number;
  map: MapSpec;
  agents: Fighter[]; // in list order: a0, a1, …
  bullets: Bullet[];
  nextBulletId: number;
  rng: RngState; // the spawn shuffle and each bullet's spread draw from it
  recent: TickFacts[]; // the newest DECISION_TICKS steps, oldest first
}

/** What one agent perceives. Most important first; bearings are relative to its facing, + to the right. */
export interface Observation {
  self: { pos: Vec2; facing: number; hp: number; kills: number; secondsLeft: number };
  visible: { id: string; bearing: number; dist: number; moving: boolean }[]; // nearest first, dist in m
  heard: { kind: "shot" | "steps"; bearing: number; dist: "near" | "mid" | "far" }[]; // shots, then steps, each nearest first
  incoming: { bearing: number }[]; // the shooters whose bullets hit it, then those that passed close, each oldest first
}
