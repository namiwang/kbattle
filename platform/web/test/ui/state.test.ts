import { MatchConfigSchema, type Prompts, type Slot } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_PROMPTS } from "../../src/ui/defaults";
import {
  createStore,
  effectiveConfig,
  formatFormResult,
  slotsFor,
  toMatchConfig,
  validateForm,
  type MatchForm,
  type UiState,
} from "../../src/ui/state";
import { fakeStorage } from "./fake-storage";

const P: Slot = { kind: "prompted" };
const D: Slot = { kind: "doer" };
const W: Slot = { kind: "bot", bot: "wanderer" };
const C: Slot = { kind: "bot", bot: "camper" };

const form = (patch: Partial<MatchForm> = {}): MatchForm => ({
  mapId: "map-1",
  seed: 1,
  slots: 8,
  prompted: 1,
  doerOnly: 0,
  durationTicks: 6000,
  ...patch,
});

const issuePaths = (result: { ok: boolean; issues?: { path: string }[] }) => (result.issues ?? []).map((i) => i.path);

describe("slotsFor", () => {
  it("lays out 8/1/0 as one prompted slot and seven bots alternating wanderer, camper", () => {
    expect(slotsFor(8, 1, 0)).toEqual([P, W, C, W, C, W, C, W]);
  });

  it("lays out 4/0/4 as four doer-only slots", () => {
    expect(slotsFor(4, 0, 4)).toEqual([D, D, D, D]);
  });

  it("puts prompted slots first, then doer-only, then the bots", () => {
    expect(slotsFor(6, 2, 1)).toEqual([P, P, D, W, C, W]);
    expect(slotsFor(16, 0, 0)).toEqual([W, C, W, C, W, C, W, C, W, C, W, C, W, C, W, C]);
  });

  it("throws on counts that are negative, fractional or do not fit", () => {
    expect(() => slotsFor(8, 5, 4)).toThrow(RangeError);
    expect(() => slotsFor(8, -1, 0)).toThrow(RangeError);
    expect(() => slotsFor(8, 0, -1)).toThrow(RangeError);
    expect(() => slotsFor(8, 1.5, 0)).toThrow(RangeError);
    expect(() => slotsFor(7.5, 1, 0)).toThrow(RangeError);
  });
});

describe("toMatchConfig", () => {
  it("builds the MatchConfig of a valid form", () => {
    const result = toMatchConfig({ mapId: "map-1", seed: 42, slots: 5, prompted: 1, doerOnly: 2, durationTicks: 1200 });
    expect(result).toEqual({
      ok: true,
      value: { mapId: "map-1", seed: 42, durationTicks: 1200, slots: [P, D, D, W, C] },
    });
  });

  it("accepts the default form: row 23's 8 slots, 1 prompted, 7 bots, a MatchConfig core accepts", () => {
    const result = toMatchConfig(DEFAULT_CONFIG);
    expect(result).toEqual({
      ok: true,
      value: { mapId: "map-1", seed: 1, durationTicks: 6000, slots: [P, W, C, W, C, W, C, W] },
    });
    if (result.ok) expect(MatchConfigSchema.parse(result.value)).toEqual(result.value);
  });

  it("reports more prompted slots than slots on `prompted`, with both numbers", () => {
    const result = toMatchConfig(form({ slots: 8, prompted: 9 }));
    expect(result).toEqual({ ok: false, issues: [{ path: "prompted", message: expect.stringMatching(/\b9\b.*\b8\b/) }] });
  });

  it("reports prompted plus doer-only slots beyond the slot count on `doerOnly`", () => {
    const result = toMatchConfig(form({ slots: 8, prompted: 1, doerOnly: 8 }));
    expect(result).toEqual({ ok: false, issues: [{ path: "doerOnly", message: expect.stringMatching(/\b1\b.*\b8\b.*\b8\b/) }] });
  });

  it("accepts prompted plus doer-only slots that exactly fill the match", () => {
    expect(toMatchConfig(form({ slots: 4, prompted: 2, doerOnly: 2 }))).toMatchObject({ ok: true, value: { slots: [P, P, D, D] } });
  });

  it("reports a seed that is not a whole number from 0 to 2^32 - 1", () => {
    for (const seed of [1.5, Number.NaN, -1, 2 ** 32, Number.POSITIVE_INFINITY]) {
      expect(issuePaths(toMatchConfig(form({ seed }))), `seed ${seed}`).toEqual(["seed"]);
    }
    expect(toMatchConfig(form({ seed: 0 })).ok).toBe(true);
    expect(toMatchConfig(form({ seed: 2 ** 32 - 1 })).ok).toBe(true);
  });

  it("keeps the slot count to 4..16 (row 6), although MatchConfig allows 2 for headless tests", () => {
    for (const slots of [3, 17, 2, 8.5, Number.NaN]) {
      expect(issuePaths(toMatchConfig(form({ slots, prompted: 0 }))), `slots ${slots}`).toEqual(["slots"]);
    }
    expect(toMatchConfig(form({ slots: 4 })).ok).toBe(true);
    expect(toMatchConfig(form({ slots: 16 })).ok).toBe(true);
  });

  it("reports counts that are negative or not whole numbers", () => {
    expect(issuePaths(toMatchConfig(form({ prompted: -1 })))).toEqual(["prompted"]);
    expect(issuePaths(toMatchConfig(form({ doerOnly: 0.5 })))).toEqual(["doerOnly"]);
    expect(issuePaths(toMatchConfig(form({ doerOnly: Number.NaN })))).toEqual(["doerOnly"]);
  });

  it("reports a duration outside 1..60000 ticks or not whole", () => {
    for (const durationTicks of [0, 60_001, 10.5, Number.NaN]) {
      expect(issuePaths(toMatchConfig(form({ durationTicks }))), `duration ${durationTicks}`).toEqual(["durationTicks"]);
    }
    expect(toMatchConfig(form({ durationTicks: 1 })).ok).toBe(true);
    expect(toMatchConfig(form({ durationTicks: 60_000 })).ok).toBe(true);
  });

  it("reports a map that is not bundled, naming it", () => {
    const result = toMatchConfig(form({ mapId: "atlantis" }));
    expect(result).toEqual({ ok: false, issues: [{ path: "mapId", message: expect.stringContaining('"atlantis"') }] });
  });

  it("reports every bad field at once", () => {
    expect(issuePaths(toMatchConfig(form({ seed: 1.5, slots: 20, durationTicks: 0 })))).toEqual(["seed", "slots", "durationTicks"]);
  });
});

describe("effectiveConfig: no-key mode (DESIGN.md §7 item 3)", () => {
  it("forces prompted slots to 0 without a key and keeps every other field", () => {
    expect(effectiveConfig(form({ prompted: 3, doerOnly: 2, seed: 9 }), "")).toEqual(form({ prompted: 0, doerOnly: 2, seed: 9 }));
  });

  it("treats a blank key as no key", () => {
    expect(effectiveConfig(form({ prompted: 3 }), "  \n").prompted).toBe(0);
  });

  it("leaves the form as it is with a key", () => {
    expect(effectiveConfig(form({ prompted: 3, doerOnly: 2 }), "sk-ant-test")).toEqual(form({ prompted: 3, doerOnly: 2 }));
  });
});

describe("validateForm", () => {
  const state = (patch: Partial<UiState> = {}): UiState => ({ key: "sk-ant-test", prompts: DEFAULT_PROMPTS, config: form(), ...patch });

  it("passes a valid state with a key: the MatchConfig and the prompts as given", () => {
    const prompts: Prompts = { thinkerSystem: "Hide.", doerInstructions: { move: "m", turn: "t", fire: "", target: "x" } };
    expect(validateForm(state({ prompts }))).toEqual({
      ok: true,
      config: { mapId: "map-1", seed: 1, durationTicks: 6000, slots: [P, W, C, W, C, W, C, W] },
      prompts,
    });
  });

  it("runs no prompted slot without a key: the default form becomes 8 bots", () => {
    const result = validateForm(state({ key: "" }));
    expect(result).toMatchObject({ ok: true, config: { slots: [W, C, W, C, W, C, W, C] } });
  });

  it("ignores a prompted count that would not fit while there is no key", () => {
    expect(validateForm(state({ key: "", config: form({ prompted: 9, doerOnly: 2 }) }))).toMatchObject({
      ok: true,
      config: { slots: [D, D, W, C, W, C, W, C] },
    });
  });

  it("reports prompts over their length caps, with the path to each", () => {
    const prompts: Prompts = {
      thinkerSystem: "x".repeat(8001),
      doerInstructions: { ...DEFAULT_PROMPTS.doerInstructions, fire: "y".repeat(501) },
    };
    expect(issuePaths(validateForm(state({ prompts })))).toEqual(["thinkerSystem", "doerInstructions.fire"]);
  });

  it("reports form and prompt issues together", () => {
    const prompts: Prompts = { ...DEFAULT_PROMPTS, thinkerSystem: "x".repeat(8001) };
    expect(issuePaths(validateForm(state({ prompts, config: form({ prompted: 9 }) })))).toEqual(["prompted", "thinkerSystem"]);
  });
});

describe("formatFormResult", () => {
  it('says "Config OK" for a form that passed', () => {
    const ok = validateForm({ key: "", prompts: DEFAULT_PROMPTS, config: DEFAULT_CONFIG });
    expect(formatFormResult(ok)).toBe("Config OK");
  });

  it("lists each issue as `path: message` under a count", () => {
    const text = formatFormResult({
      ok: false,
      issues: [
        { path: "prompted", message: "9 prompted slots do not fit in 8 slots" },
        { path: "seed", message: "must be a whole number from 0 to 4294967295" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "2 problems:",
      "prompted: 9 prompted slots do not fit in 8 slots",
      "seed: must be a whole number from 0 to 4294967295",
    ]);
  });

  it("counts one problem in the singular", () => {
    expect(formatFormResult({ ok: false, issues: [{ path: "slots", message: "must be a whole number from 4 to 16" }] })).toBe(
      "1 problem:\nslots: must be a whole number from 4 to 16",
    );
  });
});

describe("createStore", () => {
  const KEY = "decision-arena:v1:anthropic-key";
  const CONFIG = "decision-arena:v1:config";

  it("starts from the defaults; load() replaces them with what storage holds", () => {
    const storage = fakeStorage({ [KEY]: "sk-ant-test", [CONFIG]: JSON.stringify(form({ seed: 9, slots: 12 })) });
    const store = createStore(storage);
    expect(store.state).toEqual({ key: "", prompts: DEFAULT_PROMPTS, config: DEFAULT_CONFIG });
    store.load();
    expect(store.state).toEqual({ key: "sk-ant-test", prompts: DEFAULT_PROMPTS, config: form({ seed: 9, slots: 12 }) });
  });

  it("set() changes the state, saves the change and tells every subscriber", () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    const heard: UiState[][] = [[], []];
    store.subscribe((s) => heard[0]?.push(s));
    store.subscribe((s) => heard[1]?.push(s));
    store.set({ config: form({ slots: 12 }) });
    expect(store.state.config.slots).toBe(12);
    expect(JSON.parse(storage.data.get(CONFIG) ?? "null")).toEqual(form({ slots: 12 }));
    expect(heard).toEqual([[store.state], [store.state]]);
  });

  // Another tab may have saved the other parts since this one loaded.
  it("set() writes only the parts it is given", () => {
    const storage = fakeStorage();
    createStore(storage).set({ key: "sk-ant-test" });
    expect([...storage.data.keys()]).toEqual([KEY]);
  });

  it("set({ key: '' }) removes the key from storage", () => {
    const storage = fakeStorage({ [KEY]: "sk-ant-test" });
    const store = createStore(storage);
    store.load();
    store.set({ key: "" });
    expect(storage.data.has(KEY)).toBe(false);
    expect(store.state.key).toBe("");
  });

  it("load() tells subscribers; save() writes the whole state", () => {
    const storage = fakeStorage({ [KEY]: "sk-ant-test" });
    const store = createStore(storage);
    const heard: string[] = [];
    store.subscribe((s) => heard.push(s.key));
    store.load();
    expect(heard).toEqual(["sk-ant-test"]);
    storage.data.clear();
    store.save();
    expect([...storage.data.keys()].sort()).toEqual(["decision-arena:v1:anthropic-key", "decision-arena:v1:config", "decision-arena:v1:prompts"]);
  });

  it("stops calling a listener once it unsubscribes", () => {
    const store = createStore(fakeStorage());
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.set({ key: "a" });
    unsubscribe();
    store.set({ key: "b" });
    expect(calls).toBe(1);
  });

  it("works without storage, in memory only", () => {
    const store = createStore(null);
    store.load();
    store.set({ key: "sk-ant-test" });
    expect(store.state.key).toBe("sk-ant-test");
  });
});
