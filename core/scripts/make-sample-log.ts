// Writes core/fixtures/sample-log.json and the negative fixtures in
// core/fixtures/bad/. Deterministic: a rerun rewrites the same bytes.
//
//   pnpm --filter core exec tsx scripts/make-sample-log.ts
//
// The sample is a scripted fight on arena-1, not a sim run (the sim is P1):
// straight-line motion at the constants' speeds, scripted doer answers for a0,
// a scripted wanderer for a1, and hits found by plain geometry. It gives the
// replay viewer and the mind panel every event kind to draw (DESIGN.md §5.3).
//
// Event order inside a tick (the v1.5 writer may choose differently):
// Thinker results landing this tick, Doer calls due this tick, Shot, Hit,
// Death, Tick (positions after the step), MatchEnd.

import { mkdirSync, writeFileSync } from "node:fs";
import { headingTo, normalizeDeg, turnToward } from "../src/angles";
import {
  AGENT_HP,
  AGENT_RADIUS_M,
  BULLET_DAMAGE,
  BULLET_SPEED_MPS,
  DOER_INTERVAL_TICKS,
  DOER_TIMEOUT_MS,
  ESCALATE_THRESHOLD,
  FIRE_INTERVAL_TICKS,
  FIRE_THRESHOLD,
  MOVE_SPEED_MPS,
  TURN_RATE_DPS,
  VISION_CONE_DEG,
  VISION_RANGE_M,
} from "../src/constants";
import { getMap } from "../src/maps";
import { MatchLogSchema, type DoerAnswers, type Event, type MatchLog, type Plan } from "../src/schemas";
import { MOVE_CHOICES, TURN_CHOICES, type Action, type Agent, type Bullet, type MoveChoice, type TurnChoice } from "../src/types";
import { dpsToDegreesPerTick, mpsToMetersPerTick } from "../src/units";
import { add, dist, fromAngle, scale, sub, type Vec2 } from "../src/vec2";

const MAP = getMap("arena-1");
const STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS);
const BULLET_STEP_M = mpsToMetersPerTick(BULLET_SPEED_MPS);
const TURN_STEP_DEG = dpsToDegreesPerTick(TURN_RATE_DPS);

const config: MatchLog["config"] = {
  mapId: MAP.id,
  seed: 1,
  durationTicks: 200,
  slots: [{ kind: "prompted" }, { kind: "bot", bot: "wanderer" }],
};

const prompts: MatchLog["prompts"] = {
  thinkerSystem:
    "You are a patient fighter. Keep to open lanes, engage at long range, and never chase a target behind cover.",
  doerInstructions: {
    move: "Follow the plan. Stop once you are at the range it names.",
    turn: "Face the target when you have one; otherwise keep your facing.",
    fire: "Fire when the target is close to the center of your view.",
    target: "Pick the closest visible enemy.",
  },
};

// ---- a0's scripted doer answers, by decision tick ----

interface DoerRow {
  move: [MoveChoice, number];
  turn: [TurnChoice, number];
  fire: number;
  target?: number; // P(pick the visible enemy); present exactly when one is visible (I-005)
  escalate: number;
}

const WALK: DoerRow = { move: ["forward", 0.9], turn: ["none", 0.85], fire: 0.02, escalate: 0.06 };
const A0_DOER: Record<number, DoerRow | "timeout"> = {
  1: { move: ["forward", 0.86], turn: ["none", 0.82], fire: 0.03, escalate: 0.91 }, // no plan yet
  11: WALK,
  21: WALK,
  31: { ...WALK, escalate: 0.08 },
  41: "timeout",
  51: { ...WALK, move: ["forward", 0.88] },
  61: { ...WALK, turn: ["none", 0.8], fire: 0.04 },
  71: { move: ["forward", 0.58], turn: ["face_target", 0.66], fire: 0.34, target: 0.94, escalate: 0.84 }, // contact
  81: { move: ["forward", 0.52], turn: ["face_target", 0.7], fire: 0.72, target: 0.95, escalate: 0.12 },
  91: { move: ["stop", 0.74], turn: ["face_target", 0.71], fire: 0.86, target: 0.96, escalate: 0.08 },
  101: { move: ["stop", 0.8], turn: ["face_target", 0.77], fire: 0.9, target: 0.96, escalate: 0.05 },
  111: { move: ["stop", 0.78], turn: ["face_target", 0.76], fire: 0.91, target: 0.96, escalate: 0.05 },
  121: { move: ["left", 0.62], turn: ["face_target", 0.73], fire: 0.81, target: 0.95, escalate: 0.22 }, // was hit
  131: { move: ["stop", 0.7], turn: ["face_target", 0.75], fire: 0.88, target: 0.96, escalate: 0.09 },
  141: { move: ["stop", 0.72], turn: ["face_target", 0.74], fire: 0.9, target: 0.97, escalate: 0.07 },
};

const FIRST_PLAN: Plan = {
  text:
    "Walk the middle lane east. Stop about 45 m from the first enemy you see and shoot while it is centered. " +
    "If you are hit, strafe left one step, then hold and keep shooting.",
  scratchpad: "Spawned on the west edge, middle lane. Nothing seen yet.",
};

// Thinker calls by requested tick: when the result lands, and what it is.
const A0_THINKER: Record<number, { tick: number; input: unknown } & ({ plan: Plan } | { error: string })> = {
  1: {
    tick: 7,
    input: { reason: "escalate", digest: "Match start: nothing seen, heard or taken yet.", scratchpad: "" },
    plan: FIRST_PLAN,
  },
  71: {
    tick: 78,
    input: { reason: "escalate", digest: "a1 seen dead ahead at 57 m, closing.", scratchpad: FIRST_PLAN.scratchpad },
    error: "refusal (stop_reason: refusal)",
  },
};

// Aim error per shot in degrees, in firing order: small ones hit, large ones miss.
const SHOT_OFFSETS_DEG: Record<string, number[]> = {
  a0: [2.4, 0.3, -0.2, 0.1, 0.3, 0.2, -0.1],
  a1: [-2.6, 2.2, -1.8, 0.2, -2.3, 1.9, -2.0, 2.5],
};

// ---- the scripted match ----

function round(value: number, digits: number): number {
  const k = 10 ** digits;
  const r = Math.round(value * k) / k;
  return r === 0 ? 0 : r; // no -0
}

function choiceAnswer<T extends string>(options: readonly T[], [pick, p]: [T, number]) {
  const rest = round((1 - p) / (options.length - 1), 3);
  const probabilities = Object.fromEntries(options.map((o) => [o, o === pick ? p : rest]));
  return { type: "choice" as const, choice: pick, probabilities, confidence: p };
}

function sees(self: Agent, other: Agent): boolean {
  const d = dist(self.pos, other.pos);
  const bearing = normalizeDeg(headingTo(self.pos, other.pos) - self.facing);
  return other.alive && d <= VISION_RANGE_M && Math.abs(bearing) <= VISION_CONE_DEG / 2;
}

/** Distance from point p to the segment a→b. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2)));
  return dist(p, add(a, scale(ab, t)));
}

function inObstacleBox(p: Vec2): boolean {
  return MAP.obstacles.some(({ vertices }) => {
    const xs = vertices.map((v) => v.x);
    const ys = vertices.map((v) => v.y);
    return p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.y >= Math.min(...ys) && p.y <= Math.max(...ys);
  });
}

function insideArena(p: Vec2): boolean {
  return p.x >= 0 && p.x <= MAP.width && p.y >= 0 && p.y <= MAP.height;
}

function spawnAgent(id: string, slot: number, spawn: Vec2): Agent {
  const center = { x: MAP.width / 2, y: MAP.height / 2 };
  return {
    id,
    slot,
    pos: { ...spawn },
    facing: headingTo(spawn, center),
    hp: AGENT_HP,
    alive: true,
    kills: 0,
    cooldownTicks: 0,
    action: { move: "stop", turn: "none", fire: false, target: null },
    moved: false,
  };
}

function buildSampleLog(): MatchLog {
  const west = MAP.spawns.find((s) => s.x === 4 && s.y === 50);
  const east = MAP.spawns.find((s) => s.x === 96 && s.y === 50);
  if (!west || !east) throw new Error("arena-1 lost its middle-lane spawns");
  const a0 = spawnAgent("a0", 0, west);
  const a1 = spawnAgent("a1", 1, east);
  const agents = [a0, a1];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const bullets: Bullet[] = [];
  const shotsFired: Record<string, number> = { a0: 0, a1: 0 };
  let nextBullet = 0;
  const events: Event[] = [];

  const tickEvent = (tick: number): Event => ({
    kind: "Tick",
    tick,
    agents: agents
      .filter((a) => a.alive)
      .map((a) => [a.id, round(a.pos.x, 2), round(a.pos.y, 2), normalizeDeg(round(a.facing, 1)), a.hp]),
    bullets: bullets.map((b) => [b.id, round(b.pos.x, 2), round(b.pos.y, 2)]),
  });

  for (const a of agents) {
    events.push({ kind: "Spawn", tick: 0, agent: a.id, pos: { ...a.pos }, facing: round(a.facing, 1) });
  }
  events.push(tickEvent(0));

  for (let tick = 1; tick <= config.durationTicks; tick++) {
    // Thinker results land at the start of the tick.
    for (const [requested, call] of Object.entries(A0_THINKER)) {
      if (call.tick !== tick) continue;
      const outcome = "plan" in call ? { ok: true, plan: call.plan } : { ok: false, error: call.error };
      events.push({ kind: "Thinker", tick, requestedTick: Number(requested), agent: "a0", input: call.input, ...outcome });
    }

    // Doer cadence: every DOER_INTERVAL_TICKS from tick 1 (§5.4); bots on the same cadence (row 33).
    if ((tick - 1) % DOER_INTERVAL_TICKS === 0) {
      if (a0.alive) decideA0(tick);
      if (a1.alive) a1.action = wanderer(a1, a0);
    }

    // Step: turn, then move along the new facing.
    for (const a of agents.filter((x) => x.alive)) {
      const target = a.action.target ? byId.get(a.action.target) : undefined;
      if (a.action.turn === "face_target" && target?.alive) {
        a.facing = turnToward(a.facing, headingTo(a.pos, target.pos), TURN_STEP_DEG);
      } else if (a.action.turn === "left" || a.action.turn === "right") {
        a.facing = normalizeDeg(a.facing + (a.action.turn === "left" ? -TURN_STEP_DEG : TURN_STEP_DEG));
      }
      const relative = { forward: 0, right: 90, back: 180, left: -90, stop: null }[a.action.move];
      a.moved = relative !== null;
      if (relative !== null) a.pos = add(a.pos, scale(fromAngle(a.facing + relative), STEP_M));
      if (!insideArena(a.pos) || inObstacleBox(a.pos)) throw new Error(`${a.id} left the open lane at tick ${tick}`);
    }

    // Fire.
    for (const a of agents.filter((x) => x.alive)) {
      if (a.cooldownTicks > 0) a.cooldownTicks--;
      if (!a.action.fire || a.cooldownTicks > 0) continue;
      const fired = shotsFired[a.id] ?? 0;
      shotsFired[a.id] = fired + 1;
      const offset = SHOT_OFFSETS_DEG[a.id]?.[fired];
      if (offset === undefined) throw new Error(`no scripted aim for ${a.id}'s shot at tick ${tick}`);
      const direction = fromAngle(a.facing + offset);
      const id = `b${nextBullet++}`;
      bullets.push({
        id,
        owner: a.id,
        pos: add(a.pos, scale(direction, AGENT_RADIUS_M)),
        vel: scale(direction, BULLET_STEP_M),
        spawnTick: tick,
      });
      a.cooldownTicks = FIRE_INTERVAL_TICKS;
      events.push({ kind: "Shot", tick, agent: a.id, bullet: id });
    }

    // Bullets fly; a hit or the arena wall removes them.
    for (const b of [...bullets]) {
      const next = add(b.pos, b.vel);
      const victim = agents.find((a) => a.alive && a.id !== b.owner && segmentDistance(a.pos, b.pos, next) <= AGENT_RADIUS_M);
      if (victim) {
        bullets.splice(bullets.indexOf(b), 1);
        victim.hp -= BULLET_DAMAGE;
        events.push({ kind: "Hit", tick, bullet: b.id, target: victim.id, damage: BULLET_DAMAGE });
        if (victim.hp <= 0) {
          victim.alive = false;
          const killer = byId.get(b.owner);
          if (killer) killer.kills++;
          events.push({ kind: "Death", tick, agent: victim.id, killer: b.owner });
        }
      } else if (!insideArena(next)) {
        bullets.splice(bullets.indexOf(b), 1);
      } else {
        if (inObstacleBox(next)) throw new Error(`${b.id} reached an obstacle at tick ${tick}`);
        b.pos = next;
      }
    }

    events.push(tickEvent(tick));

    const alive = agents.filter((a) => a.alive);
    if (alive.length <= 1) {
      const dead = events.flatMap((e) => (e.kind === "Death" ? [e.agent] : [])).reverse();
      events.push({ kind: "MatchEnd", tick, ranking: [...alive.map((a) => a.id), ...dead] });
      return MatchLogSchema.parse({ version: 1, config, seed: config.seed, prompts, events });
    }
  }
  throw new Error("the scripted fight must end by elimination before durationTicks");

  function decideA0(tick: number): void {
    const row = A0_DOER[tick];
    if (row === undefined) throw new Error(`no scripted doer answer for a0 at tick ${tick}`);
    if (row === "timeout") {
      events.push({ kind: "Doer", tick, agent: "a0", ok: false, error: `timeout: no answer within ${DOER_TIMEOUT_MS} ms` });
      return; // keep the last answer (§5.5)
    }
    const visible = sees(a0, a1);
    if (visible !== (row.target !== undefined)) throw new Error(`a0's target answer at tick ${tick} disagrees with what it sees`);
    const answers: DoerAnswers = {
      move: choiceAnswer(MOVE_CHOICES, row.move),
      turn: choiceAnswer(TURN_CHOICES, row.turn),
      fire: { type: "noul", noul: row.fire },
      ...(row.target === undefined ? {} : { target: choiceAnswer(["a1", "none"], ["a1", row.target]) }),
      escalate: { type: "noul", noul: row.escalate },
    };
    events.push({ kind: "Doer", tick, agent: "a0", ok: true, answers });
    const target = answers.target?.choice === "a1" ? "a1" : null;
    const turn = row.turn[0] === "face_target" && target === null ? "none" : row.turn[0];
    a0.action = { move: row.move[0], turn, fire: row.fire >= FIRE_THRESHOLD, target } satisfies Action;
    const escalates = row.escalate >= ESCALATE_THRESHOLD;
    if (escalates !== (tick in A0_THINKER)) throw new Error(`a0's escalation at tick ${tick} disagrees with the thinker script`);
  }
}

/** The wanderer bot, scripted: walk the way it faces; face and shoot anything it sees. */
function wanderer(self: Agent, enemy: Agent): Action {
  return sees(self, enemy)
    ? { move: "forward", turn: "face_target", fire: true, target: enemy.id }
    : { move: "forward", turn: "none", fire: false, target: null };
}

// ---- negative fixtures: a valid minimal log, one defect each ----

function buildBadFixtures(): Record<string, unknown> {
  const doerAnswers: DoerAnswers = {
    move: choiceAnswer(MOVE_CHOICES, ["forward", 0.9]),
    turn: choiceAnswer(TURN_CHOICES, ["none", 0.85]),
    fire: { type: "noul", noul: 0.02 },
    escalate: { type: "noul", noul: 0.06 },
  };
  const base = (): MatchLog => ({
    version: 1,
    config: structuredClone(config),
    seed: config.seed,
    prompts: structuredClone(prompts),
    events: [
      { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
      { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 96, y: 50 }, facing: 180 },
      { kind: "Tick", tick: 0, agents: [["a0", 4, 50, 0, 100], ["a1", 96, 50, 180, 100]], bullets: [] },
      { kind: "Doer", tick: 1, agent: "a0", ok: true, answers: structuredClone(doerAnswers) },
      { kind: "Tick", tick: 1, agents: [["a0", 4.25, 50, 0, 100], ["a1", 95.75, 50, 180, 100]], bullets: [] },
    ],
  });
  MatchLogSchema.parse(base()); // the base must be valid, so each file has exactly one defect

  const unknownKind: unknown[] = [...base().events, { kind: "Teleport", tick: 1, agent: "a0", pos: { x: 50, y: 50 } }];
  const highProbability = base();
  const doer = highProbability.events[3];
  if (doer?.kind !== "Doer" || !doer.answers?.move) throw new Error("base log changed shape");
  doer.answers.move.probabilities.forward = 1.2;
  const noAnswers = base();
  const answered = noAnswers.events[3];
  if (answered?.kind !== "Doer") throw new Error("base log changed shape");
  delete answered.answers;

  return {
    "wrong-version.json": { ...base(), version: 2 },
    "unknown-event-kind.json": { ...base(), events: unknownKind },
    "probability-above-1.json": highProbability,
    "seed-mismatch.json": { ...base(), seed: 2 },
    "one-slot.json": { ...base(), config: { ...config, slots: [{ kind: "prompted" }] } },
    "doer-ok-without-answers.json": noAnswers,
  };
}

// ---- write ----

/** Header fields pretty, one event per line: readable, diffable, small. */
function formatLog(log: MatchLog): string {
  const nested = (value: unknown) => JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
  const head = [
    `  "version": ${JSON.stringify(log.version)}`,
    `  "config": ${nested(log.config)}`,
    `  "seed": ${JSON.stringify(log.seed)}`,
    `  "prompts": ${nested(log.prompts)}`,
  ];
  const events = log.events.map((e) => `    ${JSON.stringify(e)}`).join(",\n");
  return `{\n${head.join(",\n")},\n  "events": [\n${events}\n  ]\n}\n`;
}

const fixtures = new URL("../fixtures/", import.meta.url);
const sample = buildSampleLog();
mkdirSync(new URL("bad/", fixtures), { recursive: true });
writeFileSync(new URL("sample-log.json", fixtures), formatLog(sample));
for (const [name, value] of Object.entries(buildBadFixtures())) {
  writeFileSync(new URL(`bad/${name}`, fixtures), `${JSON.stringify(value, null, 2)}\n`);
}

const counts: Record<string, number> = {};
for (const e of sample.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log(`sample-log.json: ${sample.events.length} events ${JSON.stringify(counts)}`);
for (const e of sample.events) {
  if (e.kind === "Hit" || e.kind === "Death" || e.kind === "MatchEnd") console.log(`  ${JSON.stringify(e)}`);
}
