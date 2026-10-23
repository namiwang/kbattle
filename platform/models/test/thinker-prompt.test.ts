// The thinker's prompt text (DESIGN.md §5.4): the observation as text lines, the
// system prompt (harness, then the user's prompt) and the per-call user message.
import { describe, expect, it } from "vitest";
import type { Observation } from "@decision-arena/kit-shooter";
import { DIGEST_MAX_CHARS } from "../src/event-digest";
import { PLAN_REPLY_CHARS } from "../src/schemas";
import { buildSystem, buildUserMessage, estimateTokens, formatObservation, HARNESS_PROMPT } from "../src/thinker-prompt";

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

describe("formatObservation", () => {
  it("writes one line each for self, visible, heard and incoming", () => {
    expect(formatObservation(OBS)).toBe(
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

    expect(formatObservation(quiet).split("\n").slice(1)).toEqual(["visible: none", "heard: none", "incoming: none"]);
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

    expect(formatObservation(reordered)).toBe(formatObservation(OBS));
    expect(formatObservation(OBS)).toBe(formatObservation(structuredClone(OBS)));
  });

  it("rounds to whole meters and degrees, keeping angles in (-180, 180]", () => {
    const edge: Observation = {
      self: { pos: { x: -0.4, y: 99.5 }, facing: -179.6, hp: 100, kills: 0, secondsLeft: 300 },
      visible: [{ id: "a1", bearing: -179.7, dist: 12.4, moving: false }],
      heard: [],
      incoming: [],
    };

    expect(formatObservation(edge).split("\n").slice(0, 2)).toEqual([
      "self: at (0, 100), facing 180°, hp 100, kills 0",
      "visible: a1 at 180° 12 m",
    ]);
  });
});

describe("HARNESS_PROMPT", () => {
  it("fits in 2,500 characters", () => {
    expect(HARNESS_PROMPT.length).toBeLessThanOrEqual(2500);
  });

  it("states the exact JSON contract and asks for the JSON alone", () => {
    expect(HARNESS_PROMPT).toContain('{"text": string ≤ 600 chars, "scratchpad": string ≤ 1200 chars}');
    expect(HARNESS_PROMPT).toMatch(/output only the JSON/i);
  });

  it("names every section of the user message and every observation line", () => {
    for (const name of ["Now", "Current plan", "Since your last call", "Scratchpad"]) {
      expect(HARNESS_PROMPT).toContain(name);
    }
    for (const label of ["self:", "visible:", "heard:", "incoming:"]) {
      expect(HARNESS_PROMPT).toContain(label);
    }
  });

  it("says the plan reaches the doer verbatim at every decision and the scratchpad is private memory", () => {
    expect(HARNESS_PROMPT).toMatch(/verbatim/);
    expect(HARNESS_PROMPT).toMatch(/every decision/);
    expect(HARNESS_PROMPT).toMatch(/private/);
  });
});

describe("buildSystem", () => {
  it("puts the harness first, then the user's prompt under its own heading", () => {
    expect(buildSystem({ thinkerSystem: "Play it safe." })).toBe(`${HARNESS_PROMPT}\n\n# Your instructions\nPlay it safe.`);
  });
});

describe("estimateTokens", () => {
  it("counts a token per four characters, rounding up", () => {
    expect([estimateTokens(""), estimateTokens("abcd"), estimateTokens("abcde")]).toEqual([0, 1, 2]);
  });
});

describe("buildUserMessage", () => {
  const TURN = {
    tick: 1201,
    observation: OBS,
    plan: "Hold the east wall.",
    scratchpad: "a3 likes the gap.",
    digest: "lost 20 hp (92 -> 72)",
  };

  it("writes Now, Current plan, Since your last call and Scratchpad, in that order", () => {
    expect(buildUserMessage(TURN)).toBe(
      [
        "# Now (tick 1201, 240s left)",
        formatObservation(OBS),
        "",
        "# Current plan",
        "Hold the east wall.",
        "",
        "# Since your last call",
        "lost 20 hp (92 -> 72)",
        "",
        "# Scratchpad",
        "a3 likes the gap.",
      ].join("\n"),
    );
  });

  it("marks an empty plan, digest and scratchpad instead of leaving a section blank", () => {
    const text = buildUserMessage({ ...TURN, plan: "", digest: " ", scratchpad: "" });

    expect(text).toContain("# Current plan\n(none yet)\n");
    expect(text).toContain("# Since your last call\n(nothing new)\n");
    expect(text.endsWith("# Scratchpad\n(empty)")).toBe(true);
  });

  it("shows the time left to a tenth of a second", () => {
    const observation = { ...OBS, self: { ...OBS.self, secondsLeft: 12.46 } };

    expect(buildUserMessage({ ...TURN, tick: 5751, observation }).split("\n")[0]).toBe("# Now (tick 5751, 12.5s left)");
  });
});

describe("thinker input budget (DESIGN.md §5.4: under 1,500 tokens)", () => {
  /** `n` characters of prose. */
  const prose = (n: number) => "Hold the east wall, watch the gap, fall back north under 40 hp. ".repeat(40).slice(0, n);

  // The busiest plausible call: four enemies in view, six sounds, three bullets
  // incoming, with the widest numbers perception can produce.
  const BUSY: Observation = {
    self: { pos: { x: 87.46, y: 12.04 }, facing: -135.5, hp: 100, kills: 12, secondsLeft: 299.5 },
    visible: [
      { id: "a12", bearing: -44, dist: 58, moving: true },
      { id: "a13", bearing: -38, dist: 59, moving: true },
      { id: "a14", bearing: 41, dist: 59, moving: true },
      { id: "a15", bearing: 45, dist: 60, moving: true },
    ],
    heard: [
      { kind: "shot", bearing: -178, dist: "near" },
      { kind: "shot", bearing: -165, dist: "near" },
      { kind: "shot", bearing: 172, dist: "far" },
      { kind: "steps", bearing: -147, dist: "near" },
      { kind: "steps", bearing: 133, dist: "near" },
      { kind: "steps", bearing: -112, dist: "near" },
    ],
    incoming: [{ bearing: -178 }, { bearing: 179 }, { bearing: -101 }],
  };

  // Each input at its cap: the plan and scratchpad at the lengths the harness asks
  // for, the digest at DIGEST_MAX_CHARS, and a 1,500-character user prompt (v3.4).
  const system = buildSystem({ thinkerSystem: prose(1500) });
  const user = buildUserMessage({
    tick: 5990,
    observation: BUSY,
    plan: prose(PLAN_REPLY_CHARS.text),
    scratchpad: prose(PLAN_REPLY_CHARS.scratchpad),
    digest: prose(DIGEST_MAX_CHARS),
  });

  it("uses the caps the harness asks for: a 600-character plan, a 1,200-character scratchpad, an 800-character digest", () => {
    expect([PLAN_REPLY_CHARS.text, PLAN_REPLY_CHARS.scratchpad, DIGEST_MAX_CHARS]).toEqual([600, 1200, 800]);
    expect(formatObservation(BUSY).split("\n").map((line) => line.split(";").length)).toEqual([1, 4, 6, 3]);
  });

  it("keeps the system prompt plus the busiest user message within 1,500 tokens", () => {
    expect(estimateTokens(system) + estimateTokens(user)).toBeLessThanOrEqual(1500);
  });
});
