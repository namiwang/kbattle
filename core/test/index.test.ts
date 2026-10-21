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

  it("exports each boundary type as z.infer of its schema", () => {
    expectTypeOf<core.MatchLog>().toEqualTypeOf<z.infer<typeof core.MatchLogSchema>>();
    expectTypeOf<core.DoerAnswer>().toEqualTypeOf<z.infer<typeof core.DoerAnswerSchema>>();
    expectTypeOf<core.DecideRequest>().toEqualTypeOf<z.infer<typeof core.DecideRequestSchema>>();
    expectTypeOf<core.Plan>().toEqualTypeOf<z.infer<typeof core.PlanSchema>>();
    expectTypeOf<core.MatchConfig>().toEqualTypeOf<z.infer<typeof core.MatchConfigSchema>>();
  });
});
