import { callsOf, parseMatchLogFor, runMatch, type MatchLogFor } from "@decision-arena/core";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { battleRoyale, type BattleRoyaleTypes } from "../src";
import { SIXTEEN_BOTS } from "./helpers";

// The parity gate of the move (DESIGN.md row 44, §6; ruling R25; ISSUES I-027):
// fixtures/parity/v1-run.json is the version-1 log of the kit's run-match.ts (16
// bots, wanderers and campers alternating, map-1, seed 7, 6,000 ticks) written
// by the untouched version-1 code (0279b8b; R0.3 rewrote only its config.mapId).
// The version-2 loop, over the battle royale arena with the bots as Models, must
// play the same match: every arena event and every Tick payload equal, in order,
// and byte-identical as compact JSON. Only the envelope and the model calls
// differ (Call for Doer).

type V1Event = { kind: string; tick: number; agent?: string; answers?: Record<string, unknown>; ranking?: string[] };
const FIXTURE = new URL("../fixtures/parity/v1-run.json", import.meta.url);

describe("parity with the version-1 run (R25)", () => {
  let text: string;
  let v1: { config: unknown; events: V1Event[] };
  let v2: MatchLogFor<BattleRoyaleTypes>;

  beforeAll(async () => {
    text = readFileSync(FIXTURE, "utf8");
    v1 = JSON.parse(text) as typeof v1;
    v2 = await runMatch(battleRoyale, { seed: 7, durationTicks: 6000, mapId: "map-1" }, SIXTEEN_BOTS);
  }, 30_000);

  it("compares against the run R25 names: 16 bots on map-1, seed 7, 6,000 ticks, 2,083 events, a9 alone at tick 1168", () => {
    expect(createHash("sha256").update(text).digest("hex")).toBe("dfb9477b335e04aa7f49f4c1e794f3751ac8aa519d67f5db29e0d1f058415f28");
    expect(v1.config).toEqual({
      mapId: "map-1",
      seed: 7,
      durationTicks: 6000,
      slots: Array.from({ length: 16 }, (_, i) => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
    });
    expect(v1.events).toHaveLength(2083);
    expect(v1.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: 1168 });
    expect(v1.events.at(-1)?.ranking?.[0]).toBe("a9");
  });

  it("plays the same arena events and Tick payloads, in order: equal, and byte-identical as compact JSON", () => {
    const mine = v2.events.filter((event) => event.kind !== "Call").map((event) => (event.kind === "Tick" ? { kind: event.kind, tick: event.tick, ...event.data } : event));
    const theirs = v1.events.filter((event) => event.kind !== "Doer" && event.kind !== "Thinker");
    expect(theirs).toHaveLength(1504);
    expect(mine).toEqual(theirs);
    expect(JSON.stringify(mine)).toBe(JSON.stringify(theirs));
  });

  it("asks the bots when version 1 did: one Call per Doer event, same tick and agent, same order", () => {
    const calls = v2.events.filter((event) => event.kind === "Call").map((event) => [event.tick, (event as { agent: string }).agent]);
    const doers = v1.events.filter((event) => event.kind === "Doer").map((event) => [event.tick, event.agent]);
    expect(doers).toHaveLength(579);
    expect(calls).toEqual(doers);
  });

  it("and the bots answer what version 1 logged, under their catalog ids, without the escalate they are no longer asked", () => {
    const doers = v1.events.filter((event) => event.kind === "Doer");
    for (const [slot, spec] of SIXTEEN_BOTS.entries()) {
      const agent = `a${slot}`;
      const calls = callsOf(v2, agent, "actor");
      const recorded = doers.filter((event) => event.agent === agent);
      expect(calls.map((call) => call.model)).toEqual(recorded.map(() => spec.roles.actor.model));
      expect(calls.map((call) => call.answers)).toEqual(
        recorded.map((event) => {
          const { escalate, ...answers } = event.answers ?? {};
          expect(escalate).toEqual({ type: "noul", noul: 0 });
          return answers;
        }),
      );
    }
  });

  it("writes a version-2 log that its arena parses as it is", () => {
    expect(parseMatchLogFor(battleRoyale, JSON.parse(JSON.stringify(v2)))).toEqual(v2);
    expect(v2).toMatchObject({ version: 2, arena: "battle-royale", mode: "solo", config: { seed: 7, durationTicks: 6000, mapId: "map-1" } });
  });
});
