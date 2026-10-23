import { TICK_MS } from "@decision-arena/core";
import { DOER_INTERVAL_TICKS, eventsOfKind, MATCH_DURATION_TICKS, type MatchConfig, type Prompts } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import { botProviders } from "../../src/bots";
import { runMatch } from "../../src/legacy/match";
import type { DecisionContext, DecisionProvider } from "../../src/legacy/providers";
import type { WorldState } from "../../src/types";

// v1.4 exit, on the v1.5 match loop: a 2-bot wanderer-vs-camper match steps for
// MATCH_DURATION_TICKS or until one dies, in under 5 s; bots decide only on the
// doer cadence, ticks 1, 11, 21, … (sim ruling R1; DESIGN.md rows 32, 33).

const config: MatchConfig = {
  mapId: "map-1",
  seed: 1,
  durationTicks: MATCH_DURATION_TICKS,
  slots: [
    { kind: "bot", bot: "wanderer" },
    { kind: "bot", bot: "camper" },
  ],
};
const prompts: Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };

/** Wraps a provider, recording every context it is asked with. */
function spy(inner: DecisionProvider, calls: DecisionContext[]): DecisionProvider {
  return {
    decide(ctx) {
      calls.push(ctx);
      return inner.decide(ctx);
    },
  };
}

/** The bots of `match`, each wrapped by `wrap`; and the world after the last tick. */
async function play(match: MatchConfig, wrap = (bot: DecisionProvider) => bot) {
  const bots = botProviders(match.seed);
  let final: WorldState | undefined;
  const log = await runMatch(match, {
    prompts,
    providers: (slot, i) => wrap(bots(slot, i)),
    onTick: (_, state) => {
      final = state;
    },
  });
  return { log, final: final! };
}

describe("headless wanderer vs camper on map-1, seed 1", () => {
  it("runs to its end in under 5 s and ends with MatchEnd", async () => {
    const started = performance.now();
    const { log, final } = await play(config);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(eventsOfKind(log, "Shot").length).toBeGreaterThan(0); // they met and fought
    const alive = final.agents.filter((a) => a.alive);
    expect(final.tick === config.durationTicks || alive.length <= 1).toBe(true);
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: final.tick });
    expect(eventsOfKind(log, "Death").map((d) => d.agent)).toEqual(final.agents.filter((a) => !a.alive).map((a) => a.id));
  });

  it("asks each bot to decide exactly on ticks 1, 11, 21, … while it is alive", async () => {
    const calls: DecisionContext[] = [];
    const { final } = await play(config, (bot) => spy(bot, calls));
    for (const agent of final.agents) {
      const last = agent.deathTick ?? final.tick;
      const due = Array.from({ length: Math.floor((last - 1) / DOER_INTERVAL_TICKS) + 1 }, (_, n) => 1 + n * DOER_INTERVAL_TICKS);
      expect(calls.filter((c) => c.agent === agent.id).map((c) => c.tick), agent.id).toEqual(due);
    }
    expect(calls.slice(0, 4).map((c) => [c.agent, c.tick])).toEqual([
      ["a0", 1],
      ["a1", 1],
      ["a0", 11],
      ["a1", 11],
    ]);
  });

  it("each decision perceives the world before that tick's step", async () => {
    const calls: DecisionContext[] = [];
    await play({ ...config, durationTicks: 200 }, (bot) => spy(bot, calls));
    expect(calls.length).toBeGreaterThan(0);
    for (const { tick, observation } of calls) {
      const ticksLeft = 200 - (tick - 1); // the world is at tick − 1
      expect(observation.self.secondsLeft).toBe(Math.round((ticksLeft * TICK_MS) / 100) / 10);
    }
  });

  it("the same seed plays the same match", async () => {
    const a = await play(config);
    const b = await play(config);
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect(b.final).toEqual(a.final);
  });
});
