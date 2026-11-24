// The battle royale's sim: the world at tick 0, and one tick of it. Pure: no clock, no Math.random, and the
// state passed in is never changed (parts that did not change may be shared with the new one).

import { createRng, nextFloat } from "../../core/numbers.ts";
import type { Config } from "../../core/types.ts";
import {
  AGENT_HP,
  AGENT_RADIUS_M,
  BULLET_DAMAGE,
  BULLET_STEP_M,
  DECISION_TICKS,
  FIRE_INTERVAL_TICKS,
  INCOMING_RADIUS_M,
  MOVE_STEP_M,
  MUZZLE_OFFSET_M,
  SPREAD_DEG,
  TURN_STEP_DEG,
  VISION_RANGE_M,
} from "./constants.ts";
import {
  add,
  circleInsideMap,
  circleOverlapsPolygon,
  dist,
  fromAngle,
  hasLineOfSight,
  headingTo,
  normalizeDeg,
  pointSegmentDistance,
  scale,
  segmentCircleT,
  segmentLeavesMapT,
  segmentPolygonT,
  turnToward,
  type Vec2,
} from "./geometry.ts";
import { getMap, type MapSpec } from "./maps.ts";
import { perceive } from "./perceive.ts";
import type { Action, Fighter, Bullet, Move, TickFacts, Turn, WorldState } from "./types.ts";

/** The world at tick 0: agents on the map's spawns in a seeded shuffle, facing the center, standing still. */
export function spawn(config: Config, ids: string[]): WorldState {
  const map = getMap(config.map);
  let rng = createRng(config.seed);
  const spawns = [...map.spawns];
  for (let i = spawns.length - 1; i > 0; i--) {
    const draw = nextFloat(rng);
    rng = draw.rng;
    const j = Math.floor(draw.value * (i + 1));
    [spawns[i], spawns[j]] = [spawns[j]!, spawns[i]!];
  }
  const center = { x: map.width / 2, y: map.height / 2 };
  const agents = ids.map((id, i): Fighter => {
    const pos = { ...spawns[i]! };
    return {
      id,
      pos,
      facing: headingTo(pos, center),
      hp: AGENT_HP,
      alive: true,
      deathTick: null,
      kills: 0,
      cooldownTicks: 0,
      action: { move: "stop", turn: "none", fire: false, target: null },
      moved: false,
    };
  });
  return { tick: 0, map, agents, bullets: [], nextBulletId: 0, rng, recent: [] };
}

/** Each move as an angle from the facing; stop does not move. */
const MOVE_OFFSET_DEG: Record<Move, number | null> = { forward: 0, right: 90, back: 180, left: -90, stop: null };
const TURNS: readonly string[] = ["left", "right", "none", "face_target"] satisfies Turn[];

/**
 * One tick, each phase for every agent before the next: answers become actions, weapons cool down, agents
 * turn, move, then fire, and every bullet flies. A bullet flies in the tick it is fired, so a point-blank
 * shot hits at once. Agents do not collide with each other.
 */
export function step(state: WorldState, answers: Record<string, Record<string, string>>): WorldState {
  const tick = state.tick + 1;
  const facts: TickFacts = { shots: [], hits: [], nearMisses: [] };

  // Fresh copies of every agent: the phases below write only to these.
  const agents = state.agents.map((agent): Fighter => {
    const given = Object.hasOwn(answers, agent.id) ? answers[agent.id] : undefined;
    return { ...agent, pos: { ...agent.pos }, action: given ? answered(state, agent, given) : agent.action, moved: false };
  });
  const byId = new Map(agents.map((a) => [a.id, a]));

  for (const agent of agents) if (agent.alive && agent.cooldownTicks > 0) agent.cooldownTicks -= 1;

  // Turn, against positions at the start of the tick: nobody has moved yet.
  for (const agent of agents) if (agent.alive) agent.facing = turned(agent, byId, state.map);

  // Move along the new facing.
  for (const agent of agents) {
    if (!agent.alive) continue;
    const to = destination(agent, state.map);
    agent.moved = to.x !== agent.pos.x || to.y !== agent.pos.y;
    agent.pos = to;
  }

  // Fire, in list order: one spread draw per shot, uniform in [-SPREAD_DEG, +SPREAD_DEG).
  let rng = state.rng;
  let nextBulletId = state.nextBulletId;
  const fired: Bullet[] = [];
  for (const agent of agents) {
    if (!agent.alive || !agent.action.fire || agent.cooldownTicks > 0) continue;
    const draw = nextFloat(rng);
    rng = draw.rng;
    fired.push({
      id: `b${nextBulletId++}`,
      owner: agent.id,
      pos: add(agent.pos, scale(fromAngle(agent.facing), MUZZLE_OFFSET_M)),
      vel: scale(fromAngle(agent.facing + (2 * draw.value - 1) * SPREAD_DEG), BULLET_STEP_M),
      spawnTick: tick,
    });
    agent.cooldownTicks = FIRE_INTERVAL_TICKS;
    facts.shots.push({ agent: agent.id, pos: { ...agent.pos } });
  }

  // Bullets fly, oldest first, the ones just fired included. A body killed earlier in this tick stops nothing.
  const bullets: Bullet[] = [];
  for (const bullet of [...state.bullets, ...fired]) {
    const flight = fly(bullet, agents, state.map);
    const shooter = byId.get(bullet.owner);
    // Incoming fire is felt from where the shooter stands now (the bullet, if its owner is not in this world).
    const from = () => ({ ...(shooter ? shooter.pos : bullet.pos) });
    for (const target of flight.nearMisses) facts.nearMisses.push({ target: target.id, from: from() });
    if (flight.victim) {
      const victim = flight.victim;
      victim.hp = Math.max(0, victim.hp - BULLET_DAMAGE);
      facts.hits.push({ target: victim.id, from: from() });
      if (victim.hp <= 0) {
        victim.alive = false;
        victim.deathTick = tick;
        if (shooter) shooter.kills += 1; // even if the shooter has died since
      }
    } else if (!flight.stopped) {
      bullets.push({ ...bullet, pos: add(bullet.pos, bullet.vel) });
    }
  }

  const recent = [...state.recent, facts].slice(-DECISION_TICKS);
  return { ...state, tick, agents, bullets, nextBulletId, rng, recent };
}

/** The agent's action after its answers: each valid answer replaces its part, a missing one keeps it. */
function answered(state: WorldState, agent: Fighter, answers: Record<string, string>): Action {
  const action = { ...agent.action };
  const { move, turn, fire } = answers;
  if (move !== undefined && Object.hasOwn(MOVE_OFFSET_DEG, move)) action.move = move as Move;
  if (turn !== undefined && TURNS.includes(turn)) {
    // face_target is aimed once, as the answer lands: at the nearest enemy the agent sees, or nowhere.
    action.target = turn === "face_target" ? (perceive(state, agent.id).visible[0]?.id ?? null) : null;
    action.turn = turn === "face_target" && action.target === null ? "none" : (turn as Turn);
  }
  if (fire === "yes" || fire === "no") action.fire = fire === "yes";
  return action;
}

/**
 * The facing after this tick's turn. face_target follows its target while that is another living agent
 * within VISION_RANGE_M in line of sight (the cone is not required: it turns to bring the target into view).
 */
function turned(agent: Fighter, byId: ReadonlyMap<string, Fighter>, map: MapSpec): number {
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
 * Where the agent's move takes it: one whole step, or if its body would overlap an obstacle or leave the
 * map there, the x part alone, then the y part alone, else nowhere. Touching a wall is allowed.
 */
function destination(agent: Fighter, map: MapSpec): Vec2 {
  const offset = MOVE_OFFSET_DEG[agent.action.move];
  if (offset === null) return agent.pos;
  const d = scale(fromAngle(agent.facing + offset), MOVE_STEP_M);
  const { x, y } = agent.pos;
  const tries = [
    { x: x + d.x, y: y + d.y },
    { x: x + d.x, y },
    { x, y: y + d.y },
  ];
  const fits = (p: Vec2) =>
    circleInsideMap(p, AGENT_RADIUS_M, map.width, map.height) && !map.obstacles.some((o) => circleOverlapsPolygon(p, AGENT_RADIUS_M, o.vertices));
  return tries.find(fits) ?? agent.pos;
}

/**
 * One tick of a bullet's flight, as a segment. The earliest contact stops it: an obstacle edge, the map's
 * edge, or the body of a living agent other than its owner; on a tie the wall, then the earlier agent in
 * list order. A near miss is a living agent, not the owner or the victim, within INCOMING_RADIUS_M of the
 * part of the segment actually flown.
 */
function fly(bullet: Bullet, agents: readonly Fighter[], map: MapSpec): { victim: Fighter | null; stopped: boolean; nearMisses: Fighter[] } {
  const p0 = bullet.pos;
  const p1 = add(p0, bullet.vel);
  let wall = segmentLeavesMapT(p0, p1, map.width, map.height) ?? Infinity;
  for (const { vertices } of map.obstacles) wall = Math.min(wall, segmentPolygonT(p0, p1, vertices) ?? Infinity);
  let contact = wall;
  let victim: Fighter | null = null;
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
