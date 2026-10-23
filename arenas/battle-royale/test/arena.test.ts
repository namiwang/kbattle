import { ACTOR_INTERVAL_TICKS, BaseConfigSchema, createRng, roundTo, TICK_MS, type Arena } from "@decision-arena/core";
import {
  getMap,
  MAP_IDS,
  normalizeDeg,
  PERCEPTION_WINDOW_TICKS,
  perceive,
  spawnEvents as v1SpawnEvents,
  spawnWorld,
  step,
  tickEvent as v1TickEvent,
  type Action,
  type WorldState,
} from "@decision-arena/kit-shooter";
import { describe, expect, expectTypeOf, it } from "vitest";
import { battleRoyale, createBattleRoyale, rankAgents, type BattleRoyaleTypes } from "../src";
import { makeAgent, makeBullet, makeWorld, map1, OPEN } from "./helpers";

// The battle royale arena over the shooter kit (DESIGN.md §5.2, §13; ruling R24):
// what each contract member does, checked against the kit and, for the events and
// the Tick payload, against the version-1 log writer (the kit's legacy/log.ts).

const AGENTS = Array.from({ length: 16 }, (_, i) => `a${i}`);
const config = (over: Partial<{ seed: number; durationTicks: number; mapId: string }> = {}) => ({ seed: 7, durationTicks: 6000, mapId: "map-1", ...over });

/** A 16-agent world stepped `ticks` times with everyone firing and turning, so bullets fly, hit and pass close. */
function busyWorlds(ticks: number): WorldState[] {
  let state = battleRoyale.spawn(config(), AGENTS, createRng(7)).state;
  const worlds = [state];
  const actions: Record<string, Action> = {};
  for (const [i, id] of AGENTS.entries()) actions[id] = { move: i % 3 === 0 ? "forward" : "stop", turn: i % 2 === 0 ? "left" : "right", fire: true, target: null };
  for (let t = 0; t < ticks; t++) {
    state = battleRoyale.step(state, actions).state;
    worlds.push(state);
  }
  return worlds;
}

describe("battleRoyale: who it is (R19, R24)", () => {
  it("is the battle-royale Arena, solo only, over the kit's maps", () => {
    expectTypeOf(battleRoyale).toEqualTypeOf<Arena<BattleRoyaleTypes>>();
    expect([battleRoyale.id, battleRoyale.title, battleRoyale.modes, battleRoyale.maps]).toEqual(["battle-royale", "Battle royale", ["solo"], MAP_IDS]);
  });

  it("asks the actor once per perception window, so every fact perceived reaches one decision (R15, R24)", () => {
    expect(battleRoyale.actorIntervalTicks ?? ACTOR_INTERVAL_TICKS).toBe(PERCEPTION_WINDOW_TICKS);
    expect(battleRoyale.actorIntervalTicks).toBe(PERCEPTION_WINDOW_TICKS); // set, not left to the platform's default
    expect(ACTOR_INTERVAL_TICKS).toBe(PERCEPTION_WINDOW_TICKS); // which agrees today
  });

  it("plays 50 ms ticks, the tick its units and perception are built on", () => {
    expect(battleRoyale.tickMs ?? TICK_MS).toBe(TICK_MS);
    expect(TICK_MS).toBe(50);
  });
});

describe("battleRoyale.config: the platform's seed and length plus one of the arena's maps (R21.c, R24)", () => {
  it("reads a config and keeps only its fields", () => {
    expect(battleRoyale.config.parse({ ...config(), slots: 8 })).toEqual(config());
    expect(BaseConfigSchema.parse(config())).toEqual({ seed: 7, durationTicks: 6000 });
  });

  it.each([
    ["an unknown map", { mapId: "arena-1" }, "mapId"],
    ["a seed out of range", { seed: -1 }, "seed"],
    ["a length of 0", { durationTicks: 0 }, "durationTicks"],
  ])("refuses %s", (_name, over, path) => {
    const result = battleRoyale.config.safeParse(config(over));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([path]);
  });

  it("accepts every map the arena lists", () => {
    for (const mapId of battleRoyale.maps) expect(battleRoyale.config.safeParse(config({ mapId })).success).toBe(true);
  });
});

describe("battleRoyale.spawn: the platform's agents from the platform's RNG (R21.c)", () => {
  it("is the kit's world for those agents, on the config's map, drawn from the RNG it is given", () => {
    const { state } = battleRoyale.spawn(config({ mapId: "map-2", durationTicks: 900 }), AGENTS, createRng(7));
    expect(state).toEqual(spawnWorld({ map: getMap("map-2"), agents: AGENTS, durationTicks: 900, rng: createRng(7) }));
  });

  it("announces the agents as the version-1 log did: a Spawn per agent in slot order, rounded like Tick rows", () => {
    const { state, events } = battleRoyale.spawn(config(), AGENTS, createRng(7));
    expect(events).toEqual(v1SpawnEvents(state));
    expect(events.map((event) => [event.kind, event.tick])).toEqual(AGENTS.map(() => ["Spawn", 0]));
    for (const event of events) expect(battleRoyale.events.parse(event)).toEqual(event);
  });

  it("rounds a Spawn's position to 2 decimals and its facing to 1, in (-180, 180] (R10)", () => {
    const odd = createBattleRoyale([{ ...map1, id: "odd", spawns: [{ x: 4.004, y: 50 }, { x: 96.004, y: 4 }] }]);
    const { state, events } = odd.spawn(config({ mapId: "odd", seed: 1 }), ["a0", "a1"], createRng(1));
    expect(events.map((e) => (e.kind === "Spawn" ? e.pos : null))).toEqual(
      expect.arrayContaining([
        { x: 4, y: 50 },
        { x: 96, y: 4 },
      ]),
    );
    expect(events.map((e) => (e.kind === "Spawn" ? e.facing : null))).toEqual(state.agents.map((a) => normalizeDeg(roundTo(a.facing, 1))));
    expect(events).toEqual(v1SpawnEvents(state));
  });
});

describe("battleRoyale.perceive and step: the kit's (DESIGN.md §5.2)", () => {
  it("perceives as the kit does", () => {
    const { state } = battleRoyale.spawn(config(), AGENTS, createRng(7));
    for (const id of AGENTS) expect(battleRoyale.perceive(state, id)).toEqual(perceive(state, id));
  });

  it("steps as the kit does, with the same Shot, Hit and Death events, which parse as the arena's events", () => {
    const worlds = busyWorlds(40);
    let events = 0;
    const kinds = new Set<string>();
    for (let t = 1; t < worlds.length; t++) {
      const actions = Object.fromEntries(worlds[t - 1]!.agents.map((agent) => [agent.id, agent.action]));
      const mine = battleRoyale.step(worlds[t - 1]!, actions);
      expect(mine).toEqual(step(worlds[t - 1]!, actions));
      for (const event of mine.events) {
        expect(battleRoyale.events.parse(event)).toEqual(event);
        kinds.add(event.kind);
        events++;
      }
    }
    expect(events).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(["Hit", "Shot"]);
  });

  it("refuses an event of a kind it does not have, or one missing a field", () => {
    expect(battleRoyale.events.safeParse({ kind: "Doer", tick: 1, agent: "a0", ok: true }).success).toBe(false);
    expect(battleRoyale.events.safeParse({ kind: "Shot", tick: 1, agent: "a0" }).success).toBe(false);
    expect(battleRoyale.events.safeParse({ kind: "Death", tick: 3, agent: "a2", killer: "a0" }).success).toBe(true);
  });
});

describe("battleRoyale.tick: the version-1 Tick rows as Tick.data (R10, R24, ISSUES I-016)", () => {
  it("equals the version-1 writer's rows, tick for tick, for a stepped world", () => {
    let near = 0;
    for (const world of busyWorlds(60)) {
      const { kind, tick, ...rows } = v1TickEvent(world);
      expect([kind, tick]).toEqual(["Tick", world.tick]);
      expect(battleRoyale.tick(world)).toEqual(rows);
      expect(JSON.stringify(battleRoyale.tick(world))).toBe(JSON.stringify(rows));
      if (rows.near) near++;
    }
    expect(near).toBeGreaterThan(0); // some ticks had near misses, so both shapes were compared
  });

  it("lists living agents as [id, x, y, facing, hp]: x and y to 2 decimals, facing to 1 in (-180, 180], hp whole; bullets as [id, x, y]", () => {
    const world = makeWorld({
      tick: 17,
      agents: [
        makeAgent(0, { x: 10.123, y: 50.456 }, 12.345, { hp: 80 }),
        makeAgent(1, { x: 30, y: 30 }, -179.96, { hp: 0, alive: false, deathTick: 12 }),
        makeAgent(2, { x: 0.001, y: 99.999 }, 179.96, { hp: 59.6 }),
      ],
      bullets: [makeBullet(4, "a0", { x: 20.004, y: 49.996 }, { x: 3, y: 0 }), makeBullet(7, "a2", { x: 1, y: 2 }, { x: 0, y: 3 })],
    });
    expect(battleRoyale.tick(world)).toEqual({
      agents: [
        ["a0", 10.12, 50.46, 12.3, 80],
        ["a2", 0, 100, 180, 60],
      ],
      bullets: [
        ["b4", 20, 50],
        ["b7", 1, 2],
      ],
    });
    expect(JSON.stringify(battleRoyale.tick(world))).not.toContain("near");
  });

  it("writes this tick's near misses as [target, fromX, fromY], only when there are some", () => {
    const world = makeWorld({ agents: [makeAgent(0, { x: 5, y: 5 })] });
    const before = { shots: [], hits: [], nearMisses: [{ target: "a0", from: { x: 7, y: 7 } }] };
    const now = { shots: [], hits: [], nearMisses: [{ target: "a0", from: { x: 30.006, y: 29.994 } }] };
    expect(battleRoyale.tick({ ...world, recent: [before, now] }).near).toEqual([["a0", 30.01, 29.99]]);
    expect(battleRoyale.tick({ ...world, recent: [now, { ...now, nearMisses: [] }] })).not.toHaveProperty("near");
  });

  it("parses with arena.tickData, and shares nothing with the world a later step builds on", () => {
    const [world] = busyWorlds(0);
    const data = battleRoyale.tick(world!);
    expect(battleRoyale.tickData.parse(data)).toEqual(data);
    data.agents[0]![1] = -1;
    expect(battleRoyale.tick(world!).agents[0]![1]).not.toBe(-1);
    expect(battleRoyale.tickData.safeParse({ agents: [["a0", 1, 2, 3]], bullets: [] }).success).toBe(false);
  });
});

describe("battleRoyale.active, ended and the ranking (R11, R24)", () => {
  const alive = (slot: number, kills = 0, hp = 100) => makeAgent(slot, { x: 10 * slot, y: 5 }, 0, { kills, hp });
  const dead = (slot: number, deathTick: number, kills = 0) => makeAgent(slot, { x: 10 * slot, y: 5 }, 0, { alive: false, hp: 0, deathTick, kills });

  it("asks the living agents, in slot order", () => {
    expect(battleRoyale.active(makeWorld({ agents: [alive(0), dead(1, 4), alive(2), alive(3)] }))).toEqual(["a0", "a2", "a3"]);
  });

  it("goes on while two or more are alive before durationTicks", () => {
    expect(battleRoyale.ended(makeWorld({ tick: 5999, agents: [alive(0), dead(1, 4), alive(2)] }))).toBeNull();
  });

  it("ends when at most one is alive, ranked survival first, with no per-agent results", () => {
    const outcome = battleRoyale.ended(makeWorld({ tick: 300, agents: [dead(0, 120, 2), alive(1, 1, 40), dead(2, 299, 0)] }));
    expect(outcome).toEqual({ ranking: ["a1", "a2", "a0"] });
    expect(outcome).not.toHaveProperty("results");
    expect(battleRoyale.ended(makeWorld({ tick: 9, agents: [dead(0, 9, 0), dead(1, 9, 1)] }))).toEqual({ ranking: ["a1", "a0"] });
  });

  it("ends at durationTicks with everyone alive ranked by kills, then HP, then slot", () => {
    expect(battleRoyale.ended(makeWorld({ tick: 6000, agents: [alive(0, 0, 100), alive(1, 1, 40), alive(2, 1, 80)] }))).toEqual({
      ranking: ["a2", "a1", "a0"],
    });
  });

  it("rankAgents: the living by kills, then HP, then slot; then the dead by death tick (latest first), kills, slot", () => {
    const agents = [
      makeAgent(0, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
      makeAgent(1, { x: 0, y: 0 }, 0, { kills: 1, hp: 40 }),
      makeAgent(2, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 900, kills: 0 }),
      makeAgent(3, { x: 0, y: 0 }, 0, { kills: 2, hp: 20 }),
      makeAgent(4, { x: 0, y: 0 }, 0, { kills: 1, hp: 80 }),
      makeAgent(5, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 3 }),
      makeAgent(6, { x: 0, y: 0 }, 0, { kills: 1, hp: 40 }),
      makeAgent(7, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
      makeAgent(10, { x: 0, y: 0 }, 0, { alive: false, hp: 0, deathTick: 300, kills: 1 }),
    ];
    expect(rankAgents(agents)).toEqual(["a3", "a4", "a1", "a6", "a2", "a5", "a0", "a7", "a10"]);
  });
});

describe("createBattleRoyale: the same arena with extra maps (tests' open ground)", () => {
  it("lists them after the bundled maps, accepts them in the config and spawns on them", () => {
    const arena = createBattleRoyale([OPEN]);
    expect(arena.maps).toEqual([...MAP_IDS, "open"]);
    expect(arena.config.parse(config({ mapId: "open" })).mapId).toBe("open");
    const { state } = arena.spawn(config({ mapId: "open" }), ["a0", "a1"], createRng(3));
    expect(state.map).toBe(OPEN);
    expect(battleRoyale.config.safeParse(config({ mapId: "open" })).success).toBe(false);
  });
});
