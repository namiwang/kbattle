// The fixtures the kit's scripts write (make-sample-log.ts): the sample log and the
// negative MatchLog files, checked against the version-1 schemas, and what the
// replay viewer can rely on in the sample. Moved from platform/core/test/schemas.test.ts
// and log.test.ts with the fixtures (ruling R23).

import { DOER_INTERVAL_TICKS, eventsOfKind, EventSchema, lastTick, MatchLogSchema, type MatchLog } from "@decision-arena/core/legacy";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type * as z from "zod";
import { AGENT_HP, BULLET_DAMAGE, FIRE_INTERVAL_TICKS, MOVE_SPEED_MPS } from "../src/constants";
import { getMap } from "../src/maps";
import { mpsToMetersPerTick } from "../src/units";

/** The path of every issue; [] when the value parses. */
function issuePaths(schema: z.ZodType, value: unknown): PropertyKey[][] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

/** The boundary round trip: parse, serialize, parse again. */
function roundTrip<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));
}

describe("fixtures", () => {
  const fixtures = new URL("../fixtures/", import.meta.url);
  const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));

  it("sample-log.json validates against MatchLog and round-trips", () => {
    const sample = readJson("sample-log.json");
    expect(roundTrip(MatchLogSchema, sample)).toEqual(sample);
  });

  it("sample-log.json has every Event kind at least once", () => {
    const sample = MatchLogSchema.parse(readJson("sample-log.json"));
    const seen = [...new Set(sample.events.map((event) => event.kind))];
    for (const option of EventSchema.options) {
      expect(seen).toContain(option.shape.kind.value);
    }
  });

  it("sample-log.json stays under 50 KB (plan budget)", () => {
    expect(statSync(new URL("sample-log.json", fixtures)).size).toBeLessThan(50 * 1024);
  });

  // Each bad fixture is a valid minimal log with one defect: exactly one issue, at this path.
  // (The /decide bodies stay with DecideRequestSchema in platform/core/fixtures/bad.)
  const badFixtures: Record<string, PropertyKey[]> = {
    "wrong-version.json": ["version"],
    "unknown-event-kind.json": ["events", 5, "kind"],
    "probability-above-1.json": ["events", 3, "answers", "move", "probabilities", "forward"],
    "seed-mismatch.json": ["seed"],
    "one-slot.json": ["config", "slots"],
    "doer-ok-without-answers.json": ["events", 3, "answers"],
  };

  it("bad/ holds exactly the expected fixtures", () => {
    const expected = Object.keys(badFixtures);
    expect(readdirSync(new URL("bad/", fixtures)).sort()).toEqual(expected.sort());
  });

  it.each(Object.entries(badFixtures))("bad/%s fails with one issue at %j", (name, path) => {
    expect(issuePaths(MatchLogSchema, readJson(`bad/${name}`))).toEqual([path]);
  });
});

// What the replay viewer (P2) can rely on in kits/shooter/fixtures/sample-log.json.
describe("the sample log", () => {
  const sample = (): MatchLog =>
    MatchLogSchema.parse(JSON.parse(readFileSync(new URL("../fixtures/sample-log.json", import.meta.url), "utf8")));

  it("is a 2-slot match on map-1: a0 prompted, a1 a wanderer bot, seed 1, 200-tick limit", () => {
    const { config, seed } = sample();
    expect(config).toEqual({
      mapId: "map-1",
      seed: 1,
      durationTicks: 200,
      slots: [{ kind: "prompted" }, { kind: "bot", bot: "wanderer" }],
    });
    expect(seed).toBe(1);
  });

  it("spawns both agents at tick 0 on map-1 spawn points", () => {
    const spawns = eventsOfKind(sample(), "Spawn");
    expect(spawns.map((s) => [s.agent, s.tick])).toEqual([["a0", 0], ["a1", 0]]);
    for (const s of spawns) expect(getMap("map-1").spawns).toContainEqual(s.pos);
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
