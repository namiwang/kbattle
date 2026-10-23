// "Since your last call" (DESIGN.md §5.4): a text digest of what the agent perceived
// since the last thinker call, built only from its observations (principle 3).
import { describe, expect, it } from "vitest";
import type { Observation } from "@decision-arena/kit-shooter";
import { createDigest, DIGEST_MAX_CHARS } from "../src/event-digest";

type ObservationPatch = Partial<Omit<Observation, "self">> & { self?: Partial<Observation["self"]> };

/** An agent at (50, 50) facing +x with full hp that perceives nothing, changed by `patch`. */
function obs({ self, ...rest }: ObservationPatch = {}): Observation {
  return {
    self: { pos: { x: 50, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 300, ...self },
    visible: [],
    heard: [],
    incoming: [],
    ...rest,
  };
}

const enemy = (id: string, bearing: number, dist: number) => ({ id, bearing, dist, moving: false });

describe("createDigest", () => {
  it("is empty until something happens", () => {
    const digest = createDigest();
    expect(digest.build()).toBe("");

    digest.note(1, obs());
    digest.note(11, obs());
    expect(digest.build()).toBe("");
  });

  it("reports the hp lost since the window started", () => {
    const digest = createDigest();
    digest.note(1, obs());
    digest.note(11, obs({ self: { hp: 80 } }));
    digest.note(21, obs({ self: { hp: 60 } }));

    expect(digest.build()).toBe("lost 40 hp (100 -> 60)");
  });

  it("reports the kills gained", () => {
    const digest = createDigest();
    digest.note(1, obs({ self: { kills: 1 } }));
    digest.note(11, obs({ self: { kills: 3 } }));

    expect(digest.build()).toBe("killed 2 (3 in total)");
  });

  it("counts incoming fire, and shots heard by band; footsteps are left out", () => {
    const digest = createDigest();
    digest.note(1, obs({
      incoming: [{ bearing: 95 }],
      heard: [
        { kind: "shot", bearing: 10, dist: "near" },
        { kind: "steps", bearing: 40, dist: "near" },
        { kind: "shot", bearing: 140, dist: "far" },
      ],
    }));
    digest.note(11, obs({ incoming: [{ bearing: -10 }, { bearing: 20 }], heard: [{ kind: "shot", bearing: 150, dist: "far" }] }));

    expect(digest.build()).toBe("incoming fire 3 times\nheard shots: 1 near, 2 far");
  });

  it("lists each enemy once, at its last sighting, newest first, with how many ticks ago", () => {
    const digest = createDigest();
    digest.note(1, obs({ visible: [enemy("a3", 0, 10), enemy("a5", 30, 20)] }));
    digest.note(11, obs({ visible: [enemy("a5", 30, 20)] }));
    digest.note(21, obs());

    expect(digest.build()).toBe("a5 seen 10 ticks ago at 30°, 20 m\na3 seen 20 ticks ago at 0°, 10 m");
  });

  it("gives a sighting's bearing and distance from where the agent is and faces now", () => {
    const digest = createDigest();
    digest.note(1, obs({ visible: [enemy("a3", 0, 10)] })); // a3 stood at (60, 50)
    digest.note(11, obs({ self: { facing: 90 } })); // turned to face +y

    expect(digest.build()).toBe("a3 seen 10 ticks ago at -90°, 10 m");

    digest.note(21, obs({ self: { pos: { x: 60, y: 40 }, facing: 90 } })); // walked to 10 m north of it

    expect(digest.build()).toBe("a3 seen 20 ticks ago at 0°, 10 m");
  });

  it("puts hp, kills, incoming fire and shots first, then the sightings", () => {
    const digest = createDigest();
    digest.note(1, obs({ visible: [enemy("a3", 0, 10)] }));
    digest.note(11, obs({
      self: { hp: 80, kills: 1 },
      incoming: [{ bearing: 95 }],
      heard: [{ kind: "shot", bearing: 95, dist: "mid" }],
    }));

    expect(digest.build().split("\n")).toEqual([
      "lost 20 hp (100 -> 80)",
      "killed 1 (1 in total)",
      "incoming fire 1 time",
      "heard shots: 1 mid",
      "a3 seen 10 ticks ago at 0°, 10 m",
    ]);
  });

  it("starts a new window on reset(): counts and sightings clear, hp and kills count from there", () => {
    const digest = createDigest();
    digest.note(1, obs());
    digest.note(11, obs({ self: { hp: 80 }, incoming: [{ bearing: 95 }], visible: [enemy("a3", 0, 10)] }));
    digest.reset();

    expect(digest.build()).toBe("");

    digest.note(21, obs({ self: { hp: 60, kills: 1 } }));

    expect(digest.build()).toBe("lost 20 hp (80 -> 60)\nkilled 1 (1 in total)");
  });

  it("cuts to maxChars on a line boundary, dropping the oldest sightings first", () => {
    const digest = createDigest();
    for (let i = 1; i <= 15; i += 1) digest.note(i * 10, obs({ visible: [enemy(`a${i}`, i, 10 + i)] }));
    digest.note(160, obs({ self: { hp: 40 } }));
    const full = digest.build(Number.POSITIVE_INFINITY);
    const cut = digest.build(100);

    expect(full.split("\n")).toHaveLength(16);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(full.startsWith(`${cut}\n`)).toBe(true);
    expect(cut.length + 1 + (full.slice(cut.length + 1).split("\n")[0] ?? "").length).toBeGreaterThan(100);
    expect(cut.split("\n")[0]).toBe("lost 60 hp (100 -> 40)");
    expect(cut.split("\n")[1]).toBe("a15 seen 10 ticks ago at 15°, 25 m");
  });

  it("stays within DIGEST_MAX_CHARS (800) by default", () => {
    const digest = createDigest();
    for (let i = 1; i <= 15; i += 1) {
      digest.note(i * 10, obs({ self: { hp: 100 - i }, visible: [enemy(`a${i}`, -170 + i, 50 + i)] }));
    }
    for (let i = 1; i <= 15; i += 1) digest.note(200 + i * 10, obs({ visible: [enemy(`a${i + 15}`, i, 30)] }));

    expect(DIGEST_MAX_CHARS).toBe(800);
    expect(digest.build(Number.POSITIVE_INFINITY).length).toBeGreaterThan(DIGEST_MAX_CHARS);
    expect(digest.build().length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
  });
});
