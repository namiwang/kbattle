// Hand-built worlds for the sim tests and the golden scenarios.

import { readFileSync } from "node:fs";
import { AGENT_HP } from "../../src/constants";
import { getMap } from "../../src/maps";
import type { MapSpec } from "../../src/schemas";
import { createRng } from "../../src/sim/rng";
import { STOP_ACTION, type Agent, type Bullet, type WorldState } from "../../src/types";
import type { Vec2 } from "../../src/vec2";

export const arena1 = getMap("arena-1");

/** Freezes `value` and everything reachable from it, so a mutation throws (ES modules are strict). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** An agent `a<slot>` with spawn defaults: full HP, alive, ready weapon, STOP_ACTION. */
export function makeAgent(slot: number, pos: Vec2, facing = 0, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `a${slot}`,
    slot,
    pos: { ...pos },
    facing,
    hp: AGENT_HP,
    alive: true,
    deathTick: null,
    kills: 0,
    cooldownTicks: 0,
    action: { ...STOP_ACTION },
    moved: false,
    ...overrides,
  };
}

/** A bullet `b<n>` in flight. */
export function makeBullet(n: number, owner: string, pos: Vec2, vel: Vec2, spawnTick = 0): Bullet {
  return { id: `b${n}`, owner, pos: { ...pos }, vel: { ...vel }, spawnTick };
}

/** A world at `tick` (default 0) on arena-1 unless another map is given, its RNG seeded with `seed`. */
export function makeWorld(parts: {
  agents: Agent[];
  bullets?: Bullet[];
  map?: MapSpec;
  seed?: number;
  tick?: number;
}): WorldState {
  const bullets = parts.bullets ?? [];
  return {
    tick: parts.tick ?? 0,
    durationTicks: 6000,
    map: parts.map ?? arena1,
    agents: parts.agents,
    bullets,
    nextBulletId: Math.max(-1, ...bullets.map((b) => Number(b.id.slice(1)))) + 1,
    rng: createRng(parts.seed ?? 1),
    lastTick: { shots: [], hits: [], nearMisses: [] },
  };
}

export const SCENE_DIR = new URL("../../fixtures/scenes/", import.meta.url);

/**
 * A hand-written world snapshot from core/fixtures/scenes/<name>.json: a
 * description of what it shows, and the WorldState itself (map inline, explicit
 * lastTick). Deeply frozen, so a perception that writes to it throws.
 */
export function loadScene(name: string): { description: string; state: WorldState } {
  const json = JSON.parse(readFileSync(new URL(`${name}.json`, SCENE_DIR), "utf8")) as {
    description: string;
    state: WorldState;
  };
  return { description: json.description, state: deepFreeze(json.state) };
}
