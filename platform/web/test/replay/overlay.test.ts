import { MatchLogSchema } from "@decision-arena/core/legacy";
import { normalizeDeg, VISION_CONE_DEG, VISION_RANGE_M, vec2, type Vec2 } from "@decision-arena/kit-shooter";
import { beforeAll, describe, expect, it } from "vitest";
import sampleJson from "../../../../kits/shooter/fixtures/sample-log.json" with { type: "json" };
import { indexLog, type LogIndex } from "../../src/replay/log-index";
import { clipToRect, overlayModel, tickSegment, visionCone } from "../../src/replay/overlay";
import { stateFromTick } from "../../src/replay/state-from-tick";
import { realMatch, type RealMatch } from "./real-match";

const sample = MatchLogSchema.parse(sampleJson);
const index = indexLog(sample);
const angleFrom = (apex: Vec2, p: Vec2) => vec2.angleOf(vec2.sub(p, apex));

/** Shoelace area, positive either winding. */
function area(polygon: readonly Vec2[]): number {
  let twice = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}

describe("visionCone", () => {
  it("is a wedge: apex at the agent, an arc VISION_RANGE_M away spanning VISION_CONE_DEG centered on the facing", () => {
    const apex = { x: 50, y: 50 };
    const [first, ...arc] = visionCone(apex, 0, 8);
    expect(first).toEqual(apex);
    expect(arc).toHaveLength(9);
    for (const p of arc) expect(vec2.dist(apex, p)).toBeCloseTo(VISION_RANGE_M, 9);
    const angles = arc.map((p) => angleFrom(apex, p));
    expect(angles[0]).toBeCloseTo(-VISION_CONE_DEG / 2, 9);
    expect(angles.at(-1)).toBeCloseTo(VISION_CONE_DEG / 2, 9);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1] ?? Infinity);
  });

  it("turns with the facing, clockwise with y down: facing 90° looks toward +y", () => {
    const cone = visionCone({ x: 50, y: 10 }, 90, 2); // apex, then the arc at 45°, 90°, 135°
    expect(cone[2]?.x).toBeCloseTo(50, 9);
    expect(cone[2]?.y).toBeCloseTo(70, 9);
    expect(angleFrom({ x: 50, y: 10 }, cone[1] ?? { x: 0, y: 0 })).toBeCloseTo(45, 9);
  });
});

describe("clipToRect", () => {
  it("keeps a polygon that is inside the rectangle as it is", () => {
    const tri = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 10, y: 40 },
    ];
    expect(clipToRect(tri, 100, 100)).toEqual(tri);
  });

  it("cuts what lies outside at the edges, without doubling vertices that sit on an edge", () => {
    const square = [
      { x: -10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 60 },
      { x: -10, y: 60 },
    ];
    expect(clipToRect(square, 100, 100)).toEqual([
      { x: 0, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 60 },
      { x: 0, y: 60 },
    ]);
    const onEdge = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 50 },
    ];
    expect(clipToRect(onEdge, 100, 100)).toEqual(onEdge);
  });

  it("returns nothing for a polygon entirely outside", () => {
    const away = [
      { x: 120, y: 10 },
      { x: 150, y: 10 },
      { x: 150, y: 40 },
    ];
    expect(clipToRect(away, 100, 100)).toEqual([]);
  });

  it("clips a vision cone near a corner to the part inside the arena", () => {
    const cone = visionCone({ x: 4, y: 4 }, -135, 24); // looking out through the top-left corner
    const clipped = clipToRect(cone, 100, 100);
    for (const p of clipped) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
    expect(area(clipped)).toBeLessThan(area(cone) / 100);
    expect(area(clipped)).toBeGreaterThan(0);
  });
});

describe("tickSegment", () => {
  it("runs from `from` to `to` meters out along an absolute angle", () => {
    const [a, b] = tickSegment({ x: 10, y: 20 }, 0, 2, 5);
    expect([a, b]).toEqual([
      { x: 12, y: 20 },
      { x: 15, y: 20 },
    ]);
    const [c, d] = tickSegment({ x: 10, y: 20 }, 90, 1, 3); // 90° points down the screen
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(21, 9);
    expect(d.y).toBeCloseTo(23, 9);
  });
});

describe("overlayModel on the sample log", () => {
  it("tick 115 following a0: cone east inside the arena, a1 seen, one incoming hit from straight ahead", () => {
    const model = overlayModel(stateFromTick(index, sample, 115), "a0");
    expect(model).toMatchObject({ tick: 115, agent: "a0", alive: true, pos: { x: 26.5, y: 50 }, facing: 0 });
    expect(model.seen).toEqual([{ id: "a1", pos: { x: 67.25, y: 50 } }]);
    expect(model.incoming).toEqual([0]); // absolute angle toward a1, which fired b6
    expect(model.cone[0]).toEqual({ x: 26.5, y: 50 });
    for (const p of model.cone) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it("incoming angles are absolute: the facing plus the bearing perceive reports", () => {
    // Tick 132: a0's b9 hits a1, which faces −176.3° with a0 dead ahead (bearing 0 after rounding);
    // the window (ticks 123..132, R15) also holds b7, which hit a1 at 123 from a0's spot then (−3°).
    const hit = overlayModel(stateFromTick(index, sample, 132), "a1");
    expect(hit.facing).toBe(-176.3);
    expect(hit.incoming).toEqual([-179.3, -176.3]);
    expect(overlayModel(stateFromTick(index, sample, 105), "a1").incoming).toEqual([180]); // b3, a1 facing 180°
    expect(overlayModel(stateFromTick(index, sample, 141), "a0")).toMatchObject({ facing: 3.7, incoming: [] });
  });

  it("tick 0: a1 is 92 m away, beyond the cone's reach; nobody fired", () => {
    const model = overlayModel(stateFromTick(index, sample, 0), "a0");
    expect([model.seen, model.incoming]).toEqual([[], []]);
    expect(model.cone.length).toBeGreaterThan(3);
  });

  it("a dead agent has no cone and sees nothing: a1 at tick 142", () => {
    const model = overlayModel(stateFromTick(index, sample, 142), "a1");
    expect(model).toMatchObject({ agent: "a1", alive: false, pos: { x: 60.76, y: 49.73 }, cone: [], seen: [], incoming: [] });
  });
});

describe("overlayModel on a real 16-bot match", () => {
  let real: RealMatch;
  let realIndex: LogIndex;
  beforeAll(async () => {
    real = await realMatch();
    realIndex = indexLog(real.log);
  });

  it("puts a red tick toward the source of every hit and near miss on the followed agent, as the sim placed it", () => {
    // The live world's facts (unrounded) say where each shot came from: the window's hits first,
    // then its near misses, each oldest first, as perceive lists them (R15). Each tick points there
    // to the degree: perceive's whole-degree bearing plus the rows' rounding.
    const wrong: string[] = [];
    let ticks = 0;
    let nearMisses = 0;
    for (const [tick, world] of real.live) {
      const facts = [...world.recent.flatMap((f) => f.hits), ...world.recent.flatMap((f) => f.nearMisses)];
      if (facts.length === 0) continue;
      const state = stateFromTick(realIndex, real.log, tick);
      for (const agent of world.agents) {
        if (!agent.alive) continue;
        const sources = facts.filter((f) => f.target === agent.id).map((f) => vec2.angleOf(vec2.sub(f.from, agent.pos)));
        const { incoming } = overlayModel(state, agent.id);
        ticks += incoming.length;
        nearMisses += world.recent.flatMap((f) => f.nearMisses).filter((m) => m.target === agent.id).length;
        const ok = incoming.length === sources.length && incoming.every((angle, i) => Math.abs(normalizeDeg(angle - (sources[i] ?? Number.NaN))) <= 1);
        if (!ok) wrong.push(`tick ${tick} ${agent.id}: ticks at ${JSON.stringify(incoming)}, fire from ${JSON.stringify(sources.map((a) => +a.toFixed(2)))}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(nearMisses).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(nearMisses); // and hits on agents that survived them
  });
});
