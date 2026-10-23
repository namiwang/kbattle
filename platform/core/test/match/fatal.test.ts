import { describe, expect, it } from "vitest";
import { callsOf, eventsOfKind, modelError, type CallEvent } from "../../src/contracts";
import { runMatch } from "../../src/match";
import { counterConfig, fakeArena } from "../fake-arena";
import { actor, never, outline, planned, player, resolver, scripted, stepped, ticks, upper } from "./helpers";

// Fatal model errors (DESIGN.md row 29; ruling R22.g; v3 ISSUES I-012): a reply
// whose error is fatal (a bad key, no credit, a model the account cannot use)
// ends the match after the tick in progress, like a cancel (MatchEnd ranking []);
// the Call says why, and deps.onFatal hears of it first.

const fatal = { ok: false as const, error: modelError("auth", "invalid x-api-key", 401) };

describe("a fatal reply ends the match (R22.g)", () => {
  it("from the actor: the tick in progress completes, then MatchEnd with ranking []; the Call says why", async () => {
    const keyless = scripted("dummy/keyless", (_req, n) => (n === 0 ? stepped("dummy/keyless", "down") : fatal));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/keyless"), player("dummy/down")], {
      models: resolver(keyless, actor("dummy/down", "down")),
    });
    expect(outline(log.events.slice(-6))).toEqual([
      ["Call", 3, "a0", "actor"],
      ["Call", 3, "a1", "actor"],
      ["Step", 3, "a0"],
      ["Step", 3, "a1"],
      ["Tick", 3],
      ["MatchEnd", 3],
    ]);
    expect(callsOf(log, "a0")[1]).toMatchObject({ ok: false, model: "dummy/keyless", error: { kind: "auth", fatal: true, message: "invalid x-api-key", status: 401 } });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 3, ranking: [] });
  });

  it("from the planner: the match ends after the tick its reply lands in", async () => {
    const broke = scripted("dummy/broke", () => ({ ok: false, error: modelError("billing", "credit balance too low", 402) }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/down", "dummy/broke"), upper], {
      models: resolver(actor("dummy/down", "down"), broke),
    });
    expect(outline(log.events.filter((event) => event.tick === 2))).toEqual([
      ["Call", 2, "a0", "planner"],
      ["Step", 2, "a0"],
      ["Step", 2, "a1"],
      ["Tick", 2],
      ["MatchEnd", 2],
    ]);
    expect(callsOf(log, "a0", "planner")[0]).toMatchObject({ requestedTick: 1, error: { kind: "billing", fatal: true } });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 2, ranking: [] });
  });

  it("any error the model marks fatal counts, whatever its kind", async () => {
    const odd = scripted("dummy/odd", () => ({ ok: false, error: { kind: "server", fatal: true, message: "account closed" } }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/odd"), upper], { models: resolver(odd) });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 1, ranking: [] });
  });

  it("calls deps.onFatal once, with the first fatal Call, before the match ends", async () => {
    const heard: { call: CallEvent; lastTick: number }[] = [];
    let lastTick = -1;
    const keyless = scripted("dummy/keyless", () => fatal);
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/keyless"), player("dummy/keyless")], {
      models: resolver(keyless),
      onTick: (tick) => {
        lastTick = tick;
      },
      onFatal: (call) => heard.push({ call, lastTick }),
    });
    expect(callsOf(log, "a1")[0]?.error?.fatal).toBe(true); // both failed fatally
    expect(heard).toEqual([{ call: callsOf(log, "a0")[0], lastTick: 0 }]); // during tick 1, before its Tick and the MatchEnd
    expect(eventsOfKind(log, "Tick").at(-1)?.tick).toBe(1);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 1, ranking: [] });
  });

  it("asks no planner after a fatal reply: the tick it lands in requests nothing", async () => {
    const clock = ticks();
    // a0's planner fails fatally, landing at tick 101; a1 escalates, so its planner is due at 101 too.
    const broke = scripted("dummy/broke", () => clock.after(100).then(() => ({ ok: false as const, error: modelError("not_found", "no such model", 404) })));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 400 }), [player("dummy/down", "dummy/broke"), player("dummy/hot", "dummy/planner")], {
      models: resolver(actor("dummy/down", "down"), broke, actor("dummy/hot", "down", 1), scripted("dummy/planner", () => planned("dummy/planner", "Hold."))),
      onTick: clock.onTick,
    });
    expect(callsOf(log, "a0", "planner").map((call) => call.tick)).toEqual([101]);
    expect(callsOf(log, "a1", "planner").map((call) => call.requestedTick)).toEqual([1]);
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 101, ranking: [] });
  });

  it("keeps the arena's ending when the match ends on the tick of a fatal reply", async () => {
    // a0 climbs with a1 (a bot) and fails fatally at tick 5, the tick both reach +5 and leave: the arena ended it.
    const keyless = scripted("dummy/keyless", (_req, n) => (n < 2 ? stepped("dummy/keyless", "up") : fatal));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/keyless"), upper], { models: resolver(keyless) });
    expect(callsOf(log, "a0").at(-1)).toMatchObject({ tick: 5, error: { fatal: true } });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 5, ranking: ["a0", "a1"], results: { a0: 5, a1: 5 } });
  });

  it("cuts the other planners' calls in flight at the end, logging them as aborted", async () => {
    const keyless = scripted("dummy/keyless", () => fatal);
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/keyless"), player("dummy/down", "dummy/mute")], {
      models: resolver(keyless, actor("dummy/down", "down"), scripted("dummy/mute", never)),
    });
    expect(callsOf(log, "a1", "planner")).toEqual([
      expect.objectContaining({ tick: 1, requestedTick: 1, ok: false, error: { kind: "aborted", fatal: false, message: "the match ended" } }),
    ]);
  });
});
