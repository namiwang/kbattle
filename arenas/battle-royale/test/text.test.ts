import { getMap, type Observation } from "@decision-arena/kit-shooter";
import { describe, expect, it } from "vitest";
import { battleRoyale } from "../src";

// What the planner reads (DESIGN.md row 48, §5.3; ruling R24): the static text
// every agent knows before the match (the map and the rules in a few lines) and
// one observation as text (the models package's formatObservation, moved here;
// its cases are carried over below).

const config = (mapId: string, durationTicks = 6000) => ({ seed: 1, durationTicks, mapId });

describe("battleRoyale.staticText (row 48)", () => {
  it.each(["map-1", "map-2"])("fits in 1,200 characters on %s", (mapId) => {
    expect(battleRoyale.staticText(config(mapId)).length).toBeLessThanOrEqual(1200);
  });

  it.each(["map-1", "map-2"])("names %s, its size, every obstacle corner and every spawn", (mapId) => {
    const map = getMap(mapId);
    const text = battleRoyale.staticText(config(mapId));
    expect(text).toContain(mapId);
    expect(text).toContain(`${map.width} × ${map.height} m`);
    for (const { vertices } of map.obstacles) expect(text).toContain(vertices.map(({ x, y }) => `(${x},${y})`).join(" "));
    expect(text).toContain(map.spawns.map(({ x, y }) => `(${x},${y})`).join(" "));
  });

  it("states the rules: how to win and rank, the length, hp and damage, movement, weapon, sight and hearing", () => {
    const text = battleRoyale.staticText(config("map-1", 1200));
    for (const rule of [
      "last agent alive wins",
      "survival, then kills, then hp",
      "after 60 s",
      "100 hp",
      "a hit costs 20",
      "5 m/s",
      "180°/s",
      "2 shots a second",
      "60 m/s",
      "3°",
      "45° of your facing",
      "60 m",
      "80 m",
      "15 m",
    ]) {
      expect(text, rule).toContain(rule);
    }
  });

  it("explains the frame: x right, y down, angles clockwise from +x", () => {
    expect(battleRoyale.staticText(config("map-1"))).toMatch(/y down.*0° is \+x.*clockwise/s);
  });

  it("depends only on the config", () => {
    expect(battleRoyale.staticText(config("map-2", 400))).toBe(battleRoyale.staticText({ ...config("map-2", 400), seed: 99 }));
    expect(battleRoyale.staticText(config("map-1"))).not.toBe(battleRoyale.staticText(config("map-2")));
  });
});

// Carried from platform/models/test/thinker-prompt.test.ts (formatObservation).
const OBS: Observation = {
  self: { pos: { x: 22.53, y: 61.4 }, facing: -30.4, hp: 72, kills: 1, secondsLeft: 240 },
  visible: [
    { id: "a3", bearing: -12, dist: 38, moving: true },
    { id: "a7", bearing: 20, dist: 51, moving: false },
  ],
  heard: [
    { kind: "shot", bearing: 140, dist: "far" },
    { kind: "steps", bearing: -90, dist: "near" },
  ],
  incoming: [{ bearing: 95 }, { bearing: -170 }],
};

describe("battleRoyale.observationText (the models package's formatObservation)", () => {
  it("writes one line each for self, visible, heard and incoming", () => {
    expect(battleRoyale.observationText(OBS)).toBe(
      [
        "self: at (23, 61), facing -30°, hp 72, kills 1",
        "visible: a3 at -12° 38 m moving; a7 at 20° 51 m",
        "heard: shot at 140° far; steps at -90° near",
        "incoming: from 95°; from -170°",
      ].join("\n"),
    );
  });

  it("says none for what was not perceived", () => {
    const quiet: Observation = { ...OBS, visible: [], heard: [], incoming: [] };
    expect(battleRoyale.observationText(quiet).split("\n").slice(1)).toEqual(["visible: none", "heard: none", "incoming: none"]);
  });

  it("is deterministic: keeps perception's order (nearest first) and ignores key order", () => {
    const reordered: Observation = {
      incoming: [{ bearing: 95 }, { bearing: -170 }],
      heard: [
        { dist: "far", bearing: 140, kind: "shot" },
        { dist: "near", bearing: -90, kind: "steps" },
      ],
      visible: [
        { moving: true, dist: 38, bearing: -12, id: "a3" },
        { moving: false, dist: 51, bearing: 20, id: "a7" },
      ],
      self: { secondsLeft: 240, kills: 1, hp: 72, facing: -30.4, pos: { y: 61.4, x: 22.53 } },
    };
    expect(battleRoyale.observationText(reordered)).toBe(battleRoyale.observationText(OBS));
    expect(battleRoyale.observationText(OBS)).toBe(battleRoyale.observationText(structuredClone(OBS)));
  });

  it("rounds to whole meters and degrees, keeping angles in (-180, 180]", () => {
    const edge: Observation = {
      self: { pos: { x: -0.4, y: 99.5 }, facing: -179.6, hp: 100, kills: 0, secondsLeft: 300 },
      visible: [{ id: "a1", bearing: -179.7, dist: 12.4, moving: false }],
      heard: [],
      incoming: [],
    };
    expect(battleRoyale.observationText(edge).split("\n").slice(0, 2)).toEqual(["self: at (0, 100), facing 180°, hp 100, kills 0", "visible: a1 at 180° 12 m"]);
  });
});
