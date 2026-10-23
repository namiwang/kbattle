import type { DoerState, Event, MatchLog } from "@decision-arena/core/legacy";
import { describe, expect, expectTypeOf, it } from "vitest";
import { HEARING_BANDS_M } from "../src/constants";
import type { MapSpec } from "../src/maps";
import {
  HEARING_BANDS,
  MOVE_CHOICES,
  SOUND_KINDS,
  STOP_ACTION,
  TURN_CHOICES,
  type HearingBand,
  type MoveChoice,
  type Observation,
  type SoundKind,
  type TurnChoice,
  type WorldState,
} from "../src/types";

describe("STOP_ACTION, the default action", () => {
  it("stands still, keeps facing, holds fire, has no target", () => {
    expect(STOP_ACTION).toEqual({ move: "stop", turn: "none", fire: false, target: null });
  });

  it("is frozen, so the shared default cannot be changed by accident", () => {
    expect(Object.isFrozen(STOP_ACTION)).toBe(true);
  });
});

// Runtime lists behind the string-union types, so zod enums derive from them (v0.3).
describe("choice lists", () => {
  it("MOVE_CHOICES are the §5.4 move criteria, in order", () => {
    expect(MOVE_CHOICES).toEqual(["forward", "back", "left", "right", "stop"]);
  });

  it("TURN_CHOICES are the §5.4 turn criteria, in order", () => {
    expect(TURN_CHOICES).toEqual(["left", "right", "none", "face_target"]);
  });

  it("SOUND_KINDS and HEARING_BANDS are the §6.2 hearing values", () => {
    expect(SOUND_KINDS).toEqual(["shot", "steps"]);
    expect(HEARING_BANDS).toEqual(["near", "mid", "far"]);
  });

  it("are frozen arrays", () => {
    for (const list of [MOVE_CHOICES, TURN_CHOICES, SOUND_KINDS, HEARING_BANDS]) {
      expect(Array.isArray(list)).toBe(true); // Object.isFrozen(undefined) is true
      expect(Object.isFrozen(list)).toBe(true);
    }
  });

  it("STOP_ACTION uses listed choices", () => {
    expect(MOVE_CHOICES).toContain(STOP_ACTION.move);
    expect(TURN_CHOICES).toContain(STOP_ACTION.turn);
  });

  it("HEARING_BANDS_M has an upper edge for every band but the last", () => {
    expect(Object.keys(HEARING_BANDS_M)).toEqual(HEARING_BANDS.slice(0, -1));
  });

  it("the union types are derived from the lists", () => {
    expectTypeOf<MoveChoice>().toEqualTypeOf<"forward" | "back" | "left" | "right" | "stop">();
    expectTypeOf<TurnChoice>().toEqualTypeOf<"left" | "right" | "none" | "face_target">();
    expectTypeOf<SoundKind>().toEqualTypeOf<"shot" | "steps">();
    expectTypeOf<HearingBand>().toEqualTypeOf<"near" | "mid" | "far">();
  });
});

// The version-1 wire shapes against the kit's own types, moved from
// platform/core/test/schemas.test.ts (ruling R23).
describe("inferred types agree with the internal types", () => {
  it("DoerState is Observation plus plan, with pos as an [x, y] tuple", () => {
    expectTypeOf<DoerState["visible"]>().toEqualTypeOf<Observation["visible"]>();
    expectTypeOf<DoerState["heard"]>().toEqualTypeOf<Observation["heard"]>();
    expectTypeOf<DoerState["incoming"]>().toEqualTypeOf<Observation["incoming"]>();
    expectTypeOf<Omit<DoerState["self"], "pos">>().toEqualTypeOf<Omit<Observation["self"], "pos">>();
    expectTypeOf<DoerState["self"]["pos"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<DoerState["plan"]>().toEqualTypeOf<string>();
  });

  it("the sim's WorldState uses the schema's MapSpec, and a log's events are Events", () => {
    expectTypeOf<WorldState["map"]>().toEqualTypeOf<MapSpec>();
    expectTypeOf<MatchLog["events"][number]>().toEqualTypeOf<Event>();
  });
});
