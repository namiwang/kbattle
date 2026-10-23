import { describe, expect, it } from "vitest";
import { AGENT_RADIUS_M, DOER_INTERVAL_TICKS, HEAR_SHOT_RANGE_M, MOVE_SPEED_MPS, VISION_CONE_DEG, VISION_RANGE_M } from "../../src/constants";
import { circleInsideArena, circleOverlapsPolygon } from "../../src/sim/collision";
import { perceive } from "../../src/sim/perceive";
import { createRng, nextFloat, type RngState } from "../../src/rng";
import { HEARING_BANDS, type Agent, type Observation, type TickFacts, type WorldState } from "../../src/types";
import { mpsToMetersPerTick } from "../../src/units";
import { dist, fromAngle, scale, add } from "../../src/vec2";
import { arena1, deepFreeze, makeAgent, makeBullet, makeWorld } from "./helpers";

// Property (v1.3 exit criterion): perceive has no non-determinism. 100 seeded
// random states (random positions, facings, HP, deaths, movement, bullets and a
// perception window of shots, hits and near misses over the last
// DOER_INTERVAL_TICKS steps, R15), every agent's view computed twice:
// deep-equal, never NaN, bearings in (−180, 180], ordering per R7, and exactly
// the window's shots in range and the window's fire on the agent.

const STATES = 100;
const MOVE_STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS);

/** A tiny cursor over the sim's RNG for drawing test inputs. */
function drawer(seed: number) {
  let rng: RngState = createRng(seed);
  const float = () => {
    const d = nextFloat(rng);
    rng = d.rng;
    return d.value;
  };
  const int = (n: number) => Math.floor(float() * n);
  return { float, int, pick: <T>(items: readonly T[]): T => items[int(items.length)]! };
}

function randomState(seed: number): WorldState {
  const draw = drawer(seed);
  const tick = draw.int(6001);
  const agents: Agent[] = Array.from({ length: 2 + draw.int(15) }, (_, slot) => {
    let pos = { x: 0, y: 0 };
    do pos = { x: draw.float() * 100, y: draw.float() * 100 };
    while (
      !circleInsideArena(pos, AGENT_RADIUS_M, 100, 100) ||
      arena1.obstacles.some((o) => circleOverlapsPolygon(pos, AGENT_RADIUS_M, o.vertices))
    );
    const alive = draw.float() < 0.85;
    return makeAgent(slot, pos, draw.float() * 360 - 180, {
      alive,
      hp: alive ? 20 * (1 + draw.int(5)) : 0,
      deathTick: alive ? null : draw.int(tick + 1),
      kills: draw.int(4),
      moved: alive && draw.float() < 0.5,
    });
  });
  const anyone = () => draw.pick(agents);
  // The window: one entry per step, oldest first, min(tick, DOER_INTERVAL_TICKS) of them. About
  // a third of the agents fired once in it, standing within walking reach of where they are now;
  // hits and near misses come from anywhere.
  const recent: TickFacts[] = Array.from({ length: Math.min(tick, DOER_INTERVAL_TICKS) }, () => ({ shots: [], hits: [], nearMisses: [] }));
  if (recent.length > 0) {
    for (const a of agents) {
      if (draw.float() >= 0.3) continue;
      const i = draw.int(recent.length);
      const back = scale(fromAngle(draw.float() * 360), draw.float() * (recent.length - 1 - i) * MOVE_STEP_M);
      recent[i]!.shots.push({ agent: a.id, pos: add(a.pos, back) });
    }
    for (let n = draw.int(6); n > 0; n--) draw.pick(recent).hits.push({ target: anyone().id, from: { ...anyone().pos } });
    for (let n = draw.int(6); n > 0; n--) draw.pick(recent).nearMisses.push({ target: anyone().id, from: { ...anyone().pos } });
  }
  const bullets = Array.from({ length: draw.int(6) }, (_, n) =>
    makeBullet(n, anyone().id, { x: draw.float() * 100, y: draw.float() * 100 }, { x: draw.float() * 6 - 3, y: 1 }),
  );
  return { ...makeWorld({ agents, bullets, tick, seed }), recent };
}

/** Every number in the observation, with its path, for the finiteness check. */
function numbers(value: unknown, path = "obs"): [string, number][] {
  if (typeof value === "number") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => numbers(v, `${path}.${k}`));
}

const isBearing = (b: number) => Number.isInteger(b) && b > -180 && b <= 180 && !Object.is(b, -0);
const bandRank = (band: string) => HEARING_BANDS.indexOf(band as (typeof HEARING_BANDS)[number]);

function checkInvariants(state: WorldState, id: string, obs: Observation): void {
  const me = state.agents.find((a) => a.id === id)!;
  for (const [path, n] of numbers(obs)) expect(Number.isFinite(n), `${id} ${path} = ${n}`).toBe(true);
  for (const b of [...obs.visible, ...obs.heard, ...obs.incoming].map((e) => e.bearing)) {
    expect(isBearing(b), `${id} bearing ${b}`).toBe(true);
  }
  // Vision: distinct living others, inside the cone and range, nearest first.
  const ids = obs.visible.map((v) => v.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const v of obs.visible) {
    const other = state.agents.find((a) => a.id === v.id)!;
    expect(other.alive && other.id !== id).toBe(true);
    expect(Math.abs(v.bearing)).toBeLessThanOrEqual(VISION_CONE_DEG / 2);
    expect(Number.isInteger(v.dist) && v.dist >= 0 && v.dist <= VISION_RANGE_M).toBe(true);
    expect(v.moving).toBe(other.moved);
  }
  for (let i = 1; i < obs.visible.length; i++) expect(obs.visible[i]!.dist).toBeGreaterThanOrEqual(obs.visible[i - 1]!.dist);
  // Hearing: shots before steps, each kind nearest band first; never more than there was to hear.
  const kinds = obs.heard.map((h) => h.kind);
  expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === "shot" ? -1 : 1)));
  for (let i = 1; i < obs.heard.length; i++) {
    const [prev, cur] = [obs.heard[i - 1]!, obs.heard[i]!];
    if (prev.kind === cur.kind) expect(bandRank(cur.dist)).toBeGreaterThanOrEqual(bandRank(prev.dist));
  }
  const steps = obs.heard.filter((h) => h.kind === "steps");
  for (const h of steps) expect(h.dist).toBe("near"); // footsteps carry HEAR_STEPS_RANGE_M, inside the near band
  expect(steps.length).toBeLessThanOrEqual(state.agents.filter((a) => a.id !== id && a.alive && a.moved).length);
  // Window (R15): every other agent's shot of the last steps within range, from where it was fired;
  // every hit and near miss on me in them; nothing while dead.
  const shots = state.recent.flatMap((f) => f.shots).filter((s) => s.agent !== id && dist(s.pos, me.pos) <= HEAR_SHOT_RANGE_M);
  expect(obs.heard.length - steps.length).toBe(me.alive ? shots.length : 0);
  const mine = state.recent.flatMap((f) => [...f.hits, ...f.nearMisses]).filter((f) => f.target === id).length;
  expect(obs.incoming).toHaveLength(me.alive ? mine : 0);
  // Self, rounded as the log rounds Tick rows.
  expect(obs.self.hp).toBe(me.hp);
  expect(obs.self.kills).toBe(me.kills);
  expect(Math.abs(obs.self.pos.x - me.pos.x)).toBeLessThanOrEqual(0.005 + 1e-9);
  expect(Math.abs(obs.self.pos.y - me.pos.y)).toBeLessThanOrEqual(0.005 + 1e-9);
  expect(obs.self.facing > -180 && obs.self.facing <= 180).toBe(true);
  expect(obs.self.secondsLeft).toBeGreaterThanOrEqual(0);
}

describe("property: perceive is deterministic and well-formed on 100 random states", () => {
  it("each agent's view, computed twice, is deep-equal and satisfies the R7 invariants", () => {
    let views = 0;
    let seen = 0;
    let heard = 0;
    let incoming = 0;
    for (let seed = 0; seed < STATES; seed++) {
      const state = randomState(seed);
      for (const agent of state.agents) {
        const first = perceive(state, agent.id);
        expect(perceive(state, agent.id), `seed ${seed} ${agent.id}`).toEqual(first);
        checkInvariants(state, agent.id, first);
        views++;
        seen += first.visible.length;
        heard += first.heard.length;
        incoming += first.incoming.length;
      }
    }
    // The random states really exercised every part of perception.
    expect(views).toBeGreaterThan(500);
    expect(seen).toBeGreaterThan(100);
    expect(heard).toBeGreaterThan(300);
    expect(incoming).toBeGreaterThan(50);
  });

  it("a deeply frozen copy gives the same views, and the state is left unchanged", () => {
    for (let seed = 0; seed < STATES; seed += 10) {
      const state = randomState(seed);
      const frozen = deepFreeze(structuredClone(state));
      for (const agent of state.agents) expect(perceive(frozen, agent.id)).toEqual(perceive(state, agent.id));
      expect(frozen).toEqual(state);
    }
  });
});
