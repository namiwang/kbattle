import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as z from "zod";
import * as core from "../src/index";
import * as legacy from "../src/legacy/index";

describe("@decision-arena/core entry point", () => {
  it("exposes the seeded RNG, roundTo and the platform constants, and nothing of the shooter", () => {
    const rng = core.createRng(1);
    expect(core.nextFloat(rng).value).toBe(0.3678755429573357);
    expect(core.nextUint32(rng).value).toBe(1580013426);
    expect([core.roundTo(2.345678, 2), core.roundTo(-0.004, 2)]).toEqual([2.35, 0]);
    expect([core.TICK_MS, core.ACTOR_INTERVAL_TICKS, core.ESCALATE_THRESHOLD]).toEqual([50, 10, 0.7]);
    // The shooter lives in kits/shooter (ruling R23).
    for (const name of ["vec2", "getMap", "MAP_IDS", "spawn", "step", "perceive", "collision", "makeBot", "STOP_ACTION", "AGENT_HP", "FIRE_THRESHOLD"]) {
      expect(core, name).not.toHaveProperty(name);
    }
  });

  it("keeps the version-1 schemas, log helpers, choice lists and constants under ./legacy, each boundary type z.infer of its schema", () => {
    expect([legacy.DOER_INTERVAL_TICKS, legacy.THINKER_MODEL, legacy.MATCH_DURATION_TICKS]).toEqual([10, "claude-haiku-5-5", 6000]);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string> };
    expect(pkg.exports["./legacy"]).toBe("./src/legacy/index.ts");
    expect(legacy.schemas.MatchLog).toBe(legacy.MatchLogSchema);
    expect(legacy.MoveChoiceSchema.options).toEqual(legacy.MOVE_CHOICES);
    expect([legacy.TURN_CHOICES, legacy.SOUND_KINDS, legacy.HEARING_BANDS]).toEqual([
      ["left", "right", "none", "face_target"],
      ["shot", "steps"],
      ["near", "mid", "far"],
    ]);
    const log = legacy.MatchLogSchema.parse({
      version: 1,
      config: { mapId: "map-1", seed: 1, durationTicks: 10, slots: [{ kind: "doer" }, { kind: "doer" }] },
      seed: 1,
      prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
      events: [{ kind: "MatchEnd", tick: 4, ranking: [] }],
    });
    expect([legacy.eventsOfKind(log, "MatchEnd").length, legacy.lastTick(log)]).toEqual([1, 4]);
    expectTypeOf<legacy.MatchLog>().toEqualTypeOf<z.infer<typeof legacy.MatchLogSchema>>();
    expectTypeOf<legacy.DoerAnswer>().toEqualTypeOf<z.infer<typeof legacy.DoerAnswerSchema>>();
    expectTypeOf<legacy.DecideRequest>().toEqualTypeOf<z.infer<typeof legacy.DecideRequestSchema>>();
    expectTypeOf<legacy.Plan>().toEqualTypeOf<z.infer<typeof legacy.PlanSchema>>();
    expectTypeOf<legacy.MatchConfig>().toEqualTypeOf<z.infer<typeof legacy.MatchConfigSchema>>();
  });
});
