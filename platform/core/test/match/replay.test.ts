import { describe, expect, it } from "vitest";
import {
  callsOf,
  eventsOfKind,
  modelError,
  parseMatchLog,
  parseMatchLogFor,
  type AgentSpec,
  type AskRequest,
  type CallEvent,
  type MatchLog,
  type Reply,
} from "../../src/contracts";
import { makeReplayingModel, replayMatch, runMatch } from "../../src/match";
import { counterConfig, fakeArena, stepAnswer, type CounterTypes } from "../fake-arena";
import { actor, never, planned, player, resolver, scripted, stepped, ticks, upper, USAGE } from "./helpers";

// Replay (DESIGN.md §5.3 "replaying", §5.5; ruling R22.h, k): replaying models
// answer from a log's Call events instead of thinking, and replayMatch plays the
// match again with one per role per agent; the log comes back byte for byte.
// What a clock decided in the recording (a timeout, the tick a planner reply
// landed on, a cancel) comes back from the log, never from this run's clock.

const bytes = (log: unknown) => JSON.stringify(log);
const ask = (model: { ask: (req: AskRequest) => Promise<Reply> }) =>
  model.ask({ state: {}, questions: { step: { type: "choice", instructions: "Step.", criteria: { up: "up", down: "down" } } }, signal: new AbortController().signal });

/** A log written to a file and read back (principle 7). */
const throughFile = (log: MatchLog): MatchLog => parseMatchLog(JSON.parse(JSON.stringify(log)));

const call = (over: Partial<CallEvent> & Pick<CallEvent, "tick" | "agent" | "role">): CallEvent =>
  ({ kind: "Call", requestedTick: over.tick, model: "dummy/x", ok: true, answers: stepAnswer("up"), usage: USAGE, ...over }) as CallEvent;

/** A hand-made log: a0's actor at 1 (ok) and 3 (timeout), its planner asked at 1 and landing at 5, and one cut at the end. */
const RECORDED = {
  agents: [player("dummy/a0", "dummy/p0"), upper] satisfies AgentSpec[],
  events: [
    { kind: "Tick", tick: 0, data: {} },
    call({ tick: 1, agent: "a0", role: "actor", model: "a0-v2" }),
    { kind: "Tick", tick: 1, data: {} },
    call({ tick: 3, agent: "a0", role: "actor", ok: false, answers: undefined, usage: undefined, error: modelError("timeout", "no answer within 2000 ms") }),
    { kind: "Tick", tick: 3, data: {} },
    call({ tick: 5, requestedTick: 1, agent: "a0", role: "planner", answers: { plan: { type: "text", text: "Up." } }, model: "planner-v1" }),
    { kind: "Tick", tick: 5, data: {} },
    call({ tick: 5, requestedTick: 5, agent: "a0", role: "planner", ok: false, answers: undefined, usage: undefined, error: modelError("aborted", "the match ended") }),
    { kind: "MatchEnd", tick: 5, ranking: ["a0", "a1"] },
  ],
};

describe("makeReplayingModel (R22.k)", () => {
  it("is named after the agent's recorded model for that role", () => {
    expect(makeReplayingModel(RECORDED, "a0", "actor").id).toBe("dummy/a0");
    expect(makeReplayingModel(RECORDED, "a0", "planner").id).toBe("dummy/p0");
    expect(makeReplayingModel(RECORDED, "a1", "actor").id).toBe("bot/upper");
  });

  it("answers the actor's calls in order, each at its recorded tick, with the recorded answers, usage and model name", async () => {
    const a0 = makeReplayingModel(RECORDED, "a0", "actor");
    a0.tickDone(0);
    await expect(ask(a0)).resolves.toEqual({ ok: true, answers: stepAnswer("up"), usage: USAGE, model: "a0-v2" });
  });

  it("gives a recorded failure back as the recorded error", async () => {
    const a0 = makeReplayingModel(RECORDED, "a0", "actor");
    a0.tickDone(0);
    await ask(a0);
    a0.tickDone(2);
    await expect(ask(a0)).resolves.toEqual({ ok: false, error: { kind: "timeout", fatal: false, message: "no answer within 2000 ms" } });
  });

  it("answers a call it has no record of, or at another tick, with an error naming the agent, the role and the tick", async () => {
    const a0 = makeReplayingModel(RECORDED, "a0", "actor");
    a0.tickDone(1); // asked at tick 2, but its first call was recorded at tick 1
    await expect(ask(a0)).resolves.toEqual({ ok: false, error: { kind: "invalid_output", fatal: false, message: "replay: no recorded actor call for a0 at tick 2" } });
    const a1 = makeReplayingModel(RECORDED, "a1", "actor");
    await expect(ask(a1)).resolves.toMatchObject({ ok: false, error: { message: "replay: no recorded actor call for a1 at tick 1" } });
  });

  it("holds a planner's reply until the tick before its recorded landing has been logged", async () => {
    const p0 = makeReplayingModel(RECORDED, "a0", "planner");
    p0.tickDone(0);
    let reply: Reply | undefined;
    void ask(p0).then((r) => (reply = r));
    for (const tick of [1, 2, 3]) {
      p0.tickDone(tick);
      await Promise.resolve();
      expect(reply, `after tick ${tick}`).toBeUndefined();
    }
    p0.tickDone(4);
    await Promise.resolve();
    expect(reply).toEqual({ ok: true, answers: { plan: { type: "text", text: "Up." } }, usage: USAGE, model: "planner-v1" });
  });

  it("never answers a planner call the recording cut at its end: the replayed match cuts it the same way", async () => {
    const p0 = makeReplayingModel(RECORDED, "a0", "planner");
    p0.tickDone(0);
    void ask(p0);
    for (const tick of [1, 2, 3, 4]) p0.tickDone(tick);
    let settled = false;
    void ask(p0).then(() => (settled = true));
    for (const tick of [5, 6, 7]) p0.tickDone(tick);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
  });
});

describe("replayMatch (R22.k)", () => {
  it("replays a match of bots and dummies byte for byte", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 30 }), [upper, player("dummy/down"), upper], {
      models: resolver(actor("dummy/down", "down")),
    });
    expect(bytes(await replayMatch(fakeArena, recorded))).toBe(bytes(recorded));
  });

  /** The match R22.k names: bots, and fake actor and planner models with timeouts, failures and a late planner. */
  async function eventful(): Promise<MatchLog> {
    const clock = ticks();
    let a0Calls = 0;
    // a0 walks down (it never leaves) and always escalates, so its planner is asked at 1, 101, 201, 301 and 401.
    const a0 = scripted("dummy/a0", () => {
      a0Calls++;
      if (a0Calls === 3) return never(); // times out
      if (a0Calls === 4) throw new Error("connection reset"); // rejects
      if (a0Calls === 5) return { ok: false, error: modelError("rate_limit", "slow down", 429) };
      return stepped("dummy/a0", "down", 0.9);
    });
    let p0Calls = 0;
    const p0 = scripted("dummy/p0", (req) => {
      p0Calls++;
      const asked = (req.state as { tick: number }).tick;
      if (p0Calls === 1) return clock.after(asked + 3).then(() => planned("p0-model", "Go down.", "first")); // lands 4 ticks after it was asked
      if (p0Calls === 2) return { ok: false, error: modelError("server", "overloaded", 529) };
      return never(); // times out (planner timeout below), or is cut at the end
    });
    const p2 = scripted("dummy/p2", () => planned("p2-model", "Climb."));
    return runMatch(
      fakeArena,
      counterConfig({ durationTicks: 420, seed: 3 }),
      [player("dummy/a0", "dummy/p0", { actor: { step: "Mind the plan." } }), upper, player("dummy/a2", "dummy/p2")],
      {
        models: resolver(a0, p0, actor("dummy/a2", "down", 1), p2),
        timeoutMs: (_model, role) => (role === "actor" ? 5 : 40),
        minWallMsPerTick: 0.5,
        onTick: clock.onTick,
      },
    );
  }

  it("replays bots, timeouts, failures and a planner landing ticks after its request, byte for byte", async () => {
    const recorded = await eventful();
    const kinds = (role: string) => callsOf(recorded, "a0").filter((c) => c.role === role).map((c) => (c.ok ? "ok" : c.error?.kind));
    expect(kinds("actor").slice(0, 6)).toEqual(["ok", "ok", "timeout", "invalid_output", "rate_limit", "ok"]);
    expect(kinds("planner").slice(0, 3)).toEqual(["ok", "server", "timeout"]);
    const late = callsOf(recorded, "a0", "planner")[0]!;
    expect(late.tick - late.requestedTick).toBe(4);
    expect(callsOf(recorded, "a0", "planner").at(-1)).toMatchObject({ requestedTick: 401, tick: 420, error: { message: "the match ended" } }); // cut at the end
    expect(callsOf(recorded, "a2", "planner").length).toBeGreaterThan(2);
    const replayed = await replayMatch(fakeArena, recorded);
    expect(bytes(replayed)).toBe(bytes(recorded));
  }, 20_000);

  it("replays a log written to a file and read back into the same bytes", async () => {
    const recorded = await eventful();
    expect(throughFile(recorded)).toEqual(recorded);
    expect(bytes(await replayMatch(fakeArena, throughFile(recorded)))).toBe(bytes(recorded));
    expect(bytes(await replayMatch(fakeArena, parseMatchLogFor(fakeArena, JSON.parse(bytes(recorded)))))).toBe(bytes(recorded));
  }, 20_000);

  it("replays a cancelled match by cancelling after the same tick, calls in flight and all", async () => {
    const controller = new AbortController();
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 60 }), [player("dummy/hang", "dummy/mute"), upper], {
      models: resolver(scripted("dummy/hang", (_req, n) => (n < 3 ? stepped("dummy/hang", "down") : (setTimeout(() => controller.abort(), 2), never()))), scripted("dummy/mute", never)),
      timeoutMs: () => 60_000,
      signal: controller.signal,
    });
    expect(recorded.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 7, ranking: [] });
    expect(callsOf(recorded, "a0").map((c) => c.error?.message)).toEqual([undefined, undefined, undefined, "the match was cancelled", "the match was cancelled"]);
    expect(bytes(await replayMatch(fakeArena, recorded))).toBe(bytes(recorded));
  });

  it("replays a match that a fatal reply ended", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 60 }), [player("dummy/keyless", "dummy/mute"), upper], {
      models: resolver(scripted("dummy/keyless", (_req, n) => (n < 2 ? stepped("dummy/keyless", "down") : { ok: false, error: modelError("auth", "bad key", 401) })), scripted("dummy/mute", never)),
    });
    expect(recorded.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 5, ranking: [] });
    expect(bytes(await replayMatch(fakeArena, recorded))).toBe(bytes(recorded));
  });

  it("replays a match cancelled before its first tick", async () => {
    const recorded = await runMatch(fakeArena, counterConfig(), [player("dummy/down", "dummy/p"), upper], {
      models: resolver(actor("dummy/down", "down"), actor("dummy/p", "up")),
      signal: AbortSignal.abort(),
    });
    expect(recorded.events.map((e) => e.kind)).toEqual(["Tick", "MatchEnd"]);
    expect(bytes(await replayMatch(fakeArena, recorded))).toBe(bytes(recorded));
  });

  it("changing one recorded answer changes the log from that call on (determinism, not caching)", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 12 }), [player("dummy/down"), upper], { models: resolver(actor("dummy/down", "down")) });
    const mutated = structuredClone(recorded);
    const index = mutated.events.findIndex((e) => e.kind === "Call" && (e as CallEvent).agent === "a0" && e.tick === 5);
    (mutated.events[index] as CallEvent).answers = stepAnswer("up");
    const changed = await replayMatch(fakeArena, mutated);
    const first = changed.events.findIndex((e, i) => bytes(e) !== bytes(recorded.events[i]));
    expect(first).toBe(index);
    expect(eventsOfKind(changed, "Step").find((s) => s.tick === 5 && s.agent === "a0")?.delta).toBe(1);
    expect(eventsOfKind(recorded, "Step").find((s) => s.tick === 5 && s.agent === "a0")?.delta).toBe(-1);
  });

  it("never waits on this run's clock: a recording's timeouts come back from the log at once", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 20 }), [player("dummy/hang"), upper], {
      models: resolver(scripted("dummy/hang", never)),
      timeoutMs: () => 50,
    });
    const started = performance.now();
    const replayed = await replayMatch(fakeArena, recorded);
    expect(performance.now() - started).toBeLessThan(50 * 10); // 10 timeouts recorded, none waited out
    expect(bytes(replayed)).toBe(bytes(recorded));
  });

  it("forwards the caller's onTick, with the replayed state", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [upper, upper]);
    const seen: [number, CounterTypes["State"]["counters"]][] = [];
    await replayMatch(fakeArena, recorded, { onTick: (tick, state) => seen.push([tick, state.counters]) });
    expect(seen.map(([tick, counters]) => [tick, counters.a0])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("refuses a log of another arena, before anything runs", async () => {
    const recorded = await runMatch(fakeArena, counterConfig({ durationTicks: 2 }), [upper, upper]);
    await expect(replayMatch({ ...fakeArena, id: "racing" }, recorded)).rejects.toThrow(/written for "counters", not "racing"/);
  });
});
