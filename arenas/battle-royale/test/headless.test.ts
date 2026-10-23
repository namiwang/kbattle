import { botSpec, eventsOfKind, runMatch, TICK_MS, type Arena, type Model } from "@decision-arena/core";
import { PERCEPTION_WINDOW_TICKS, type Observation, type WorldState } from "@decision-arena/kit-shooter";
import { describe, expect, it } from "vitest";
import { battleRoyale, DEFAULT_DURATION_TICKS, type BattleRoyaleTypes } from "../src";

// v1.4 exit (moved from the kit's version-1 loop tests in R0.4): a 2-bot
// wanderer-vs-camper match steps for the full length or until one dies, in under
// 5 s; bots decide only on the actor cadence, ticks 1, 11, 21, … (sim ruling R1;
// DESIGN.md rows 32, 33), each from the world before that tick's step.

const config = { seed: 1, durationTicks: DEFAULT_DURATION_TICKS, mapId: "map-1" };
const agents = [botSpec("battle-royale", "wanderer"), botSpec("battle-royale", "camper")];

interface Asked {
  tick: number;
  agent: string;
  observation: Observation;
}

/** The match, with every bot call recorded at its tick when `calls` is given; and the world after the last tick. */
async function play(match = config, calls?: Asked[]) {
  let tick = 1;
  let final: WorldState | undefined;
  const spy = (bot: Model, slot: number): Model => ({
    ...bot,
    ask(req) {
      calls?.push({ tick, agent: `a${slot}`, observation: (req.state as { observation: Observation }).observation });
      return bot.ask(req);
    },
  });
  const arena: Arena<BattleRoyaleTypes> = {
    ...battleRoyale,
    bots: {
      wanderer: (seed, slot) => spy(battleRoyale.bots.wanderer!(seed, slot), slot),
      camper: (seed, slot) => spy(battleRoyale.bots.camper!(seed, slot), slot),
    },
  };
  const log = await runMatch(arena, match, agents, {
    onTick: (t, state) => {
      tick = t + 1;
      final = state;
    },
  });
  return { log, final: final! };
}

describe("headless wanderer vs camper on map-1, seed 1", () => {
  it("runs to its end in under 5 s and ends with MatchEnd", async () => {
    const started = performance.now();
    const { log, final } = await play();
    expect(performance.now() - started).toBeLessThan(5000);
    expect(eventsOfKind(log, "Shot").length).toBeGreaterThan(0); // they met and fought
    const alive = final.agents.filter((a) => a.alive);
    expect(final.tick === config.durationTicks || alive.length <= 1).toBe(true);
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: final.tick });
    expect(eventsOfKind(log, "Death").map((d) => d.agent)).toEqual(final.agents.filter((a) => !a.alive).map((a) => a.id));
  });

  it("asks each bot to decide exactly on ticks 1, 11, 21, … while it is alive", async () => {
    const calls: Asked[] = [];
    const { final } = await play(config, calls);
    for (const agent of final.agents) {
      const last = agent.deathTick ?? final.tick;
      const due = Array.from({ length: Math.floor((last - 1) / PERCEPTION_WINDOW_TICKS) + 1 }, (_, n) => 1 + n * PERCEPTION_WINDOW_TICKS);
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
    const calls: Asked[] = [];
    await play({ ...config, durationTicks: 200 }, calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const { tick, observation } of calls) {
      const ticksLeft = 200 - (tick - 1); // the world is at tick − 1
      expect(observation.self.secondsLeft).toBe(Math.round((ticksLeft * TICK_MS) / 100) / 10);
    }
  });

  it("the same seed plays the same match", async () => {
    const a = await play();
    const b = await play();
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect(b.final).toEqual(a.final);
  });
});
