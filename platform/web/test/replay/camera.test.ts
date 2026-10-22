import { MatchLogSchema, type Event as LogEvent, type MatchLog } from "@decision-arena/core";
import { describe, expect, it } from "vitest";
import sampleJson from "../../../core/fixtures/sample-log.json" with { type: "json" };
import { cameraTransform, centerOn, followChoices, FREE } from "../../src/replay/camera";
import { makeTransform } from "../../src/replay/coords";
import { indexLog } from "../../src/replay/log-index";

describe("centerOn", () => {
  it("puts the followed point at the middle of the canvas", () => {
    expect(centerOn({ x: 26.5, y: 50 }, 6, 1000, 600).toPx({ x: 26.5, y: 50 })).toEqual({ x: 500, y: 300 });
    expect(centerOn({ x: 0, y: 0 }, 5, 800, 500).toPx({ x: 0, y: 0 })).toEqual({ x: 400, y: 250 });
    const t = centerOn({ x: 96, y: 4 }, 6.5, 640, 480);
    expect([t.offsetX, t.offsetY]).toEqual([320 - 96 * 6.5, 240 - 4 * 6.5]);
  });

  it("draws everything else at the scale's distance from the center, y down", () => {
    const t = centerOn({ x: 40, y: 60 }, 5, 800, 500);
    expect(t.scale).toBe(5);
    expect(t.toPx({ x: 50, y: 60 })).toEqual({ x: 450, y: 250 }); // 10 m to the right
    expect(t.toPx({ x: 40, y: 50 })).toEqual({ x: 400, y: 200 }); // 10 m up (y down: smaller y is higher)
  });

  it("slides the world by −d × scale when the agent moves d meters, so the agent stays put", () => {
    const before = centerOn({ x: 20, y: 50 }, 6, 1000, 600);
    const after = centerOn({ x: 20.25, y: 49.5 }, 6, 1000, 600);
    expect(after.offsetX - before.offsetX).toBeCloseTo(-0.25 * 6, 12);
    expect(after.offsetY - before.offsetY).toBeCloseTo(0.5 * 6, 12);
    expect(after.toPx({ x: 20.25, y: 49.5 })).toEqual({ x: 500, y: 300 });
  });
});

describe("cameraTransform", () => {
  const fit = makeTransform(100, 100, 1000, 640, 16);

  it("free: the arena as fitted, unchanged", () => {
    expect(cameraTransform(fit, null, 1000, 640)).toBe(fit);
  });

  it("following: the fit's zoom (it never zooms), centered on the agent", () => {
    const t = cameraTransform(fit, { x: 4, y: 50 }, 1000, 640);
    expect(t.scale).toBe(fit.scale);
    expect(t.toPx({ x: 4, y: 50 })).toEqual({ x: 500, y: 320 });
  });

  it("re-centers on every canvas shape, letterbox padding or not", () => {
    for (const [w, h, pad] of [
      [600, 900, 16],
      [1280, 720, 0],
      [333, 1001, 8],
    ] as const) {
      const fitted = makeTransform(100, 100, w, h, pad);
      const p = cameraTransform(fitted, { x: 73, y: 96 }, w, h).toPx({ x: 73, y: 96 });
      expect(p.x).toBeCloseTo(w / 2, 9);
      expect(p.y).toBeCloseTo(h / 2, 9);
    }
  });
});

describe("followChoices", () => {
  it("free first, then every spawned agent", () => {
    expect(FREE).toBe("free");
    expect(followChoices(indexLog(MatchLogSchema.parse(sampleJson)))).toEqual(["free", "a0", "a1"]);
  });

  it("lists all sixteen agents of a full match in slot order", () => {
    const events: LogEvent[] = Array.from({ length: 16 }, (_, i) => ({
      kind: "Spawn",
      tick: 0,
      agent: `a${i}`,
      pos: { x: 4 + 6 * i, y: 50 },
      facing: 0,
    }));
    const log: MatchLog = {
      version: 1,
      config: { mapId: "arena-1", seed: 1, durationTicks: 10, slots: Array.from({ length: 16 }, () => ({ kind: "doer" as const })) },
      seed: 1,
      prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
      events,
    };
    expect(followChoices(indexLog(log))).toEqual(["free", ...Array.from({ length: 16 }, (_, i) => `a${i}`)]);
  });
});
