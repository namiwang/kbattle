import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as z from "zod";
import * as core from "../src/index";

describe("@kbattle/core entry point", () => {
  it("exposes the vector helpers under the vec2 namespace", () => {
    expect(core.vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(core.vec2.fromAngle(90).y).toBe(1);
  });

  it("re-exports angles, units, constants and STOP_ACTION", () => {
    expect(core.normalizeDeg(-180)).toBe(180);
    expect(core.bearingTo({ x: 0, y: 0 }, 0, { x: 0, y: 10 })).toBe(90);
    expect(core.mpsToMetersPerTick(core.MOVE_SPEED_MPS)).toBe(0.25);
    expect(core.THINKER_MODEL).toBe("claude-haiku-5-5");
    expect(core.STOP_ACTION.move).toBe("stop");
  });

  it("re-exports the choice lists, the schemas, the maps and the log helpers", () => {
    expect(core.MOVE_CHOICES).toContain("forward");
    expect(core.TURN_CHOICES).toContain("face_target");
    expect(core.schemas.MatchLog).toBe(core.MatchLogSchema);
    expect(core.MoveChoiceSchema.options).toEqual(core.MOVE_CHOICES);
    expect(core.getMap("arena-1").id).toBe("arena-1");
    expect(core.MAP_IDS).toContain("arena-1");
  });

  it("runs the plan's demo: schemas.MatchLog.parse on the sample log", () => {
    const raw: unknown = JSON.parse(readFileSync(new URL("../fixtures/sample-log.json", import.meta.url), "utf8"));
    const log = core.schemas.MatchLog.parse(raw);
    expect(log.events.length).toBeGreaterThan(0);
    expect(core.eventsOfKind(log, "MatchEnd")).toHaveLength(1);
    expect(core.lastTick(log)).toBe(core.eventsOfKind(log, "MatchEnd")[0]?.tick);
  });

  it("exposes the sim: seeded RNG, spawn and step", () => {
    const rng = core.createRng(1);
    expect(core.nextFloat(rng).value).toBe(0.3678755429573357);
    expect(core.nextUint32(rng).value).toBe(1580013426);
    const config: core.MatchConfig = {
      mapId: "arena-1",
      seed: 1,
      durationTicks: 100,
      slots: [{ kind: "prompted" }, { kind: "bot", bot: "wanderer" }],
    };
    const world = core.spawn(config, core.getMap("arena-1"));
    expect(world.agents.map((a) => a.id)).toEqual(["a0", "a1"]);
    const result: core.StepResult = core.step(world, {});
    expect(result.state.tick).toBe(1);
  });

  it("exposes the v1.2 sim surface: actionFromAnswers and the collision helpers", () => {
    const action = core.actionFromAnswers({ fire: { type: "noul", noul: 0.9 } }, []);
    expect(action).toEqual({ move: "stop", turn: "none", fire: true, target: null });
    const map = core.getMap("arena-1");
    expect(core.collision.hasLineOfSight({ x: 35, y: 24 }, { x: 65, y: 24 }, map.obstacles)).toBe(false);
    expect(core.collision.segmentCircleT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)).toBeCloseTo(0.4, 12);
    const facts: core.TickFacts = core.spawn(
      { mapId: "arena-1", seed: 1, durationTicks: 10, slots: [{ kind: "doer" }, { kind: "doer" }] },
      map,
    ).lastTick;
    expect(facts).toEqual({ shots: [], hits: [], nearMisses: [] });
  });

  it("exposes the v1.3 perception: perceive on a world or on the PerceptionState subset", () => {
    const map = core.getMap("arena-1");
    const world = core.spawn(
      { mapId: "arena-1", seed: 1, durationTicks: 100, slots: [{ kind: "doer" }, { kind: "doer" }] },
      map,
    );
    const view: core.Observation = core.perceive(world, "a0");
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
    const subset: core.PerceptionState = { ...world, agents };
    expect(core.perceive(subset, "a0")).toEqual(view);
  });

  it("exposes the v1.4 surface: both maps, map checks, makeBot as a DecisionProvider", async () => {
    expect(core.MAP_IDS).toEqual(["arena-1", "arena-2"]);
    expect(core.validateMap(core.getMap("arena-2"))).toEqual([]);
    const spawns = [
      { x: 50, y: 24 },
      { x: 4, y: 4 },
    ];
    expect(() => core.loadMap({ ...core.getMap("arena-1"), spawns })).toThrow(/inside obstacle 0/);
    const bot: core.DecisionProvider = core.makeBot("camper", 1, 0);
    const slots: core.Slot[] = [
      { kind: "bot", bot: "camper" },
      { kind: "bot", bot: "wanderer" },
    ];
    const world = core.spawn({ mapId: "arena-2", seed: 1, durationTicks: 100, slots }, core.getMap("arena-2"));
    const ctx: core.DecisionContext = { tick: 1, agent: "a0", observation: core.perceive(world, "a0"), plan: "" };
    expect(core.DoerAnswerSchema.parse(await bot.decide(ctx)).model).toBe("bot:camper");
  });

  it("exposes the v1.5 match loop: runMatch with bot providers, the log writer and its Tick rows", async () => {
    const config: core.MatchConfig = {
      mapId: "arena-2",
      seed: 3,
      durationTicks: 30,
      slots: [
        { kind: "bot", bot: "wanderer" },
        { kind: "bot", bot: "camper" },
      ],
    };
    const prompts: core.Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };
    const providers: core.ProviderFactory = core.botProviders(config.seed);
    const deps: core.RunMatchDeps = { providers, prompts };
    const log: core.MatchLog = await core.runMatch(config, deps);
    expect(core.MatchLogSchema.parse(log)).toEqual(log);
    expect(core.eventsOfKind(log, "MatchEnd")[0]?.ranking).toHaveLength(2);
    const world = core.spawn(config, core.getMap("arena-2"));
    const writer: core.LogWriter = core.createLogWriter(config, prompts);
    writer.spawn(world);
    expect(writer.log().events).toEqual([...core.spawnEvents(world), core.tickEvent(world)]);
    expect(core.rankAgents(world.agents)).toEqual(["a0", "a1"]);
  });

  it("exports each boundary type as z.infer of its schema", () => {
    expectTypeOf<core.MatchLog>().toEqualTypeOf<z.infer<typeof core.MatchLogSchema>>();
    expectTypeOf<core.DoerAnswer>().toEqualTypeOf<z.infer<typeof core.DoerAnswerSchema>>();
    expectTypeOf<core.DecideRequest>().toEqualTypeOf<z.infer<typeof core.DecideRequestSchema>>();
    expectTypeOf<core.Plan>().toEqualTypeOf<z.infer<typeof core.PlanSchema>>();
    expectTypeOf<core.MatchConfig>().toEqualTypeOf<z.infer<typeof core.MatchConfigSchema>>();
  });
});
