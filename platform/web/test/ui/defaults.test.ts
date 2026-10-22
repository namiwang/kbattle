import { PromptsSchema } from "@decision-arena/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_PROMPTS } from "../../src/ui/defaults";

describe("DEFAULT_PROMPTS", () => {
  it("is a valid Prompts", () => {
    expect(PromptsSchema.parse(DEFAULT_PROMPTS)).toEqual(DEFAULT_PROMPTS);
  });

  // A blank user instruction falls back to the shipped default (ISSUES I-005), and Clef
  // rejects empty instructions, so the defaults themselves can never be blank.
  it("fills in the thinker prompt and all four doer instructions", () => {
    const { thinkerSystem, doerInstructions } = DEFAULT_PROMPTS;
    expect(thinkerSystem.trim()).not.toBe("");
    expect(Object.keys(doerInstructions).sort()).toEqual(["fire", "move", "target", "turn"]);
    for (const text of Object.values(doerInstructions)) expect(text.trim()).not.toBe("");
  });
});

describe("the defaults are shared, so they cannot be changed in place", () => {
  it("throws on a write to the prompts or the config", () => {
    expect(() => {
      (DEFAULT_PROMPTS.doerInstructions as { move: string }).move = "changed";
    }).toThrow(TypeError);
    expect(() => {
      (DEFAULT_PROMPTS as { thinkerSystem: string }).thinkerSystem = "changed";
    }).toThrow(TypeError);
    expect(() => {
      (DEFAULT_CONFIG as { seed: number }).seed = 2;
    }).toThrow(TypeError);
  });
});
