import type { Prompts } from "@decision-arena/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_PROMPTS } from "../../src/ui/defaults";
import type { UiState } from "../../src/ui/state";
import { loadState, saveState } from "../../src/ui/storage";
import { fakeStorage } from "./fake-storage";

const KEY = "decision-arena:v1:anthropic-key";
const PROMPTS = "decision-arena:v1:prompts";
const CONFIG = "decision-arena:v1:config";

const DEFAULTS: UiState = { key: "", prompts: DEFAULT_PROMPTS, config: DEFAULT_CONFIG };

const saved: UiState = {
  key: "sk-ant-api03-test",
  prompts: {
    thinkerSystem: "Hide until two are left, then hunt.",
    doerInstructions: { move: "Hug the walls.", turn: "Face the gap.", fire: "", target: "The nearest one." },
  },
  config: { mapId: "arena-1", seed: 77, slots: 12, prompted: 2, doerOnly: 3, durationTicks: 2400 },
};

describe("saveState and loadState", () => {
  it("round-trip the key, the prompts and the match form", () => {
    const storage = fakeStorage();
    saveState(storage, saved);
    expect(loadState(storage)).toEqual(saved);
  });

  it("keep the key as plain text where the v0.6 spike page reads it, prompts and form as JSON", () => {
    const storage = fakeStorage();
    saveState(storage, saved);
    expect(storage.data.get(KEY)).toBe("sk-ant-api03-test");
    expect(JSON.parse(storage.data.get(PROMPTS) ?? "null")).toEqual(saved.prompts);
    expect(JSON.parse(storage.data.get(CONFIG) ?? "null")).toEqual(saved.config);
  });

  it("save only the parts they are given", () => {
    const storage = fakeStorage();
    saveState(storage, { prompts: saved.prompts });
    expect([...storage.data.keys()]).toEqual([PROMPTS]);
  });

  it("trim the key, and remove it when it is saved blank", () => {
    const storage = fakeStorage();
    saveState(storage, { key: "  sk-ant-api03-test \n" });
    expect(storage.data.get(KEY)).toBe("sk-ant-api03-test");
    saveState(storage, { key: " " });
    expect(storage.data.has(KEY)).toBe(false);
  });

  it("keep numbers the user typed even when out of range, so a reload shows the form as it was left", () => {
    const storage = fakeStorage();
    const config = { ...DEFAULT_CONFIG, seed: 1.5, slots: 40, prompted: 9 };
    saveState(storage, { config });
    expect(loadState(storage).config).toEqual(config);
  });
});

describe("loadState is tolerant", () => {
  it("gives the defaults for empty storage, or none at all", () => {
    expect(loadState(fakeStorage())).toEqual(DEFAULTS);
    expect(loadState(null)).toEqual(DEFAULTS);
  });

  it("gives the defaults for stored values that are not JSON or not an object", () => {
    for (const garbage of ["not json{", "[1,2]", "42", "null", '"text"', ""]) {
      const storage = fakeStorage({ [PROMPTS]: garbage, [CONFIG]: garbage });
      expect(loadState(storage), JSON.stringify(garbage)).toEqual(DEFAULTS);
    }
  });

  it("keeps the good fields of a partly bad value and defaults the rest", () => {
    const storage = fakeStorage({
      [PROMPTS]: JSON.stringify({
        thinkerSystem: "Mine.",
        doerInstructions: { move: 42, turn: "Turn left.", fire: "Fire.", target: "x".repeat(501) },
      }),
      [CONFIG]: JSON.stringify({ mapId: "atlantis", seed: 5, slots: "8", prompted: 2, doerOnly: null, durationTicks: 300 }),
    });
    const prompts: Prompts = {
      thinkerSystem: "Mine.",
      doerInstructions: {
        move: DEFAULT_PROMPTS.doerInstructions.move,
        turn: "Turn left.",
        fire: "Fire.",
        target: DEFAULT_PROMPTS.doerInstructions.target,
      },
    };
    expect(loadState(storage)).toEqual({
      key: "",
      prompts,
      config: { mapId: DEFAULT_CONFIG.mapId, seed: 5, slots: DEFAULT_CONFIG.slots, prompted: 2, doerOnly: DEFAULT_CONFIG.doerOnly, durationTicks: 300 },
    });
  });

  it("defaults a prompt over its length cap and a doerInstructions that is not an object", () => {
    const storage = fakeStorage({ [PROMPTS]: JSON.stringify({ thinkerSystem: "x".repeat(8001), doerInstructions: "move!" }) });
    expect(loadState(storage).prompts).toEqual(DEFAULT_PROMPTS);
  });

  it("defaults a number field the page saved as NaN (an emptied input)", () => {
    const storage = fakeStorage();
    saveState(storage, { config: { ...saved.config, seed: Number.NaN } });
    expect(loadState(storage).config).toEqual({ ...saved.config, seed: DEFAULT_CONFIG.seed });
  });

  it("drops keys it does not know", () => {
    const storage = fakeStorage({ [CONFIG]: JSON.stringify({ ...saved.config, zone: true }) });
    expect(loadState(storage).config).toEqual(saved.config);
  });

  it("trims a stored key", () => {
    expect(loadState(fakeStorage({ [KEY]: " sk-ant-api03-test\n" })).key).toBe("sk-ant-api03-test");
  });

  it("survives a storage that throws (blocked or full): loads the defaults, drops the writes", () => {
    const fail = () => {
      throw new Error("SecurityError: access denied");
    };
    const throwing = { getItem: fail, setItem: fail, removeItem: fail };
    expect(loadState(throwing)).toEqual(DEFAULTS);
    expect(() => saveState(throwing, saved)).not.toThrow();
    expect(() => saveState(throwing, { key: "" })).not.toThrow();
  });
});
