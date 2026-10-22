// One physics tick (DESIGN.md §5.1, §6.2; sim rulings R1, R2, R4–R6).
//
// step is pure: the same state and actions give the same result, nothing
// outside its arguments is read (no Math.random, no clock), and the input state
// is never mutated. The result is a new state object; parts that did not change
// may be shared with the input, so treat every state as read-only.
//
// Order inside step(t), each phase for every agent before the next (R4):
// (1) cooldowns, (2) turn, (3) move, (4) fire, (5) bullets fly and hit,
// (6) tick = t, and step t's shots, hits and near misses join the perception
// window, which keeps the newest DOER_INTERVAL_TICKS steps (R6, R15). Agents
// never collide with each other (PoC).

import { headingTo, normalizeDeg, turnToward } from "../angles";
import {
  AGENT_RADIUS_M,
  BULLET_DAMAGE,
  DOER_INTERVAL_TICKS,
  FIRE_INTERVAL_TICKS,
  INCOMING_RADIUS_M,
  MOVE_SPEED_MPS,
  TURN_RATE_DPS,
  VISION_RANGE_M,
} from "../constants";
import type { EventOf } from "../log";
import type { MapSpec } from "../schemas";
import type { Action, Agent, AgentId, Bullet, MoveChoice, TickFacts, WorldState } from "../types";
import { dpsToDegreesPerTick, mpsToMetersPerTick } from "../units";
import { add, dist, fromAngle, scale, type Vec2 } from "../vec2";
import {
  circleInsideArena,
  circleOverlapsPolygon,
  hasLineOfSight,
  pointSegmentDistance,
  segmentCircleT,
  segmentLeavesArenaT,
  segmentPolygonT,
} from "./collision";
import { nextFloat } from "./rng";
import { spawnBullet, spreadDeg } from "./weapons";

/** New actions from this tick's doer answers, by agent id; an agent without one keeps its current action. */
export type StepActions = Readonly<Record<AgentId, Action>>;

/** The events a step can produce; the match loop adds Spawn, Tick, Doer, Thinker and MatchEnd. */
export type StepEvent = EventOf<"Shot" | "Hit" | "Death">;

export interface StepResult {
  state: WorldState;
  events: StepEvent[];
}

const TURN_STEP_DEG = dpsToDegreesPerTick(TURN_RATE_DPS);
const MOVE_STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS);

/** Each move as an angle relative to the facing (R4 step 3); stop does not move. */
const MOVE_OFFSET_DEG: Readonly<Record<MoveChoice, number | null>> = {
  forward: 0,
  right: 90,
  back: 180,
  left: -90,
  stop: null,
};

/** Advances `state` from tick t − 1 to tick t. */
export function step(state: WorldState, actions: StepActions = {}): StepResult {
  const tick = state.tick + 1;
  const events: StepEvent[] = [];
  const facts: TickFacts = { shots: [], hits: [], nearMisses: [] };

  // Fresh copies of every agent: the phases below write only to these.
  const agents = state.agents.map((agent): Agent => {
    const action = Object.hasOwn(actions, agent.id) ? actions[agent.id] : undefined;
    return { ...agent, pos: { ...agent.pos }, action: action ? { ...action } : agent.action, moved: false };
  });
  const byId = new Map(agents.map((a) => [a.id, a]));

  // (1) Weapons cool down.
  for (const agent of agents) if (agent.alive && agent.cooldownTicks > 0) agent.cooldownTicks -= 1;

  // (2) Turn, against positions at the start of the tick (nobody has moved yet).
  for (const agent of agents) if (agent.alive) agent.facing = turned(agent, byId, state.map);

  // (3) Move along the new facing.
  for (const agent of agents) {
    if (!agent.alive) continue;
    const to = destination(agent, state.map);
    agent.moved = to.x !== agent.pos.x || to.y !== agent.pos.y;
    agent.pos = to;
  }

  // (4) Fire, in slot order: one spread draw per shot.
  let rng = state.rng;
  let nextBulletId = state.nextBulletId;
  const fired: Bullet[] = [];
  for (const agent of agents) {
    if (!agent.alive || !agent.action.fire || agent.cooldownTicks > 0) continue;
    const draw = nextFloat(rng);
    rng = draw.rng;
    const bullet = spawnBullet(agent, `b${nextBulletId++}`, tick, spreadDeg(draw.value));
    fired.push(bullet);
    agent.cooldownTicks = FIRE_INTERVAL_TICKS;
    events.push({ kind: "Shot", tick, agent: agent.id, bullet: bullet.id });
    facts.shots.push({ agent: agent.id, pos: { ...agent.pos } });
  }

  // (5) Bullets fly, the ones just fired included, oldest first; a body killed by
  // an earlier bullet this tick no longer stops later ones.
  const bullets: Bullet[] = [];
  for (const bullet of [...state.bullets, ...fired]) {
    const flight = fly(bullet, agents, state.map);
    const shooter = byId.get(bullet.owner);
    // Incoming fire is reported as the shooter's position now (R6, R7); an owner
    // missing from the world (hand-built test states only) falls back to the bullet.
    const from = () => ({ ...(shooter ? shooter.pos : bullet.pos) });
    for (const target of flight.nearMisses) facts.nearMisses.push({ target: target.id, from: from() });
    if (flight.victim) {
      const victim = flight.victim;
      victim.hp = Math.max(0, victim.hp - BULLET_DAMAGE);
      events.push({ kind: "Hit", tick, bullet: bullet.id, target: victim.id, damage: BULLET_DAMAGE });
      facts.hits.push({ target: victim.id, from: from() });
      if (victim.hp <= 0) {
        victim.alive = false;
        victim.deathTick = tick;
        if (shooter) shooter.kills += 1;
        events.push({ kind: "Death", tick, agent: victim.id, killer: bullet.owner });
      }
    } else if (!flight.stopped) {
      bullets.push({ ...bullet, pos: add(bullet.pos, bullet.vel) });
    }
  }

  // (6) The new state is tick t; its window drops the step that is now DOER_INTERVAL_TICKS old.
  const recent = [...state.recent, facts].slice(-DOER_INTERVAL_TICKS);
  return {
    state: { ...state, tick, agents, bullets, nextBulletId, rng, recent },
    events,
  };
}

/**
 * The facing after this tick's turn (R4 step 2): left/right by TURN_STEP_DEG;
 * face_target toward the target's position when it is another living agent
 * within VISION_RANGE_M in line of sight (the cone is not required); else unchanged.
 */
function turned(agent: Agent, byId: ReadonlyMap<AgentId, Agent>, map: MapSpec): number {
  const { turn, target } = agent.action;
  if (turn === "left") return normalizeDeg(agent.facing - TURN_STEP_DEG);
  if (turn === "right") return normalizeDeg(agent.facing + TURN_STEP_DEG);
  if (turn !== "face_target" || target === null) return agent.facing;
  const other = byId.get(target);
  if (!other || other === agent || !other.alive) return agent.facing;
  const d = dist(agent.pos, other.pos);
  if (d === 0 || d > VISION_RANGE_M || !hasLineOfSight(agent.pos, other.pos, map.obstacles)) return agent.facing;
  return turnToward(agent.facing, headingTo(agent.pos, other.pos), TURN_STEP_DEG);
}

/**
 * Where the agent's move takes it (R4 step 3, R5): one MOVE_STEP_M step at its
 * facing plus the move's offset. If the body would overlap an obstacle or leave
 * the arena there, the x part alone, then the y part alone; else where it stands.
 */
function destination(agent: Agent, map: MapSpec): Vec2 {
  const offset = MOVE_OFFSET_DEG[agent.action.move];
  if (offset === null) return agent.pos;
  const d = scale(fromAngle(agent.facing + offset), MOVE_STEP_M);
  const { x, y } = agent.pos;
  const tries = [
    { x: x + d.x, y: y + d.y },
    { x: x + d.x, y },
    { x, y: y + d.y },
  ];
  return tries.find((p) => canStand(p, map)) ?? agent.pos;
}

/** Whether an agent body centered at `p` is inside the arena and clear of every obstacle (touching is clear). */
function canStand(p: Vec2, map: MapSpec): boolean {
  return (
    circleInsideArena(p, AGENT_RADIUS_M, map.width, map.height) &&
    !map.obstacles.some((o) => circleOverlapsPolygon(p, AGENT_RADIUS_M, o.vertices))
  );
}

interface Flight {
  victim: Agent | null; // the body it hit
  stopped: boolean; // hit a body, an obstacle or the arena boundary
  nearMisses: Agent[]; // living non-owners within INCOMING_RADIUS_M of the path it flew
}

/**
 * One tick of a bullet's flight (R4 step 5): its velocity as a segment. The
 * earliest contact wins: an obstacle edge, the arena boundary, or the body of a
 * living agent other than its owner. Ties go to the wall, then to the lower
 * slot. Near misses count only the part of the segment flown before the contact.
 */
function fly(bullet: Bullet, agents: readonly Agent[], map: MapSpec): Flight {
  const p0 = bullet.pos;
  const p1 = add(p0, bullet.vel);
  let wall = segmentLeavesArenaT(p0, p1, map.width, map.height) ?? Infinity;
  for (const { vertices } of map.obstacles) wall = Math.min(wall, segmentPolygonT(p0, p1, vertices) ?? Infinity);
  let contact = wall;
  let victim: Agent | null = null;
  for (const agent of agents) {
    if (!agent.alive || agent.id === bullet.owner) continue;
    const t = segmentCircleT(p0, p1, agent.pos, AGENT_RADIUS_M);
    if (t !== null && t < contact) {
      contact = t;
      victim = agent;
    }
  }
  const end = contact >= 1 ? p1 : add(p0, scale(bullet.vel, contact));
  const nearMisses = agents.filter(
    (a) => a.alive && a.id !== bullet.owner && a !== victim && pointSegmentDistance(a.pos, p0, end) <= INCOMING_RADIUS_M,
  );
  return { victim, stopped: contact <= 1, nearMisses };
}
