import { describe, expect, it } from "vitest";
import { DOER_INTERVAL_TICKS, MATCH_DURATION_TICKS, TICK_MS } from "../../src/constants";
import type { MatchConfig } from "../../src/schemas";
import type { DecisionContext, DecisionProvider } from "../../src/sim/providers";
import { botsFor, runHeadless } from "./headless";

// v1.4 exit: a 2-bot wanderer-vs-camper match steps for MATCH_DURATION_TICKS or
// until one dies, returning a final world state, in under 5 s; bots decide only
// on the doer cadence, ticks 1, 11, 21, … (sim ruling R1; DESIGN.md rows 32, 33).

const config: MatchConfig = {
  mapId: "arena-1",
  seed: 1,
  durationTicks: MATCH_DURATION_TICKS,
  slots: [
    { kind: "bot", bot: "wanderer" },
    { kind: "bot", bot: "camper" },
  ],
};

/** Wraps a provider, recording every context it is asked with. */
function spy(inner: DecisionProvider, calls: DecisionContext[]): DecisionProvider {
  return {
    decide(ctx) {
      calls.push(ctx);
      return inner.decide(ctx);
    },
  };
}

describe("headless wanderer vs camper on arena-1, seed 1", () => {
  it("runs to its end in under 5 s and returns the final world", async () => {
    const started = performance.now();
    const { state, deaths, shots } = await runHeadless(config, botsFor(config));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(shots).toBeGreaterThan(0); // they met and fought
    const alive = state.agents.filter((a) => a.alive);
    expect(state.tick === config.durationTicks || alive.length <= 1).toBe(true);
    expect(deaths.map((d) => d.agent)).toEqual(state.agents.filter((a) => !a.alive).map((a) => a.id));
  });

  it("asks each bot to decide exactly on ticks 1, 11, 21, … while it is alive", async () => {
    const calls: DecisionContext[] = [];
    const { state } = await runHeadless(config, botsFor(config).map((bot) => spy(bot, calls)));
    for (const agent of state.agents) {
      const last = agent.deathTick ?? state.tick;
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
    await runHeadless({ ...config, durationTicks: 200 }, botsFor(config).map((bot) => spy(bot, calls)));
    for (const { tick, observation } of calls) {
      const ticksLeft = 200 - (tick - 1); // the world is at tick − 1
      expect(observation.self.secondsLeft).toBe(Math.round((ticksLeft * TICK_MS) / 100) / 10);
    }
  });

  it("the same seed plays the same match", async () => {
    const a = await runHeadless(config, botsFor(config));
    const b = await runHeadless(config, botsFor(config));
    expect(b).toEqual(a);
  });
});
