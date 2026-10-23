import {
  createRng,
  eventsOfKind,
  makeReplayingModel,
  modelError,
  nextFloat,
  parseMatchLog,
  parseMatchLogFor,
  QUESTION_TYPES,
  replayMatch,
  runMatch,
  type AgentSpec,
  type Answers,
  type AskRequest,
  type CallEvent,
  type MatchLogFor,
  type Model,
  type Reply,
} from "@decision-arena/core";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { battleRoyale, createBattleRoyale, type BattleRoyaleTypes } from "../src";
import { OPEN, SIXTEEN_BOTS } from "./helpers";

// The determinism contract over the battle royale (moved from the kit's version-1
// determinism harness, kits/shooter/test/sim/determinism.test.ts, in R0.4;
// DESIGN.md §5.5, §13; rulings R22.h, k): the same seed and the same recorded
// answers, replayed at their recorded ticks, reproduce the same log, byte for
// byte; and a changed answer changes the match (determinism, not caching).

type Log = MatchLogFor<BattleRoyaleTypes>;

const SIXTEEN = { seed: 7, durationTicks: 6000, mapId: "map-1" };
const arena = createBattleRoyale([OPEN]);
const USAGE = { inputTokens: 40, outputTokens: 12 };

const bytes = (log: unknown) => JSON.stringify(log);

/** A log as a viewer or a replay gets it from disk: written as JSON, read back, parsed (principle 7). */
const throughFile = (log: Log): Log => parseMatchLogFor(arena, JSON.parse(JSON.stringify(log)));

function answers(move: "forward" | "stop", escalate = 0.9): Answers {
  const crisp = (choice: string) => ({ type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 });
  return { move: crisp(move), turn: crisp("none"), fire: { type: "noul", noul: 0 }, escalate: { type: "noul", noul: escalate } };
}
const reply = (a: Answers): Reply => ({ ok: true, answers: a, usage: USAGE, model: "test" });

function scripted(id: string, script: (req: AskRequest, n: number) => Reply | Promise<Reply>): Model {
  let n = 0;
  return { id, supports: new Set(QUESTION_TYPES), ask: (req) => Promise.resolve(script(req, n++)) };
}
const player = (actor: string, planner?: string): AgentSpec => ({
  arena: "battle-royale",
  roles: planner === undefined ? { actor: { model: actor } } : { actor: { model: actor }, planner: { model: planner } },
  prompts: { planner: "Stay alive.", actor: { move: "Keep moving." } },
});
const resolver = (...models: Model[]) => (id: string) => models.find((model) => model.id === id);

/**
 * a0: answers, a timeout, a throw, a late answer, and a planner that answers four
 * ticks after it is asked and then refuses; a1: answers, then hangs until the end.
 */
function scriptedMatch(timeoutMs = 10) {
  const due: { at: number; go: () => void }[] = [];
  let tick = 1;
  const a0 = scripted("dummy/a0", () => {
    if (tick === 11) return new Promise<Reply>(() => {}); // times out
    if (tick === 21) throw new Error("network: connection reset");
    if (tick === 31) return new Promise((resolve) => setTimeout(() => resolve(reply(answers("stop"))), 50)); // too late
    return reply(answers(tick < 21 ? "forward" : "stop"));
  });
  const p0 = scripted("dummy/p0", (_req, n) =>
    n === 0
      ? new Promise<void>((go) => due.push({ at: 4, go })).then(() => ({
          ok: true as const,
          answers: { plan: { type: "text" as const, text: "Go north." }, scratchpad: { type: "text" as const, text: "" } },
          usage: USAGE,
          model: "planner-v1",
        }))
      : { ok: false, error: modelError("refusal", "no") },
  );
  const a1 = scripted("dummy/a1", () => (tick <= 21 ? reply(answers("forward", 0)) : new Promise<Reply>(() => {})));
  return runMatch(arena, { seed: 11, durationTicks: 45, mapId: "open" }, [player("dummy/a0", "dummy/p0"), player("dummy/a1")], {
    models: resolver(a0, p0, a1),
    timeoutMs: (_model, role) => (role === "actor" ? timeoutMs : 60_000),
    onTick: (t) => {
      tick = t + 1;
      for (const entry of due) if (entry.at === t) entry.go();
    },
  });
}

describe("makeReplayingModel over a battle royale log", () => {
  let log: Log;
  beforeAll(async () => {
    log = await scriptedMatch();
  });

  it("answers a recorded call with its recorded answers at its tick", async () => {
    const a0 = makeReplayingModel(log, "a0", "actor");
    a0.tickDone(0);
    await expect(a0.ask({ state: {}, questions: {}, signal: AbortSignal.abort() } as unknown as AskRequest)).resolves.toMatchObject({ ok: true, answers: answers("forward") });
  });

  it("gives a recorded failure back as its error, and a call it has no record of as an error naming it", async () => {
    const a0 = makeReplayingModel(log, "a0", "actor");
    const req = { state: {}, questions: {}, signal: AbortSignal.abort() } as unknown as AskRequest;
    a0.tickDone(10);
    await expect(a0.ask(req)).resolves.toEqual({ ok: false, error: { kind: "timeout", fatal: false, message: "no answer within 10 ms" } });
    a0.tickDone(11);
    await expect(a0.ask(req)).resolves.toMatchObject({ ok: false, error: { message: "replay: no recorded actor call for a0 at tick 12" } });
  });
});

describe("determinism harness: 16 bots on map-1, seed 7 (v1.6 exit)", () => {
  let recorded: Log; // log A

  beforeAll(async () => {
    recorded = await runMatch(battleRoyale, SIXTEEN, SIXTEEN_BOTS);
  }, 30_000);

  it("replaying the recorded answers at their recorded ticks gives a byte-identical log", async () => {
    const replayed = await replayMatch(battleRoyale, recorded); // log B
    expect(bytes(replayed)).toBe(bytes(recorded));
  });

  it("written to a file and read back, the log replays into the same bytes (review M17)", async () => {
    const file = parseMatchLogFor(battleRoyale, JSON.parse(JSON.stringify(recorded)));
    expect(file).toEqual(recorded);
    expect(bytes(await replayMatch(battleRoyale, file))).toBe(bytes(recorded));
    expect(bytes(await replayMatch(battleRoyale, parseMatchLog(JSON.parse(JSON.stringify(recorded)))))).toBe(bytes(recorded));
  });

  it("the same config with live bots plays the same log again", async () => {
    expect(bytes(await runMatch(battleRoyale, SIXTEEN, SIXTEEN_BOTS))).toBe(bytes(recorded));
  });

  it("changing one recorded move answer changes the log, starting at that call, and the world with it", async () => {
    // A mid-match decision to walk forward that did move the agent during its tick.
    const ticks = eventsOfKind(recorded, "Tick");
    const at = (tick: number, agent: string) => ticks[tick]!.data.agents.find(([id]) => id === agent)?.slice(1, 3);
    const index = recorded.events.findIndex((e) => {
      if (e.kind !== "Call") return false;
      const call = e as CallEvent;
      const move = call.answers?.move;
      return call.tick >= 101 && move?.type === "choice" && move.choice === "forward" && at(call.tick, call.agent) !== undefined && bytes(at(call.tick, call.agent)) !== bytes(at(call.tick - 1, call.agent));
    });
    expect(index).toBeGreaterThan(0);
    const original = recorded.events[index] as CallEvent;

    const mutated = structuredClone(recorded);
    const call = mutated.events[index] as CallEvent;
    call.answers = { ...call.answers, move: { type: "choice", choice: "stop", probabilities: { stop: 1 }, confidence: 1 } };
    const changed = await replayMatch(battleRoyale, mutated); // log C

    expect(bytes(changed)).not.toBe(bytes(recorded));
    const first = changed.events.findIndex((e, i) => bytes(e) !== bytes(recorded.events[i]));
    expect(first).toBe(index); // everything before the changed answer is the same
    expect(changed.events[first]).toEqual(call);
    expect(changed.events[first]!.tick).toBe(original.tick);

    // Not just the echoed answer: the agent stood still that tick instead of walking.
    const tickC = eventsOfKind(changed, "Tick")[original.tick]!;
    const rowC = tickC.data.agents.find(([id]) => id === original.agent)!.slice(1, 3);
    expect(rowC).toEqual(at(original.tick - 1, original.agent));
    expect(rowC).not.toEqual(at(original.tick, original.agent));
  });
});

describe("determinism harness: faults, planner calls, cancels and clocks", () => {
  it("replays recorded failures and planner calls at their ticks into the same bytes", async () => {
    const recorded = await scriptedMatch();
    const a0 = eventsOfKind(recorded, "Call").filter((e) => e.agent === "a0" && e.role === "actor");
    expect(a0.map((e) => [e.tick, e.ok ? "ok" : e.error?.message])).toEqual([
      [1, "ok"],
      [11, "no answer within 10 ms"],
      [21, "ask failed: network: connection reset"],
      [31, "no answer within 10 ms"],
      [41, "ok"],
    ]);
    expect(eventsOfKind(recorded, "Call").filter((e) => e.role === "planner").map((e) => [e.tick, e.requestedTick, e.ok])).toEqual([[5, 1, true]]);
    expect(bytes(await replayMatch(arena, recorded))).toBe(bytes(recorded));
  });

  it("a log with faults and planner calls, written to a file and read back, replays into the same bytes (review M17)", async () => {
    const recorded = await scriptedMatch();
    expect(bytes(await replayMatch(arena, throughFile(recorded)))).toBe(bytes(recorded));
  });

  it("so does a log from a sloppy model: long decimals, extra keys, keys out of order, a planner reply with extras (review M17)", async () => {
    // What a live model may hand over; the log keeps what the schemas read (R16, R21.a), so the file,
    // the replay and the live run agree.
    let tick = 1;
    const sloppy = scripted("dummy/sloppy", () => ({
      model: "sloppy",
      usage: { outputTokens: 7, inputTokens: 100, cached: 3 },
      ok: true,
      answers: {
        escalate: { type: "noul", noul: 0.3333333333333333 },
        fire: { noul: tick === 11 ? 0.7500000001 : 0.1, type: "noul" },
        move: {
          confidence: 0.4285714285714286,
          probabilities: { forward: 0.4285714285714286, back: 0.14285714285714285, left: 0.14285714285714285, right: 0.14285714285714285, stop: 0.14285714285714285 },
          choice: "forward",
          type: "choice",
          note: "an extra key",
        },
        extra: { type: "noul", noul: 1 },
      } as unknown as Answers,
    }));
    const planner = scripted("dummy/notes", () => ({
      ok: true,
      model: "notes",
      usage: { inputTokens: 1, outputTokens: 1 },
      answers: { scratchpad: { text: "x", type: "text", at: 0 }, plan: { type: "text", text: "Go." } } as unknown as Answers,
    }));
    const recorded = await runMatch(arena, { seed: 11, durationTicks: 45, mapId: "open" }, [player("dummy/sloppy", "dummy/notes"), player("dummy/sloppy")], {
      models: resolver(sloppy, planner),
      onTick: (t) => (tick = t + 1),
    });
    expect(eventsOfKind(recorded, "Shot").length).toBeGreaterThan(0); // the fire P(yes) of tick 11 crossed the threshold
    const file = throughFile(recorded);
    expect(file).toEqual(recorded);
    expect(bytes(await replayMatch(arena, file))).toBe(bytes(recorded));
  });

  it("replays a cancelled match by cancelling after the same tick", async () => {
    const controller = new AbortController();
    const recorded = await runMatch(battleRoyale, SIXTEEN, SIXTEEN_BOTS, { signal: controller.signal, onTick: (tick) => tick === 333 && controller.abort() });
    expect(recorded.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 333, ranking: [] });
    expect(bytes(await replayMatch(battleRoyale, recorded))).toBe(bytes(recorded));
  });

  describe("wall clocks", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("never reach the log: Date.now and performance.now jumping around, with a wall floor, give the same bytes", async () => {
      const config = { ...SIXTEEN, durationTicks: 120 };
      const plain = await runMatch(battleRoyale, config, SIXTEEN_BOTS);
      let rng = createRng(5);
      const jitter = () => {
        const d = nextFloat(rng);
        rng = d.rng;
        return d.value;
      };
      let clock = 1e9;
      vi.spyOn(performance, "now").mockImplementation(() => (clock += 3 * jitter())); // forward, unevenly
      vi.spyOn(Date, "now").mockImplementation(() => Math.floor(1e12 * jitter()));
      const skewed = await runMatch(battleRoyale, config, SIXTEEN_BOTS, { minWallMsPerTick: 1 });
      expect(bytes(skewed)).toBe(bytes(plain));
    });

    it("the sim, the bots, the arena and the loops read no clock and no Math.random; performance.now appears only in the loops' wall floors", () => {
      // The kit and core through the arena's links to them (src/ is TypeScript source, R19).
      const kit = new URL("../node_modules/@decision-arena/kit-shooter/src/", import.meta.url);
      const core = new URL("../node_modules/@decision-arena/core/src/", import.meta.url);
      const own = new URL("../src/", import.meta.url);
      const under = (root: URL, label: string, dir: string) =>
        readdirSync(new URL(dir, root)).map((name) => ({ name: `${label}/${dir}${name}`, text: readFileSync(new URL(`${dir}${name}`, root), "utf8") }));
      const files = [
        ...["sim/", "bots/", "legacy/"].flatMap((dir) => under(kit, "kit", dir)),
        ...under(own, "arena", ""),
        ...["match/", "contracts/"].flatMap((dir) => under(core, "core", dir)),
        ...["rng.ts", "round.ts"].map((name) => ({ name: `core/${name}`, text: readFileSync(new URL(name, core), "utf8") })),
      ];
      expect(files.length).toBeGreaterThan(30);
      const floors = ["kit/legacy/match.ts", "core/match/run.ts"];
      for (const { name, text } of files) {
        const code = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // comments may name them
        expect(code, name).not.toMatch(/Math\.random|Date\.now|new Date\b/);
        if (!floors.includes(name)) expect(code, name).not.toMatch(/performance\.now/);
      }
      for (const name of floors) expect(files.some((file) => file.name === name && /performance\.now/.test(file.text)), name).toBe(true);
    });
  });
});
