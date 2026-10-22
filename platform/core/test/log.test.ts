import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AGENT_HP,
  BULLET_DAMAGE,
  DOER_INTERVAL_TICKS,
  FIRE_INTERVAL_TICKS,
  MOVE_SPEED_MPS,
} from "../src/constants";
import { eventsOfKind, lastTick, type EventKind, type EventOf } from "../src/log";
import { getMap } from "../src/maps";
import { MatchLogSchema, type Event, type MatchLog } from "../src/schemas";
import { mpsToMetersPerTick } from "../src/units";

// Typed with the z.infer types: this literal only compiles if the schemas infer what log.ts expects.
const log: MatchLog = {
  version: 1,
  config: {
    mapId: "arena-1",
    seed: 3,
    durationTicks: 100,
    slots: [{ kind: "prompted" }, { kind: "bot", bot: "camper" }],
  },
  seed: 3,
  prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
  events: [
    { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 4, y: 50 }, facing: 0 },
    { kind: "Tick", tick: 0, agents: [["a0", 4, 50, 0, 100]], bullets: [] },
    {
      kind: "Thinker",
      tick: 9,
      requestedTick: 2,
      agent: "a0",
      input: null,
      ok: true,
      plan: { text: "Go east.", scratchpad: "" },
    },
    { kind: "Tick", tick: 1, agents: [["a0", 4.25, 50, 0, 100]], bullets: [] },
  ],
};

describe("eventsOfKind", () => {
  it("returns the events of one kind in log order", () => {
    expect(eventsOfKind(log, "Tick").map((e) => e.tick)).toEqual([0, 1]);
    expect(eventsOfKind(log, "Spawn")).toEqual([log.events[0]]);
  });

  it("returns [] for a kind the log does not have", () => {
    expect(eventsOfKind(log, "Death")).toEqual([]);
  });

  it("narrows the type to that kind", () => {
    const thinker = eventsOfKind(log, "Thinker");
    expectTypeOf(thinker).toEqualTypeOf<EventOf<"Thinker">[]>();
    expect(thinker[0]?.requestedTick).toBe(2); // compiles only because the type is narrowed
    expectTypeOf<EventOf<"Tick">["agents"]>().toEqualTypeOf<[string, number, number, number, number][]>();
    expectTypeOf<EventKind>().toEqualTypeOf<Event["kind"]>();
  });
});

describe("lastTick", () => {
  it("is the highest tick of any event, wherever it sits in the log", () => {
    expect(lastTick(log)).toBe(9);
  });

  it("is 0 for a log with no events", () => {
    expect(lastTick({ ...log, events: [] })).toBe(0);
  });
});

// What the replay viewer (P2) can rely on in platform/core/fixtures/sample-log.json.
describe("the sample log", () => {
  const sample = (): MatchLog =>
    MatchLogSchema.parse(JSON.parse(readFileSync(new URL("../fixtures/sample-log.json", import.meta.url), "utf8")));

  it("is a 2-slot match on arena-1: a0 prompted, a1 a wanderer bot, seed 1, 200-tick limit", () => {
    const { config, seed } = sample();
    expect(config).toEqual({
      mapId: "arena-1",
      seed: 1,
      durationTicks: 200,
      slots: [{ kind: "prompted" }, { kind: "bot", bot: "wanderer" }],
    });
    expect(seed).toBe(1);
  });

  it("spawns both agents at tick 0 on arena-1 spawn points", () => {
    const spawns = eventsOfKind(sample(), "Spawn");
    expect(spawns.map((s) => [s.agent, s.tick])).toEqual([["a0", 0], ["a1", 0]]);
    for (const s of spawns) expect(getMap("arena-1").spawns).toContainEqual(s.pos);
  });

  it("has a Tick at every tick from 0 to the end, and ends with MatchEnd ranking a0 first", () => {
    const s = sample();
    const end = lastTick(s);
    expect(eventsOfKind(s, "Tick").map((t) => t.tick)).toEqual(Array.from({ length: end + 1 }, (_, i) => i));
    expect(s.events.at(-1)).toEqual({ kind: "MatchEnd", tick: end, ranking: ["a0", "a1"] });
    expect(end).toBeLessThan(s.config.durationTicks); // ended by elimination, before the time limit
  });

  it("moves agents at no more than MOVE_SPEED_MPS", () => {
    const step = mpsToMetersPerTick(MOVE_SPEED_MPS) + 0.01; // positions are rounded to 2 decimals
    const last = new Map<string, [number, number]>();
    for (const tick of eventsOfKind(sample(), "Tick")) {
      for (const [id, x, y] of tick.agents) {
        const prev = last.get(id);
        if (prev) expect(Math.hypot(x - prev[0], y - prev[1]), `${id} at tick ${tick.tick}`).toBeLessThanOrEqual(step);
        last.set(id, [x, y]);
      }
    }
  });

  it("shows each bullet in consecutive Ticks from its shot tick until it hits, leaves or the match ends", () => {
    const s = sample();
    const end = lastTick(s);
    const ticks = eventsOfKind(s, "Tick");
    const hitAt = new Map(eventsOfKind(s, "Hit").map((h) => [h.bullet, h.tick]));
    const shots = eventsOfKind(s, "Shot");
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      const seenAt = ticks.filter((t) => t.bullets.some(([id]) => id === shot.bullet)).map((t) => t.tick);
      expect(seenAt, shot.bullet).toEqual(Array.from({ length: seenAt.length }, (_, i) => shot.tick + i));
      const last = seenAt.at(-1);
      const hit = hitAt.get(shot.bullet);
      if (hit !== undefined) expect(last, `${shot.bullet} hit at ${hit}`).toBe(hit - 1);
      if (last !== end) expect(seenAt.length, shot.bullet).toBeGreaterThanOrEqual(3); // only the match end cuts a flight short
    }
  });

  it("fires each agent's shots at least FIRE_INTERVAL_TICKS apart", () => {
    const shots = eventsOfKind(sample(), "Shot");
    for (const agent of ["a0", "a1"]) {
      const at = shots.filter((s) => s.agent === agent).map((s) => s.tick);
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(FIRE_INTERVAL_TICKS);
    }
  });

  it("kills a1 with BULLET_DAMAGE hits that add up to AGENT_HP, and drops a1 from Tick from then on", () => {
    const s = sample();
    const deaths = eventsOfKind(s, "Death");
    expect(deaths).toHaveLength(1);
    const death = deaths[0]!;
    expect([death.agent, death.killer]).toEqual(["a1", "a0"]);
    const hitsOnA1 = eventsOfKind(s, "Hit").filter((h) => h.target === "a1");
    expect(hitsOnA1.every((h) => h.damage === BULLET_DAMAGE)).toBe(true);
    expect(hitsOnA1.reduce((sum, h) => sum + h.damage, 0)).toBe(AGENT_HP);
    expect(hitsOnA1.at(-1)?.tick).toBe(death.tick);
    for (const tick of eventsOfKind(s, "Tick")) {
      const listsA1 = tick.agents.some(([id]) => id === "a1");
      expect(listsA1, `tick ${tick.tick}`).toBe(tick.tick < death.tick);
    }
  });

  it("matches the hp in Tick to the hits taken", () => {
    const s = sample();
    const hits = eventsOfKind(s, "Hit");
    for (const tick of eventsOfKind(s, "Tick")) {
      for (const [id, , , , hp] of tick.agents) {
        const taken = hits.filter((h) => h.target === id && h.tick <= tick.tick).reduce((sum, h) => sum + h.damage, 0);
        expect(hp, `${id} at tick ${tick.tick}`).toBe(AGENT_HP - taken);
      }
    }
  });

  it("logs a0's doer every DOER_INTERVAL_TICKS from tick 1, with one timeout", () => {
    const s = sample();
    const doer = eventsOfKind(s, "Doer");
    expect(doer.every((d) => d.agent === "a0")).toBe(true);
    expect(doer.map((d) => d.tick)).toEqual(
      Array.from({ length: Math.floor((lastTick(s) - 1) / DOER_INTERVAL_TICKS) + 1 }, (_, i) => 1 + i * DOER_INTERVAL_TICKS),
    );
    const faults = doer.filter((d) => !d.ok);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.error).toMatch(/timeout/);
    expect(doer.some((d) => d.ok && d.answers?.target !== undefined)).toBe(true);
    expect(doer.some((d) => d.ok && d.answers?.target === undefined)).toBe(true); // nobody visible (I-005)
  });

  it("logs two thinker calls for a0: one plan applied later than requested, one refusal", () => {
    const thinker = eventsOfKind(sample(), "Thinker");
    expect(thinker).toHaveLength(2);
    expect(thinker.every((t) => t.agent === "a0")).toBe(true);
    const [planned, refused] = thinker;
    expect(planned?.ok).toBe(true);
    expect(planned?.plan?.text).toBeTruthy();
    expect(planned!.requestedTick).toBeLessThan(planned!.tick);
    expect(refused?.ok).toBe(false);
    expect(refused?.error).toMatch(/refusal/);
  });
});
