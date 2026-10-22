import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { botProviders } from "../../src/bots";
import { MATCH_DURATION_TICKS } from "../../src/constants";
import { eventsOfKind } from "../../src/log";
import type { DoerAnswer, Event, MapSpec, MatchConfig, MatchLog, Prompts, Slot } from "../../src/schemas";
import { runMatch } from "../../src/sim/match";
import type { DecisionContext, DecisionProvider } from "../../src/sim/providers";
import { makeReplayingProvider, replayMatch } from "../../src/sim/replay-provider";
import { createRng, nextFloat } from "../../src/sim/rng";

// v1.6 exit (DESIGN.md §6.1): the same seed and the same recorded answers,
// replayed at their recorded ticks, reproduce the same log, byte for byte; and a
// changed answer changes the match (determinism, not caching).

const PROMPTS: Prompts = {
  thinkerSystem: "Stay alive.",
  doerInstructions: { move: "Keep moving.", turn: "", fire: "Fire when centered.", target: "" },
};

const SIXTEEN: MatchConfig = {
  mapId: "arena-1",
  seed: 7,
  durationTicks: MATCH_DURATION_TICKS,
  slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
};

const OPEN: MapSpec = {
  id: "open",
  width: 100,
  height: 100,
  obstacles: [],
  spawns: [
    { x: 20, y: 50 },
    { x: 80, y: 50 },
  ],
};

const bytes = (log: MatchLog) => JSON.stringify(log);

function answer(move: "forward" | "stop"): DoerAnswer {
  const crisp = <T extends string>(choice: T) => ({ type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 });
  return {
    model: "test",
    answers: { move: crisp(move), turn: crisp("none"), fire: { type: "noul", noul: 0 }, escalate: { type: "noul", noul: 0.9 } },
  };
}

const thinker = (agent: string, tick: number, requestedTick: number, ok: boolean): Event =>
  ok
    ? { kind: "Thinker", tick, requestedTick, agent, input: { digest: `asked at ${requestedTick}` }, ok, plan: { text: "Go north.", scratchpad: "" } }
    : { kind: "Thinker", tick, requestedTick, agent, input: { digest: `asked at ${requestedTick}` }, ok, error: "refusal" };

/** a0: answers, a timeout, a throw, a late answer and two thinker results; a1: answers, then hangs until the end. */
function scriptedProviders(): (slot: Slot, slotIndex: number) => DecisionProvider {
  const a0: DecisionProvider = {
    decide({ tick }) {
      if (tick === 11) return new Promise<DoerAnswer>(() => {}); // times out
      if (tick === 21) throw new Error("network: connection reset");
      if (tick === 31) return new Promise((resolve) => setTimeout(() => resolve(answer("stop")), 50)); // too late
      return Promise.resolve(answer(tick < 21 ? "forward" : "stop"));
    },
    pollEvents: (tick) => (tick === 6 ? [thinker("a0", 6, 1, true)] : tick === 27 ? [thinker("a0", 27, 11, false)] : []),
  };
  const a1: DecisionProvider = {
    decide: ({ tick }) => (tick <= 21 ? Promise.resolve(answer("forward")) : new Promise<DoerAnswer>(() => {})),
  };
  return (_slot, slotIndex) => (slotIndex === 0 ? a0 : a1);
}

const scripted: MatchConfig = { mapId: "open", seed: 11, durationTicks: 45, slots: [{ kind: "doer" }, { kind: "prompted" }] };

describe("makeReplayingProvider", () => {
  const log: MatchLog = {
    version: 1,
    config: scripted,
    seed: scripted.seed,
    prompts: PROMPTS,
    events: [
      { kind: "Doer", tick: 1, agent: "a0", ok: true, answers: answer("forward").answers },
      { kind: "Doer", tick: 1, agent: "a1", ok: true, answers: answer("stop").answers },
      thinker("a0", 6, 1, true),
      thinker("a1", 6, 1, false),
      thinker("a0", 6, 2, false),
      { kind: "Doer", tick: 11, agent: "a0", ok: false, error: "timeout: no answer within 2000 ms" },
    ],
  };

  /** What a replaying provider is asked at `tick`; it reads only the tick (an aborted signal changes nothing). */
  const asked = (tick: number): DecisionContext => ({
    tick,
    agent: "a0",
    observation: { self: { pos: { x: 0, y: 0 }, facing: 0, hp: 100, kills: 0, secondsLeft: 0 }, visible: [], heard: [], incoming: [] },
    plan: "",
    signal: AbortSignal.abort(),
  });

  it("answers a recorded call with its recorded answers", async () => {
    const a0 = makeReplayingProvider(log, "a0");
    await expect(a0.decide(asked(1))).resolves.toMatchObject({
      answers: answer("forward").answers,
    });
  });

  it("rejects a recorded failure with its recorded error, and a call it has no record of", async () => {
    const a0 = makeReplayingProvider(log, "a0");
    await expect(a0.decide(asked(11))).rejects.toThrow(
      /^timeout: no answer within 2000 ms$/,
    );
    await expect(a0.decide(asked(21))).rejects.toThrow(
      "replay: no recorded doer call for a0 at tick 21",
    );
  });

  it("polls the agent's own Thinker events at their recorded tick, in log order", () => {
    const a0 = makeReplayingProvider(log, "a0");
    expect(a0.pollEvents?.(6)).toEqual([log.events[2], log.events[4]]);
    expect(a0.pollEvents?.(5)).toEqual([]);
    expect(makeReplayingProvider(log, "a1").pollEvents?.(6)).toEqual([log.events[3]]);
  });
});

describe("determinism harness: 16 bots on arena-1, seed 7 (v1.6 exit)", () => {
  let recorded: MatchLog; // log A

  beforeAll(async () => {
    recorded = await runMatch(SIXTEEN, { providers: botProviders(SIXTEEN.seed), prompts: PROMPTS });
  }, 30_000);

  it("replaying the recorded answers at their recorded ticks gives a byte-identical log", async () => {
    const replayed = await replayMatch(recorded); // log B
    expect(bytes(replayed)).toBe(bytes(recorded));
  });

  it("the same config with live bots plays the same log again", async () => {
    const again = await runMatch(SIXTEEN, { providers: botProviders(SIXTEEN.seed), prompts: PROMPTS });
    expect(bytes(again)).toBe(bytes(recorded));
  });

  it("changing one recorded move answer changes the log, starting at that tick, and the world with it", async () => {
    // A mid-match decision to walk forward that did move the agent during its tick.
    const ticks = eventsOfKind(recorded, "Tick");
    const at = (tick: number, agent: string) => ticks[tick]!.agents.find(([id]) => id === agent)?.slice(1, 3);
    const index = recorded.events.findIndex(
      (e) =>
        e.kind === "Doer" &&
        e.tick >= 101 &&
        e.answers?.move?.choice === "forward" &&
        at(e.tick, e.agent) !== undefined &&
        JSON.stringify(at(e.tick, e.agent)) !== JSON.stringify(at(e.tick - 1, e.agent)),
    );
    expect(index).toBeGreaterThan(0);
    const original = recorded.events[index] as Extract<Event, { kind: "Doer" }>;

    const mutated = structuredClone(recorded);
    const doer = mutated.events[index] as Extract<Event, { kind: "Doer" }>;
    doer.answers!.move = { type: "choice", choice: "stop", probabilities: { stop: 1 }, confidence: 1 };
    const changed = await replayMatch(mutated); // log C

    expect(bytes(changed)).not.toBe(bytes(recorded));
    const first = changed.events.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(recorded.events[i]));
    expect(first).toBe(index); // everything before the changed answer is the same
    expect(changed.events[first]).toEqual(doer);
    expect(changed.events[first]!.tick).toBe(original.tick);

    // Not just the echoed answer: the agent stood still that tick instead of walking.
    const tickC = eventsOfKind(changed, "Tick")[original.tick]!;
    const rowC = tickC.agents.find(([id]) => id === original.agent)!.slice(1, 3);
    expect(rowC).toEqual(at(original.tick - 1, original.agent));
    expect(rowC).not.toEqual(at(original.tick, original.agent));
  });
});

describe("determinism harness: faults, thinker events, cancels and clocks", () => {
  it("replays recorded failures and Thinker events at their ticks into the same bytes", async () => {
    const recorded = await runMatch(scripted, { map: OPEN, prompts: PROMPTS, doerTimeoutMs: 10, providers: scriptedProviders() });
    const a0 = eventsOfKind(recorded, "Doer").filter((e) => e.agent === "a0");
    expect(a0.map((e) => [e.tick, e.ok ? "ok" : e.error])).toEqual([
      [1, "ok"],
      [11, "timeout: no answer within 10 ms"],
      [21, "network: connection reset"],
      [31, "timeout: no answer within 10 ms"],
      [41, "ok"],
    ]);
    expect(eventsOfKind(recorded, "Thinker").map((e) => [e.tick, e.requestedTick, e.ok])).toEqual([
      [6, 1, true],
      [27, 11, false],
    ]);
    const replayed = await replayMatch(recorded, { map: OPEN });
    expect(bytes(replayed)).toBe(bytes(recorded));
  });

  it("replays a cancelled match by cancelling after the same tick", async () => {
    const controller = new AbortController();
    const recorded = await runMatch(SIXTEEN, {
      providers: botProviders(SIXTEEN.seed),
      prompts: PROMPTS,
      signal: controller.signal,
      onTick: (tick) => tick === 333 && controller.abort(),
    });
    expect(recorded.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 333, ranking: [] });
    expect(bytes(await replayMatch(recorded))).toBe(bytes(recorded));
  });

  describe("wall clocks", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("never reach the log: Date.now and performance.now jumping around, with a wall floor, give the same bytes", async () => {
      const config = { ...SIXTEEN, durationTicks: 120 };
      const plain = await runMatch(config, { providers: botProviders(config.seed), prompts: PROMPTS });
      let rng = createRng(5);
      const jitter = () => {
        const d = nextFloat(rng);
        rng = d.rng;
        return d.value;
      };
      let clock = 1e9;
      vi.spyOn(performance, "now").mockImplementation(() => (clock += 3 * jitter())); // forward, unevenly
      vi.spyOn(Date, "now").mockImplementation(() => Math.floor(1e12 * jitter()));
      const skewed = await runMatch(config, { providers: botProviders(config.seed), prompts: PROMPTS, minWallMsPerTick: 1 });
      expect(bytes(skewed)).toBe(bytes(plain));
    });

    it("the sim, the loop and the bots read no clock and no Math.random; performance.now appears only in the loop's wall floor", () => {
      const src = new URL("../../src/", import.meta.url);
      const files = ["sim/", "bots/"].flatMap((dir) =>
        readdirSync(new URL(dir, src)).map((name) => ({ name: `${dir}${name}`, text: readFileSync(new URL(`${dir}${name}`, src), "utf8") })),
      );
      expect(files.length).toBeGreaterThan(10);
      for (const { name, text } of files) {
        const code = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // comments may name them
        expect(code, name).not.toMatch(/Math\.random|Date\.now|new Date\b/);
        if (name !== "sim/match.ts") expect(code, name).not.toMatch(/performance\.now/);
      }
    });
  });
});
