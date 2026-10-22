import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_RADIUS_M, DOER_INTERVAL_TICKS, FIRE_INTERVAL_TICKS, MOVE_SPEED_MPS } from "../../src/constants";
import { getMap } from "../../src/maps";
import { MapSpecSchema } from "../../src/schemas";
import { circleInsideArena, circleOverlapsPolygon } from "../../src/sim/collision";
import { perceive, type PerceptionState } from "../../src/sim/perceive";
import { step } from "../../src/sim/step";
import type { Agent, Observation, TickFacts, WorldState } from "../../src/types";
import { mpsToMetersPerTick } from "../../src/units";
import { dist } from "../../src/vec2";
import { formatGolden, GOLDEN_DIR, perceptionGolden, SCENES } from "./golden-scenarios";
import { deepFreeze, loadScene, makeAgent, makeWorld } from "./helpers";

// v1.3: perceive(state, agent) is what an agent knows (DESIGN.md §3 principle 3,
// §6.2; sim rulings R7, R15): living enemies in a 90° cone within 60 m with clear
// line of sight; other agents' shots within 80 m and enemies' footsteps within
// 15 m, through walls, as a bearing and a band; hits and near misses on it as the
// bearing of the shooter; its own status. Shots, hits and near misses are those
// of the last DOER_INTERVAL_TICKS steps (the window, R15). Bearings in whole
// degrees, distances in whole meters, secondsLeft to one decimal.

const NO_FACTS: TickFacts = { shots: [], hits: [], nearMisses: [] };

/** A world on arena-1 at `tick` with these agents; `facts` are the newest step's, the only one in its window. */
function world(agents: Agent[], facts: Partial<TickFacts> = {}, tick = 0): WorldState {
  return { ...makeWorld({ agents, tick }), recent: [{ ...NO_FACTS, ...facts }] };
}

/** A world on arena-1 at `tick` whose window holds `steps`, oldest first: the last is the step that produced `tick`. */
function windowed(agents: Agent[], steps: Partial<TickFacts>[], tick: number): WorldState {
  return { ...makeWorld({ agents, tick }), recent: steps.map((facts) => ({ ...NO_FACTS, ...facts })) };
}

const dead = { alive: false, hp: 0, deathTick: 3 } as const;
const MOVE_STEP_M = mpsToMetersPerTick(MOVE_SPEED_MPS);

describe("self (§6.2: position, facing, HP, kills, time remaining)", () => {
  it("position to 2 decimals and facing to 1 decimal, as the log's Tick rows round them (R10)", () => {
    const me = makeAgent(0, { x: 12.3456, y: 45.6789 }, 33.333, { hp: 60, kills: 2 });
    expect(perceive(world([me]), "a0").self).toEqual({
      pos: { x: 12.35, y: 45.68 },
      facing: 33.3,
      hp: 60,
      kills: 2,
      secondsLeft: 300,
    });
  });

  it("facing stays in (−180, 180] after rounding", () => {
    expect(perceive(world([makeAgent(0, { x: 50, y: 50 }, -179.97)]), "a0").self.facing).toBe(180);
    expect(perceive(world([makeAgent(0, { x: 50, y: 50 }, 179.97)]), "a0").self.facing).toBe(180);
  });

  it("secondsLeft = (durationTicks − tick) × 50 ms, to one decimal, never negative", () => {
    const at = (tick: number) => perceive(world([makeAgent(0, { x: 50, y: 50 })], {}, tick), "a0").self.secondsLeft;
    expect(at(0)).toBe(300);
    expect(at(1234)).toBe(238.3);
    expect(at(5999)).toBe(0.1); // 0.05 s rounds half up
    expect(at(6000)).toBe(0);
    expect(at(6005)).toBe(0);
  });
});

describe("vision: cone, range, line of sight (R7)", () => {
  it("sees living enemies as id, bearing (+ = right), distance and moving, nearest first", () => {
    const me = makeAgent(0, { x: 50, y: 50 }, 0);
    const walker = makeAgent(1, { x: 70, y: 57.3 }, 180, { moved: true }); // 21.29 m at 20.05°
    const still = makeAgent(2, { x: 60, y: 45 }, 90); // 11.18 m at −26.57°
    expect(perceive(world([me, walker, still]), "a0").visible).toEqual([
      { id: "a2", bearing: -27, dist: 11, moving: false },
      { id: "a1", bearing: 20, dist: 21, moving: true },
    ]);
  });

  it("the cone is 90° wide, edges included", () => {
    const right = makeAgent(1, { x: 60, y: 60 }); // heading 45°
    const left = makeAgent(2, { x: 60, y: 40 }); // heading −45°
    const seen = (facing: number) =>
      perceive(world([makeAgent(0, { x: 50, y: 50 }, facing), right, left]), "a0").visible.map((v) => [v.id, v.bearing]);
    expect(seen(0)).toEqual([
      ["a1", 45],
      ["a2", -45],
    ]);
    expect(seen(1)).toEqual([["a1", 44]]); // a2 at −46°
    expect(seen(-1)).toEqual([["a2", -44]]); // a1 at 46°
  });

  it("range is 60 m, inclusive, like face_target's", () => {
    const me = makeAgent(0, { x: 10, y: 50 }, 0);
    expect(perceive(world([me, makeAgent(1, { x: 70, y: 50 })]), "a0").visible).toEqual([
      { id: "a1", bearing: 0, dist: 60, moving: false },
    ]);
    expect(perceive(world([me, makeAgent(1, { x: 70.5, y: 50 })]), "a0").visible).toEqual([]);
  });

  it("an obstacle between blocks sight, and so does a line that only touches its corner", () => {
    // arena-1's north block spans x 42..58, y 18..30.
    const behind = [makeAgent(0, { x: 50, y: 10 }, 90), makeAgent(1, { x: 50, y: 40 })];
    expect(perceive(world(behind), "a0").visible).toEqual([]);
    const me = makeAgent(0, { x: 30, y: 30 }, -45);
    const grazing = makeAgent(1, { x: 54, y: 6 }); // the line passes exactly through the corner (42, 18)
    const clear = makeAgent(1, { x: 54, y: 5.9 }); // passes 0.05 m outside it
    expect(perceive(world([me, grazing]), "a0").visible).toEqual([]);
    expect(perceive(world([me, clear]), "a0").visible.map((v) => v.id)).toEqual(["a1"]);
  });

  it("dead agents are not seen, and an agent never sees itself", () => {
    const agents = [makeAgent(0, { x: 50, y: 50 }, 0), makeAgent(1, { x: 60, y: 50 }, 0, dead)];
    expect(perceive(world(agents), "a0").visible).toEqual([]);
  });
});

describe("hearing: shots within 80 m and footsteps within 15 m, through walls (R7)", () => {
  it("hears other agents' shots this tick as a bearing and a band; never its own", () => {
    // a0 north of arena-1's north block; a1 south of it (30 m), a2 exactly 80 m away, a3 80.5 m.
    const agents = [
      makeAgent(0, { x: 50, y: 10 }, 0),
      makeAgent(1, { x: 50, y: 40 }),
      makeAgent(2, { x: 50, y: 90 }),
      makeAgent(3, { x: 50, y: 90.5 }),
    ];
    const shots = agents.map((a) => ({ agent: a.id, pos: a.pos })); // a0 fired too
    expect(perceive(world(agents, { shots }), "a0").heard).toEqual([
      { kind: "shot", bearing: 90, dist: "mid" },
      { kind: "shot", bearing: 90, dist: "far" },
    ]);
  });

  it("bands: near under 20 m, mid under 45 m, far beyond", () => {
    const xs = [29.99, 30, 54.99, 55]; // 19.99, 20, 44.99 and 45 m east of a0
    const agents = [makeAgent(0, { x: 10, y: 50 }, 90), ...xs.map((x, i) => makeAgent(i + 1, { x, y: 50 }))];
    const shots = agents.slice(1).map((a) => ({ agent: a.id, pos: a.pos }));
    expect(perceive(world(agents, { shots }), "a0").heard.map((h) => h.dist)).toEqual(["near", "mid", "mid", "far"]);
  });

  it("hears footsteps of living enemies that moved this tick, up to 15 m inclusive", () => {
    // a0 just south of the north block, facing south; everyone else north of it.
    const agents = [
      makeAgent(0, { x: 50, y: 32 }, 90),
      makeAgent(1, { x: 50, y: 17 }, 0, { moved: true }), // 15 m, behind the block
      makeAgent(2, { x: 44, y: 16.5 }, 0, { moved: true }), // 16.6 m
      makeAgent(3, { x: 56, y: 17 }), // 16.2 m, standing still
      makeAgent(4, { x: 57, y: 36 }, 0, { moved: true, ...dead }), // 8.1 m, dead
      makeAgent(5, { x: 58.5, y: 31 }), // 8.6 m, still
    ];
    expect(perceive(world(agents), "a0").heard).toEqual([{ kind: "steps", bearing: 180, dist: "near" }]);
  });

  it("lists shots before footsteps, each nearest first", () => {
    const agents = [
      makeAgent(0, { x: 50, y: 50 }, 0),
      makeAgent(1, { x: 55, y: 50 }, 0, { moved: true }), // steps at 5 m, ahead
      makeAgent(2, { x: 20, y: 50 }), // shot at 30 m, behind
      makeAgent(3, { x: 50, y: 60 }, 0, { moved: true }), // shot and steps at 10 m, right
    ];
    const shots = [agents[2]!, agents[3]!].map((a) => ({ agent: a.id, pos: a.pos }));
    expect(perceive(world(agents, { shots }), "a0").heard).toEqual([
      { kind: "shot", bearing: 90, dist: "near" },
      { kind: "shot", bearing: 180, dist: "mid" },
      { kind: "steps", bearing: 0, dist: "near" },
      { kind: "steps", bearing: 90, dist: "near" },
    ]);
  });
});

describe("incoming: hits and near misses on me this tick, as the shooter's bearing (R7)", () => {
  it("hits first, then near misses; other agents' facts are not mine", () => {
    const agents = [makeAgent(0, { x: 50, y: 50 }, 0), makeAgent(1, { x: 60, y: 50 })];
    const facts = {
      hits: [
        { target: "a1", from: { x: 50, y: 50 } },
        { target: "a0", from: { x: 50, y: 40 } },
      ],
      nearMisses: [
        { target: "a0", from: { x: 30, y: 50 } },
        { target: "a1", from: { x: 70, y: 70 } },
        { target: "a0", from: { x: 60, y: 60 } },
      ],
    };
    expect(perceive(world(agents, facts), "a0").incoming).toEqual([{ bearing: -90 }, { bearing: 180 }, { bearing: 45 }]);
  });
});

describe("the window: shots, hits and near misses of the last DOER_INTERVAL_TICKS steps (R15)", () => {
  it("hears every other agent's shot in the window, as a bearing and band from where the shooter stood when it fired", () => {
    // a1 fired 6 steps ago from (50, 40) and has walked 1.5 m east since; a2 fired this step;
    // a3 fired 3 steps ago, 81 m away from a0 then and now (out of range); a0's own older shot is not heard.
    const agents = [
      makeAgent(0, { x: 50, y: 10 }, 0),
      makeAgent(1, { x: 51.5, y: 40 }, 0, { moved: true }),
      makeAgent(2, { x: 20, y: 10 }),
      makeAgent(3, { x: 50, y: 91 }),
    ];
    const steps: Partial<TickFacts>[] = Array.from({ length: DOER_INTERVAL_TICKS }, () => ({}));
    steps[3] = { shots: [{ agent: "a1", pos: { x: 50, y: 40 } }, { agent: "a0", pos: { x: 50, y: 10 } }] };
    steps[6] = { shots: [{ agent: "a3", pos: { x: 50, y: 91 } }] };
    steps[9] = { shots: [{ agent: "a2", pos: { x: 20, y: 10 } }] };
    expect(perceive(windowed(agents, steps, 40), "a0").heard).toEqual([
      { kind: "shot", bearing: 90, dist: "mid" }, // a1, 30 m due south of a0 when it fired
      { kind: "shot", bearing: 180, dist: "mid" }, // a2, 30 m west
    ]);
  });

  it("still hears a shot whose shooter has died since", () => {
    const agents = [makeAgent(0, { x: 50, y: 10 }, 0), makeAgent(1, { x: 60, y: 10 }, 0, dead)];
    const view = perceive(windowed(agents, [{ shots: [{ agent: "a1", pos: { x: 60, y: 10 } }] }, {}, {}], 3), "a0");
    expect([view.visible, view.heard]).toEqual([[], [{ kind: "shot", bearing: 0, dist: "near" }]]);
  });

  it("feels every hit and near miss on it in the window: hits, then near misses, each oldest first", () => {
    const agents = [makeAgent(0, { x: 50, y: 50 }, 0), makeAgent(1, { x: 60, y: 50 })];
    const steps: Partial<TickFacts>[] = [
      { nearMisses: [{ target: "a0", from: { x: 50, y: 70 } }] }, // the oldest step: from straight right
      { hits: [{ target: "a0", from: { x: 30, y: 50 } }, { target: "a1", from: { x: 50, y: 50 } }] },
      {},
      { hits: [{ target: "a0", from: { x: 50, y: 30 } }], nearMisses: [{ target: "a0", from: { x: 70, y: 50 } }] }, // the newest
    ];
    expect(perceive(windowed(agents, steps, 23), "a0").incoming).toEqual([{ bearing: 180 }, { bearing: -90 }, { bearing: 90 }, { bearing: 0 }]);
  });

  it("each shot reaches exactly one decision: the first one after it (R1 cadence, decisions at ticks 1, 11, 21, …)", () => {
    // a1's weapon is ready at step 7: it fires once, then holds fire. a0 is asked at tick t from
    // the world after step t − 1, so the decisions see the worlds of ticks 0, 10, 20, 30.
    const fire = { move: "stop", turn: "none", fire: true, target: null } as const;
    let state = makeWorld({ agents: [makeAgent(0, { x: 50, y: 10 }, 0), makeAgent(1, { x: 50, y: 40 }, 0, { cooldownTicks: 7, action: fire })] });
    const heard = [perceive(state, "a0").heard.length];
    for (let t = 1; t <= 30; t++) {
      const result = step(state, t === 8 ? { a1: { ...fire, fire: false } } : {});
      if (t === 7) expect(result.events).toEqual([{ kind: "Shot", tick: 7, agent: "a1", bullet: "b0" }]);
      state = result.state;
      heard.push(perceive(state, "a0").heard.length);
    }
    const ticksHeard = heard.flatMap((n, tick) => (n > 0 ? [tick] : []));
    expect(ticksHeard).toEqual(Array.from({ length: DOER_INTERVAL_TICKS }, (_, i) => 7 + i)); // ticks 7..16
    expect([0, 10, 20, 30].filter((tick) => heard[tick]! > 0)).toEqual([10]); // only the decision at tick 11
  });
});

describe("contract", () => {
  it("throws for an agent that is not in the world", () => {
    expect(() => perceive(world([makeAgent(0, { x: 50, y: 50 })]), "a7")).toThrow(/a7/);
  });

  it("a dead agent perceives nothing but its own status", () => {
    const agents = [makeAgent(0, { x: 50, y: 50 }, 0, { ...dead, kills: 1 }), makeAgent(1, { x: 60, y: 50 }, 0, { moved: true })];
    const facts = { shots: [{ agent: "a1", pos: { x: 60, y: 50 } }], hits: [{ target: "a0", from: { x: 60, y: 50 } }] };
    expect(perceive(world(agents, facts), "a0")).toEqual({
      self: { pos: { x: 50, y: 50 }, facing: 0, hp: 0, kills: 1, secondsLeft: 300 },
      visible: [],
      heard: [],
      incoming: [],
    });
  });

  it("is pure: a deeply frozen state is left as it was, and the same input gives the same output", () => {
    const agents = [makeAgent(0, { x: 50, y: 50 }, 0), makeAgent(1, { x: 60, y: 52 }, 0, { moved: true })];
    const input = deepFreeze(world(agents, { shots: [{ agent: "a1", pos: { x: 60, y: 52 } }] }));
    const before = structuredClone(input);
    const first = perceive(input, "a0");
    expect(input).toEqual(before);
    expect(perceive(input, "a0")).toEqual(first);
    expect(perceive(input, "a0")).not.toBe(first);
  });

  it("reads only what a replay can rebuild: tick, durationTicks, map, the window and the agents' public fields", () => {
    const state: PerceptionState = {
      tick: 10,
      durationTicks: 100,
      map: getMap("arena-1"),
      recent: [NO_FACTS],
      agents: [
        { id: "a0", pos: { x: 50, y: 50 }, facing: 0, hp: 100, alive: true, kills: 0, moved: false },
        { id: "a1", pos: { x: 60, y: 50 }, facing: 180, hp: 40, alive: true, kills: 3, moved: true },
      ],
    };
    expect(perceive(state, "a0")).toEqual({
      self: { pos: { x: 50, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 4.5 },
      visible: [{ id: "a1", bearing: 0, dist: 10, moving: true }],
      heard: [{ kind: "steps", bearing: 0, dist: "near" }],
      incoming: [],
    });
  });
});

// ---- the five scenes (core/fixtures/scenes) against their goldens (core/fixtures/golden/v1.3-*.json) ----

describe("scene fixtures are consistent world states", () => {
  for (const name of SCENES) {
    it(name, () => {
      const { description, state } = loadScene(name);
      expect(description.length).toBeGreaterThan(20);
      expect(MapSpecSchema.parse(state.map)).toEqual(state.map);
      expect(state.tick).toBeLessThanOrEqual(state.durationTicks);
      const ids = state.agents.map((a) => a.id);
      for (const [slot, a] of state.agents.entries()) {
        expect([a.id, a.slot]).toEqual([`a${slot}`, slot]);
        expect(circleInsideArena(a.pos, AGENT_RADIUS_M, state.map.width, state.map.height), a.id).toBe(true);
        for (const o of state.map.obstacles) expect(circleOverlapsPolygon(a.pos, AGENT_RADIUS_M, o.vertices), a.id).toBe(false);
        expect(a.alive ? a.hp > 0 && a.deathTick === null : a.hp === 0 && a.deathTick !== null && !a.moved, a.id).toBe(true);
      }
      // R6, R15: the window holds the newest min(tick, DOER_INTERVAL_TICKS) steps, oldest first. A
      // shot is recorded where its shooter stood: the newest step's where it stands now, an older
      // one within walking reach of that (MOVE_STEP_M per step); a weapon fires at most once per
      // FIRE_INTERVAL_TICKS. Hits and near misses name agents of this world.
      expect(state.recent).toHaveLength(Math.min(state.tick, DOER_INTERVAL_TICKS));
      state.recent.forEach((facts, i) => {
        const age = state.recent.length - 1 - i;
        for (const shot of facts.shots) {
          const shooter = state.agents.find((a) => a.id === shot.agent);
          expect(shooter, shot.agent).toBeDefined();
          expect(dist(shot.pos, shooter?.pos ?? shot.pos), `${shot.agent}'s shot ${age} steps ago`).toBeLessThanOrEqual(age * MOVE_STEP_M);
        }
        for (const fact of [...facts.hits, ...facts.nearMisses]) expect(ids).toContain(fact.target);
      });
      const shooters = state.recent.slice(-FIRE_INTERVAL_TICKS).flatMap((facts) => facts.shots.map((shot) => shot.agent));
      expect(new Set(shooters).size).toBe(shooters.length);
      for (const b of state.bullets) expect(circleInsideArena(b.pos, 0, state.map.width, state.map.height), b.id).toBe(true);
    });
  }

  it("the combined scene is on arena-1, with 4 agents", () => {
    const { state } = loadScene("combined");
    expect(state.map).toEqual(getMap("arena-1"));
    expect(state.agents).toHaveLength(4);
  });
});

describe("scene goldens: byte-equal Observations (v1.3 exit criterion)", () => {
  for (const name of SCENES) {
    it(`v1.3-${name}.json`, () => {
      const file = readFileSync(new URL(`v1.3-${name}.json`, GOLDEN_DIR), "utf8");
      expect(formatGolden(perceptionGolden(name))).toBe(file);
    });
  }
});

describe("scene goldens agree with the rules worked out by hand (a0's view)", () => {
  const a0 = (name: string): Observation => perceptionGolden(name).observations.a0!;

  it("cone edge: the enemy at 44° is seen, the one at 46° is not", () => {
    expect(a0("cone-edge")).toEqual({
      self: { pos: { x: 10, y: 30 }, facing: 0, hp: 100, kills: 0, secondsLeft: 240 },
      visible: [{ id: "a1", bearing: 44, dist: 30, moving: true }],
      heard: [],
      incoming: [],
    });
  });

  it("LOS blocked: the walker behind the box is heard, not seen; the still one behind it neither", () => {
    const view = a0("los-blocked");
    expect(view.visible).toEqual([{ id: "a2", bearing: 42, dist: 27, moving: false }]);
    expect(view.heard).toEqual([{ kind: "steps", bearing: 0, dist: "near" }]);
  });

  it("hearing without sight: the 70 m shot is far, the 85 m one unheard, the walker behind the wall near", () => {
    const view = a0("hearing");
    expect(view.visible).toEqual([]);
    expect(view.heard).toEqual([
      { kind: "shot", bearing: 9, dist: "mid" },
      { kind: "shot", bearing: 0, dist: "far" },
      { kind: "steps", bearing: 0, dist: "near" },
    ]);
  });

  it("incoming: the hit, then b12's near misses of ticks 2999 and 3000, each as the shooter's bearing; b12's shot is heard", () => {
    const view = a0("incoming");
    expect(view.self.hp).toBe(80);
    expect(view.incoming).toEqual([{ bearing: 90 }, { bearing: 133 }, { bearing: 133 }]);
    expect(view.heard).toEqual([{ kind: "shot", bearing: 133, dist: "mid" }]); // a1 fired b12 at tick 2992, 21.9 m away
  });

  it("combined on arena-1: one enemy seen, two shots (one 6 ticks old) and footsteps heard, one near miss", () => {
    expect(a0("combined")).toEqual({
      self: { pos: { x: 50, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 270 },
      visible: [{ id: "a1", bearing: -9, dist: 30, moving: true }],
      heard: [
        { kind: "shot", bearing: 142, dist: "near" }, // a3's b27 at tick 594, from (38.7, 58.75): 14.3 m
        { kind: "shot", bearing: -90, dist: "mid" },
        { kind: "steps", bearing: 141, dist: "near" },
      ],
      incoming: [{ bearing: 141 }],
    });
  });
});
