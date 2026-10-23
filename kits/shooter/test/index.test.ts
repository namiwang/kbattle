import * as legacy from "@decision-arena/core/legacy";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as kit from "../src/index";

describe("@decision-arena/kit-shooter entry point", () => {
  it("exposes the vector helpers under the vec2 namespace", () => {
    expect(kit.vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(kit.vec2.fromAngle(90).y).toBe(1);
  });

  it("re-exports angles, units, the shooter constants, STOP_ACTION, the choice lists and the maps", () => {
    expect(kit.normalizeDeg(-180)).toBe(180);
    expect(kit.bearingTo({ x: 0, y: 0 }, 0, { x: 0, y: 10 })).toBe(90);
    expect(kit.mpsToMetersPerTick(kit.MOVE_SPEED_MPS)).toBe(0.25);
    expect(kit.STOP_ACTION.move).toBe("stop");
    expect(kit.MOVE_CHOICES).toContain("forward");
    expect(kit.TURN_CHOICES).toContain("face_target");
    // core/legacy keeps copies of the choice lists for the version-1 schemas (ruling R20): they agree.
    expect([kit.MOVE_CHOICES, kit.TURN_CHOICES, kit.SOUND_KINDS, kit.HEARING_BANDS]).toEqual([
      legacy.MOVE_CHOICES,
      legacy.TURN_CHOICES,
      legacy.SOUND_KINDS,
      legacy.HEARING_BANDS,
    ]);
    expect(legacy.MoveChoiceSchema.options).toEqual(kit.MOVE_CHOICES);
    expect(kit.getMap("map-1").id).toBe("map-1");
    expect(kit.MAP_IDS).toContain("map-1");
  });

  it("runs the plan's demo: schemas.MatchLog.parse on the sample log", () => {
    const raw: unknown = JSON.parse(readFileSync(new URL("../fixtures/sample-log.json", import.meta.url), "utf8"));
    const log = legacy.schemas.MatchLog.parse(raw);
    expect(log.events.length).toBeGreaterThan(0);
    expect(legacy.eventsOfKind(log, "MatchEnd")).toHaveLength(1);
    expect(legacy.lastTick(log)).toBe(legacy.eventsOfKind(log, "MatchEnd")[0]?.tick);
  });

  it("exposes the sim: spawn and step", () => {
    const config: legacy.MatchConfig = {
      mapId: "map-1",
      seed: 1,
      durationTicks: 100,
      slots: [{ kind: "prompted" }, { kind: "bot", bot: "wanderer" }],
    };
    const world = kit.spawn(config, kit.getMap("map-1"));
    expect(world.agents.map((a) => a.id)).toEqual(["a0", "a1"]);
    const result: kit.StepResult = kit.step(world, {});
    expect(result.state.tick).toBe(1);
  });

  it("exposes the v1.2 sim surface: actionFromAnswers and the collision helpers", () => {
    const action = kit.actionFromAnswers({ fire: { type: "noul", noul: 0.9 } }, []);
    expect(action).toEqual({ move: "stop", turn: "none", fire: true, target: null });
    const map = kit.getMap("map-1");
    expect(kit.collision.hasLineOfSight({ x: 35, y: 24 }, { x: 65, y: 24 }, map.obstacles)).toBe(false);
    expect(kit.collision.segmentCircleT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)).toBeCloseTo(0.4, 12);
    const world = kit.spawn({ mapId: "map-1", seed: 1, durationTicks: 10, slots: [{ kind: "doer" }, { kind: "doer" }] }, map);
    const facts: kit.TickFacts[] = kit.step(world, {}).state.recent;
    expect([world.recent, facts]).toEqual([[], [{ shots: [], hits: [], nearMisses: [] }]]);
  });

  it("exposes the v1.3 perception: perceive on a world or on the PerceptionState subset", () => {
    const map = kit.getMap("map-1");
    const world = kit.spawn(
      { mapId: "map-1", seed: 1, durationTicks: 100, slots: [{ kind: "doer" }, { kind: "doer" }] },
      map,
    );
    const view: kit.Observation = kit.perceive(world, "a0");
    expect(view.self.secondsLeft).toBe(5);
    const agents = world.agents.map((a) => ({
      id: a.id,
      pos: a.pos,
      facing: a.facing,
      hp: a.hp,
      alive: a.alive,
      kills: a.kills,
      moved: a.moved,
    }));
    const subset: kit.PerceptionState = { ...world, agents };
    expect(kit.perceive(subset, "a0")).toEqual(view);
  });

  it("exposes the R0.4 surface: the perception window, spawnWorld, the step's event types and the bot minds", () => {
    expect(kit.PERCEPTION_WINDOW_TICKS).toBe(10);
    const world = kit.spawnWorld({ map: kit.getMap("map-1"), agents: ["a0", "a1"], durationTicks: 100, rng: { s: 1 } });
    expect(world.agents.map((a) => a.id)).toEqual(["a0", "a1"]);
    const events: kit.StepEvent[] = kit.step(world, {}).events;
    expect(events).toEqual([]);
    const shot: kit.ShotEvent = { kind: "Shot", tick: 1, agent: "a0", bullet: "b0" };
    const answers: kit.ActionAnswers = { fire: { noul: 1 } };
    expect([shot.kind, kit.actionFromAnswers(answers, []).fire]).toEqual(["Shot", true]);
    expect(kit.BOT_KINDS).toEqual(["wanderer", "camper"]);
    const mind: kit.BotMind = kit.makeBotMind("camper", 1, 0);
    const intent: kit.BotIntent = mind.decide(1, kit.perceive(world, "a0"));
    expect(intent.target).toBeNull();
    const setup: kit.SpawnConfig = { mapId: "map-1", seed: 1, durationTicks: 100, slots: [{}, {}] };
    expect(kit.spawn(setup, kit.getMap("map-1"))).toEqual(kit.spawnWorld({ map: kit.getMap("map-1"), agents: ["a0", "a1"], durationTicks: 100, rng: { s: 1 } }));
  });

  it("exposes the v1.4 surface: both maps, map checks, makeBot as a DecisionProvider", async () => {
    expect(kit.MAP_IDS).toEqual(["map-1", "map-2"]);
    expect(kit.validateMap(kit.getMap("map-2"))).toEqual([]);
    const spawns = [
      { x: 50, y: 24 },
      { x: 4, y: 4 },
    ];
    expect(() => kit.loadMap({ ...kit.getMap("map-1"), spawns })).toThrow(/inside obstacle 0/);
    const bot: kit.DecisionProvider = kit.makeBot("camper", 1, 0);
    const slots: legacy.Slot[] = [
      { kind: "bot", bot: "camper" },
      { kind: "bot", bot: "wanderer" },
    ];
    const world = kit.spawn({ mapId: "map-2", seed: 1, durationTicks: 100, slots }, kit.getMap("map-2"));
    const ctx: kit.DecisionContext = { tick: 1, agent: "a0", observation: kit.perceive(world, "a0"), plan: "", signal: new AbortController().signal };
    expect(legacy.DoerAnswerSchema.parse(await bot.decide(ctx)).model).toBe("bot:camper");
  });

  it("still exports the version-1 loop for the web until R0.5 (ruling R20): its tests moved to the battle royale arena in R0.4", () => {
    for (const name of ["runMatch", "rankAgents", "createLogWriter", "spawnEvents", "tickEvent", "makeReplayingProvider", "replayMatch", "botProviders", "makeBot"] as const) {
      expect(typeof kit[name], name).toBe("function");
    }
    const world = kit.spawn({ mapId: "map-2", seed: 3, durationTicks: 30, slots: [{}, {}] }, kit.getMap("map-2"));
    expect(kit.tickEvent(world)).toMatchObject({ kind: "Tick", tick: 0 });
  });
});
