// Shared test fixtures: hand-built observations and worlds, and the 16-bot match
// of the version-1 demo (map-1, seed 7, wanderers and campers alternating).

import { botSpec, createRng, nextFloat, type AgentSpec, type RngState } from "@decision-arena/core";
import { AGENT_HP, getMap, STOP_ACTION, type Agent, type AgentId, type Bullet, type MapSpec, type Observation, type Vec2, type WorldState } from "@decision-arena/kit-shooter";

type Self = Observation["self"];

/** An observation: alone at the arena center facing 0 with full HP, unless overridden. */
export function obs(self: Partial<Self> = {}, rest: Partial<Omit<Observation, "self">> = {}): Observation {
  return {
    self: { pos: { x: 50, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 300, ...self },
    visible: [],
    heard: [],
    incoming: [],
    ...rest,
  };
}

/** An enemy in view. */
export function enemy(id: AgentId, bearing: number, dist = 30, moving = false): Observation["visible"][number] {
  return { id, bearing, dist, moving };
}

/** The tick of decision n (0-based) on the actor cadence: 1, 11, 21, … (R1). */
export const decisionTick = (n: number) => 1 + 10 * n;

/**
 * 50 synthetic observations from a seed: a random walk around the arena with
 * occasional standstills, hits and enemies in view, so every bot branch runs
 * (the kit's bot tests use the same generator).
 */
export function syntheticViews(seed: number, count = 50): Observation[] {
  let rng: RngState = createRng(seed);
  const float = () => {
    const d = nextFloat(rng);
    rng = d.rng;
    return d.value;
  };
  let pos = { x: 10 + 80 * float(), y: 10 + 80 * float() };
  let facing = Math.round(360 * float()) - 179;
  let hp = 100;
  return Array.from({ length: count }, () => {
    if (float() < 0.7) {
      const step = 2.5 * float();
      pos = { x: Math.min(99, Math.max(1, pos.x + step * (float() - 0.5) * 2)), y: Math.min(99, Math.max(1, pos.y + step)) };
      if (pos.y >= 99) pos = { x: pos.x, y: 5 };
    }
    if (float() < 0.3) facing = Math.round(360 * float()) - 179;
    if (float() < 0.1 && hp > 20) hp -= 20;
    const visible = float() < 0.35 ? [enemy("a3", Math.round(90 * float()) - 45, Math.round(5 + 50 * float()))] : [];
    return obs({ pos: { ...pos }, facing, hp }, { visible });
  });
}

export const map1 = getMap("map-1");

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

/** A world at `tick` (default 0) on map-1 unless another map is given. */
export function makeWorld(parts: { agents: Agent[]; bullets?: Bullet[]; map?: MapSpec; tick?: number; durationTicks?: number }): WorldState {
  const bullets = parts.bullets ?? [];
  return {
    tick: parts.tick ?? 0,
    durationTicks: parts.durationTicks ?? 6000,
    map: parts.map ?? map1,
    agents: parts.agents,
    bullets,
    nextBulletId: Math.max(-1, ...bullets.map((b) => Number(b.id.slice(1)))) + 1,
    rng: createRng(1),
    recent: [],
  };
}

/** The version-1 demo's agents: 16 bots, wanderers and campers alternating (R25). */
export const SIXTEEN_BOTS: AgentSpec[] = Array.from({ length: 16 }, (_, i) => botSpec("battle-royale", i % 2 === 0 ? "wanderer" : "camper"));

/** An open arena: nothing blocks a walk from a spawn toward the center. */
export const OPEN: MapSpec = {
  id: "open",
  width: 100,
  height: 100,
  obstacles: [],
  spawns: [
    { x: 20, y: 50 },
    { x: 80, y: 50 },
    { x: 50, y: 20 },
  ],
};
