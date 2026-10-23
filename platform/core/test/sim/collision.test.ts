import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_HP, BULLET_DAMAGE, DOER_INTERVAL_TICKS, INCOMING_RADIUS_M } from "../../src/constants";
import { step, type StepEvent } from "../../src/sim/step";
import type { Action, Agent, TickFacts, WorldState } from "../../src/types";
import {
  circleInsideArena,
  circleOverlapsPolygon,
  hasLineOfSight,
  pointInPolygon,
  pointPolygonDistance,
  pointSegmentDistance,
  segmentCircleT,
  segmentLeavesArenaT,
  segmentPolygonT,
  segmentSegmentT,
  segmentsIntersect,
} from "../../src/sim/collision";
import { bulletWallGolden, GOLDEN_DIR } from "./golden-scenarios";
import { map1, makeAgent, makeBullet, makeWorld } from "./helpers";

// Geometry under the sim (R4, R5, R7). Segments are p0 → p1 with t in [0, 1].

/** The facts of the step that produced `state`: the newest entry of its perception window (R6, R15). */
const newest = (state: WorldState): TickFacts | undefined => state.recent.at(-1);

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
// A "C" open to +x: the notch (4..10, 4..6) is outside.
const cShape = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 6 },
  { x: 10, y: 6 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const o = { x: 0, y: 0 };
const east = { x: 10, y: 0 };

describe("segmentSegmentT: where p0 → p1 meets an edge", () => {
  it("returns t along the moving segment", () => {
    expect(segmentSegmentT(o, east, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(0.5);
    expect(segmentSegmentT(o, east, { x: 2.5, y: 5 }, { x: 2.5, y: -5 })).toBe(0.25);
  });

  it("counts touching an end of either segment", () => {
    expect(segmentSegmentT(o, east, { x: 10, y: -1 }, { x: 10, y: 1 })).toBe(1);
    expect(segmentSegmentT(o, east, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(0.5);
  });

  it("is null when they do not meet", () => {
    expect(segmentSegmentT(o, east, { x: 15, y: -5 }, { x: 15, y: 5 })).toBeNull(); // past the end
    expect(segmentSegmentT(o, east, { x: 5, y: 1 }, { x: 5, y: 5 })).toBeNull(); // edge stops short
    expect(segmentSegmentT(o, east, { x: -5, y: -5 }, { x: -5, y: 5 })).toBeNull(); // behind the start
  });

  it("is null for parallel and collinear edges (the next edge's vertex catches a graze)", () => {
    expect(segmentSegmentT(o, east, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(segmentSegmentT(o, east, { x: 2, y: 0 }, { x: 8, y: 0 })).toBeNull();
  });
});

describe("segmentCircleT: first contact with a circle", () => {
  const c = { x: 5, y: 0 };

  it("returns t where the segment enters the circle", () => {
    expect(segmentCircleT(o, east, c, 1)).toBeCloseTo(0.4, 12);
    expect(segmentCircleT({ x: 0, y: 0.6 }, { x: 10, y: 0.6 }, c, 1)).toBeCloseTo(0.42, 12); // chord at 0.6
  });

  it("is 0 when the segment starts inside or on the circle", () => {
    expect(segmentCircleT({ x: 4.5, y: 0 }, east, c, 1)).toBe(0);
    expect(segmentCircleT({ x: 4, y: 0 }, east, c, 1)).toBe(0);
  });

  it("counts a tangent touch", () => {
    expect(segmentCircleT({ x: 0, y: 1 }, { x: 10, y: 1 }, c, 1)).toBe(0.5);
  });

  it("is null when the circle is missed, behind the start, or past the end", () => {
    expect(segmentCircleT({ x: 0, y: 1.5 }, { x: 10, y: 1.5 }, c, 1)).toBeNull();
    expect(segmentCircleT({ x: 7, y: 0 }, { x: 17, y: 0 }, c, 1)).toBeNull();
    expect(segmentCircleT(o, { x: 3.5, y: 0 }, c, 1)).toBeNull();
  });

  it("handles a zero-length segment", () => {
    expect(segmentCircleT(c, c, c, 1)).toBe(0);
    expect(segmentCircleT(o, o, c, 1)).toBeNull();
  });
});

describe("pointInPolygon (even-odd rule)", () => {
  it("convex polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 11 }, square)).toBe(false);
  });

  it("concave polygon: the notch is outside", () => {
    expect(pointInPolygon({ x: 2, y: 5 }, cShape)).toBe(true);
    expect(pointInPolygon({ x: 7, y: 5 }, cShape)).toBe(false);
    expect(pointInPolygon({ x: 7, y: 2 }, cShape)).toBe(true);
  });

  it("map-1's west triangle", () => {
    const triangle = map1.obstacles[1]!.vertices; // (18,30) (30,36) (18,42)
    expect(pointInPolygon({ x: 20, y: 36 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 29, y: 33 }, triangle)).toBe(false);
  });
});

describe("pointSegmentDistance", () => {
  it("is the perpendicular distance inside the segment, else the distance to the nearer end", () => {
    expect(pointSegmentDistance({ x: 5, y: 3 }, o, east)).toBe(3);
    expect(pointSegmentDistance({ x: -3, y: 4 }, o, east)).toBe(5);
    expect(pointSegmentDistance({ x: 13, y: -4 }, o, east)).toBe(5);
    expect(pointSegmentDistance({ x: 3, y: 4 }, o, o)).toBe(5);
  });
});

describe("circleOverlapsPolygon: an agent body against an obstacle", () => {
  it("overlaps when the center is inside or an edge is closer than the radius", () => {
    expect(circleOverlapsPolygon({ x: 5, y: 5 }, 0.1, square)).toBe(true);
    expect(circleOverlapsPolygon({ x: 5, y: 5 }, 100, square)).toBe(true);
    expect(circleOverlapsPolygon({ x: 10.4, y: 5 }, 0.5, square)).toBe(true);
    expect(circleOverlapsPolygon({ x: 10.3, y: 10.3 }, 0.5, square)).toBe(true); // corner at 0.42
  });

  it("does not overlap when apart or only touching", () => {
    expect(circleOverlapsPolygon({ x: 11, y: 5 }, 0.5, square)).toBe(false);
    expect(circleOverlapsPolygon({ x: 10.5, y: 5 }, 0.5, square)).toBe(false);
    expect(circleOverlapsPolygon({ x: 10.4, y: 10.4 }, 0.5, square)).toBe(false); // corner at 0.57
    expect(circleOverlapsPolygon({ x: 7, y: 5 }, 0.5, cShape)).toBe(false); // in the notch
  });
});

describe("segmentPolygonT: where a bullet path first enters an obstacle", () => {
  it("returns the earliest edge crossing", () => {
    expect(segmentPolygonT({ x: -5, y: 5 }, { x: 5, y: 5 }, square)).toBe(0.5);
    expect(segmentPolygonT({ x: -5, y: 5 }, { x: 15, y: 5 }, square)).toBe(0.25);
    expect(segmentPolygonT({ x: 15, y: 5 }, { x: -5, y: 5 }, square)).toBe(0.25);
  });

  it("is 0 when the path starts inside", () => {
    expect(segmentPolygonT({ x: 5, y: 5 }, { x: 6, y: 5 }, square)).toBe(0);
  });

  it("is null when the path misses, including through a concave notch", () => {
    expect(segmentPolygonT({ x: -5, y: 11 }, { x: 15, y: 11 }, square)).toBeNull();
    expect(segmentPolygonT({ x: 15, y: 5 }, { x: 5, y: 5 }, cShape)).toBeNull();
  });
});

describe("the arena box", () => {
  it("segmentLeavesArenaT: where a path crosses the boundary, 0 if it starts outside", () => {
    expect(segmentLeavesArenaT({ x: 50, y: 50 }, { x: 60, y: 50 }, 100, 100)).toBeNull();
    expect(segmentLeavesArenaT({ x: 95, y: 50 }, { x: 105, y: 50 }, 100, 100)).toBe(0.5);
    expect(segmentLeavesArenaT({ x: 2, y: 50 }, { x: -2, y: 50 }, 100, 100)).toBe(0.5);
    expect(segmentLeavesArenaT({ x: 50, y: 1 }, { x: 50, y: -3 }, 100, 100)).toBe(0.25);
    expect(segmentLeavesArenaT({ x: 98, y: 98 }, { x: 102, y: 101 }, 100, 100)).toBe(0.5); // x first
    expect(segmentLeavesArenaT({ x: -1, y: 50 }, { x: 5, y: 50 }, 100, 100)).toBe(0);
    expect(segmentLeavesArenaT({ x: 97, y: 50 }, { x: 100, y: 50 }, 100, 100)).toBeNull(); // the edge is inside
  });

  it("circleInsideArena: the whole body inside, touching a wall allowed", () => {
    expect(circleInsideArena({ x: 0.5, y: 50 }, 0.5, 100, 100)).toBe(true);
    expect(circleInsideArena({ x: 99.5, y: 99.5 }, 0.5, 100, 100)).toBe(true);
    expect(circleInsideArena({ x: 0.49, y: 50 }, 0.5, 100, 100)).toBe(false);
    expect(circleInsideArena({ x: 50, y: 99.6 }, 0.5, 100, 100)).toBe(false);
  });
});

describe("hasLineOfSight: the center-to-center segment misses every obstacle edge (R7)", () => {
  it("map-1", () => {
    expect(hasLineOfSight({ x: 35, y: 24 }, { x: 65, y: 24 }, map1.obstacles)).toBe(false); // north block
    expect(hasLineOfSight({ x: 35, y: 10 }, { x: 65, y: 10 }, map1.obstacles)).toBe(true);
    expect(hasLineOfSight({ x: 10, y: 50 }, { x: 90, y: 50 }, map1.obstacles)).toBe(true); // middle lane
    expect(hasLineOfSight({ x: 30, y: 18 }, { x: 70, y: 18 }, map1.obstacles)).toBe(false); // grazes an edge
  });
});

// ---- bullets in the sim (R4 step 5, R6) ----

const shoot: Action = { move: "stop", turn: "none", fire: true, target: null };

function run(state: WorldState, ticks: number): { state: WorldState; events: StepEvent[] } {
  const events: StepEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const result = step(state, {});
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

const agent = (state: WorldState, id: string): Agent => state.agents.find((a) => a.id === id)!;

describe("segmentsIntersect: closed segments meet, touching and overlap included (map validation)", () => {
  const p = (x: number, y: number) => ({ x, y });

  it("crossing, touching at an end, or a T-junction", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(5, 5), p(5, 5), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(5, 5))).toBe(true);
  });

  it("collinear: overlapping or sharing an end point meets; a gap does not", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(5, 0), p(5, 0), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(5, 0), p(10, 0))).toBe(false);
  });

  it("parallel or apart: no", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(4, 4), p(5, 0), p(9, -4))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0.1), p(5, 5))).toBe(false); // a T that stops 0.1 m short
  });
});

describe("pointPolygonDistance", () => {
  it("is 0 inside or on the boundary", () => {
    expect(pointPolygonDistance({ x: 5, y: 5 }, square)).toBe(0);
    expect(pointPolygonDistance({ x: 10, y: 5 }, square)).toBe(0);
  });

  it("is the distance to the nearest edge outside, a concave notch included", () => {
    expect(pointPolygonDistance({ x: 15, y: 5 }, square)).toBe(5);
    expect(pointPolygonDistance({ x: 13, y: 14 }, square)).toBe(5); // to the corner (10, 10)
    expect(pointPolygonDistance({ x: 8, y: 5 }, cShape)).toBe(1); // in the notch, 1 m from its sides
  });
});

describe("bullets against walls", () => {
  it("golden: each bullet is gone on the tick its path crosses a wall (v1.2-bullet-wall.json)", () => {
    const golden: unknown = JSON.parse(readFileSync(new URL("v1.2-bullet-wall.json", GOLDEN_DIR), "utf8"));
    expect(JSON.parse(JSON.stringify(bulletWallGolden()))).toEqual(golden);
  });

  it("the golden's removal ticks are the crossings worked out by hand", () => {
    // From (10.6, 24) at 3 m/tick: b0 reaches x = 42 after 31.4 m (tick 11); b1 reaches (24, 33)
    // after 16.14 m (tick 6); b2 reaches x = 0 after 10.6 / 1.5 = 7.07 ticks (tick 8); b3 reaches
    // x = 100 after 91.13 m (tick 31).
    expect(bulletWallGolden().removedAt).toEqual({ b0: 11, b1: 6, b2: 8, b3: 31 });
    const tick10 = bulletWallGolden().trace[9]!;
    expect(tick10[0]).toBe(10);
    expect(tick10[1]).toEqual(["b0", 40.6, 24]); // 1.4 m short of the face, still flying
  });

  it("a bullet fired with its muzzle inside a wall is gone at once", () => {
    // Touching the north block's west face: the muzzle is 0.1 m into the block.
    const world = makeWorld({ agents: [makeAgent(0, { x: 41.5, y: 24 }, 0, { action: shoot })] });
    const { state, events } = step(world, {});
    expect(events.map((e) => e.kind)).toEqual(["Shot"]);
    expect(state.bullets).toEqual([]);
  });

  it("a bullet fired out of the arena is gone at once", () => {
    const world = makeWorld({ agents: [makeAgent(0, { x: 99.5, y: 50 }, 0, { action: shoot })] });
    expect(step(world, {}).state.bullets).toEqual([]);
  });
});

describe("bullets against agents", () => {
  // a1 stands 5 m in front of a0: even at full spread the path passes within 0.27 m of a1's center.
  const duel = (a1: Partial<Agent> = {}) =>
    makeWorld({
      agents: [makeAgent(0, { x: 40, y: 50 }, 0, { action: shoot }), makeAgent(1, { x: 45, y: 50 }, 180, a1)],
    });

  it("a hit emits Hit with BULLET_DAMAGE, takes that much HP, removes the bullet and records the hit (R6)", () => {
    const first = step(duel(), {});
    expect(first.events).toEqual([{ kind: "Shot", tick: 1, agent: "a0", bullet: "b0" }]);
    const { state, events } = step(first.state, {});
    expect(events).toEqual([{ kind: "Hit", tick: 2, bullet: "b0", target: "a1", damage: BULLET_DAMAGE }]);
    expect(agent(state, "a1").hp).toBe(AGENT_HP - BULLET_DAMAGE);
    expect(state.bullets).toEqual([]);
    expect(newest(state)?.hits).toEqual([{ target: "a1", from: { x: 40, y: 50 } }]);
    expect(newest(state)?.nearMisses).toEqual([]); // the hit target is not also near-missed
  });

  it("the fifth hit emits Death with the killer, kills the target at that tick and counts the kill", () => {
    const { state, events } = run(duel(), 50);
    expect(events.filter((e) => e.kind === "Hit").map((e) => e.tick)).toEqual([2, 12, 22, 32, 42]);
    expect(events.filter((e) => e.kind !== "Shot").slice(-2)).toEqual([
      { kind: "Hit", tick: 42, bullet: "b4", target: "a1", damage: BULLET_DAMAGE },
      { kind: "Death", tick: 42, agent: "a1", killer: "a0" },
    ]);
    expect(agent(state, "a1")).toMatchObject({ hp: 0, alive: false, deathTick: 42 });
    expect(agent(state, "a0").kills).toBe(1);
    // Shots after the death fly on: nothing is left to hit.
    expect(events.filter((e) => e.kind === "Hit")).toHaveLength(5);
  });

  it("point blank: a new bullet flies in the tick it is fired, so Shot and Hit share a tick", () => {
    const touching = makeWorld({
      agents: [makeAgent(0, { x: 50, y: 50 }, 0, { action: shoot }), makeAgent(1, { x: 51, y: 50 })],
    });
    expect(step(touching, {}).events).toEqual([
      { kind: "Shot", tick: 1, agent: "a0", bullet: "b0" },
      { kind: "Hit", tick: 1, bullet: "b0", target: "a1", damage: BULLET_DAMAGE },
    ]);
  });

  it("an obstacle between shooter and target stops every bullet", () => {
    const covered = makeWorld({
      agents: [makeAgent(0, { x: 35, y: 24 }, 0, { action: shoot }), makeAgent(1, { x: 65, y: 24 }, 180)],
    });
    const { state, events } = run(covered, 60);
    expect(events.filter((e) => e.kind === "Shot")).toHaveLength(6);
    expect(events.filter((e) => e.kind !== "Shot")).toEqual([]);
    expect(agent(state, "a1").hp).toBe(AGENT_HP);
  });

  it("never hits its owner", () => {
    const world = makeWorld({
      agents: [makeAgent(0, { x: 50, y: 50 })],
      bullets: [makeBullet(0, "a0", { x: 48, y: 50 }, { x: 3, y: 0 })], // straight through a0
    });
    expect(run(world, 3).events).toEqual([]);
  });

  it("hits the first body along its path, not one behind it", () => {
    const world = makeWorld({
      agents: [makeAgent(0, { x: 10, y: 50 }), makeAgent(1, { x: 46, y: 50 }), makeAgent(2, { x: 44, y: 50 })],
      bullets: [makeBullet(0, "a0", { x: 42, y: 50 }, { x: 3, y: 0 })],
    });
    expect(step(world, {}).events).toEqual([
      { kind: "Hit", tick: 1, bullet: "b0", target: "a2", damage: BULLET_DAMAGE },
    ]);
  });

  it("a dead agent stops nothing; a body killed earlier in the tick lets the next bullet through", () => {
    const world = makeWorld({
      agents: [makeAgent(0, { x: 10, y: 50 }), makeAgent(1, { x: 44, y: 50 }, 0, { hp: BULLET_DAMAGE })],
      bullets: [
        makeBullet(0, "a0", { x: 42, y: 50 }, { x: 3, y: 0 }),
        makeBullet(1, "a0", { x: 42, y: 50 }, { x: 3, y: 0 }),
      ],
    });
    const { state, events } = step(world, {});
    expect(events).toEqual([
      { kind: "Hit", tick: 1, bullet: "b0", target: "a1", damage: BULLET_DAMAGE },
      { kind: "Death", tick: 1, agent: "a1", killer: "a0" },
    ]);
    expect(state.bullets.map((b) => [b.id, b.pos])).toEqual([["b1", { x: 45, y: 50 }]]);
  });
});

describe("near misses (R4 step 5, R6)", () => {
  // b0 (a0's) flies (48.5, 50) → (51.5, 50) in tick 1, passing (50, 50 + offset) at `offset` m.
  const pass = (offset: number) =>
    makeWorld({
      agents: [makeAgent(0, { x: 10, y: 50 }), makeAgent(1, { x: 50, y: 50 + offset })],
      bullets: [makeBullet(0, "a0", { x: 48.5, y: 50 }, { x: 3, y: 0 })],
    });

  it("a bullet passing within INCOMING_RADIUS_M records a near miss with the shooter's position", () => {
    expect(INCOMING_RADIUS_M).toBe(2);
    const { state, events } = step(pass(1.5), {});
    expect(events).toEqual([]);
    expect(newest(state)?.nearMisses).toEqual([{ target: "a1", from: { x: 10, y: 50 } }]);
    expect(newest(step(pass(2), {}).state)?.nearMisses).toHaveLength(1); // exactly 2 m counts
  });

  it("one passing farther away does not", () => {
    expect(newest(step(pass(2.5), {}).state)?.nearMisses).toEqual([]);
  });

  it("the shooter is never near-missed by its own bullet", () => {
    const world = makeWorld({ agents: [makeAgent(0, { x: 50, y: 50 }, 0, { action: shoot })] });
    expect(newest(step(world, {}).state)?.nearMisses).toEqual([]);
  });

  it("only the part of the path travelled before a wall counts", () => {
    // The path (40, 18.5) → (43, 18.5) enters the north block at x = 42. a1 at (43.5, 16.8) is
    // 1.77 m from the full segment but 2.27 m from the 2 m actually travelled.
    const world = makeWorld({
      agents: [makeAgent(0, { x: 10, y: 18.5 }), makeAgent(1, { x: 43.5, y: 16.8 })],
      bullets: [makeBullet(0, "a0", { x: 40, y: 18.5 }, { x: 3, y: 0 })],
    });
    const { state } = step(world, {});
    expect(state.bullets).toEqual([]);
    expect(newest(state)?.nearMisses).toEqual([]);
  });

  it("the window keeps the newest DOER_INTERVAL_TICKS steps, oldest first; older ones drop out (R15)", () => {
    const empty: TickFacts = { shots: [], hits: [], nearMisses: [] };
    const missed: TickFacts = { ...empty, nearMisses: [{ target: "a1", from: { x: 10, y: 50 } }] };
    let state = step(pass(1.5), {}).state;
    expect(state.recent).toEqual([missed]); // step 1: the window holds that step alone
    state = step(state, {}).state;
    expect(state.recent).toEqual([missed, empty]); // step 2 is the newest, step 1 still in the window
    for (let t = 3; t <= DOER_INTERVAL_TICKS; t++) state = step(state, {}).state;
    expect(state.recent).toHaveLength(DOER_INTERVAL_TICKS);
    expect(state.recent[0]).toEqual(missed); // step 1 is the oldest of steps 1..10
    state = step(state, {}).state;
    expect(state.recent).toEqual(Array.from({ length: DOER_INTERVAL_TICKS }, () => empty)); // step 11 pushed step 1 out
  });
});
