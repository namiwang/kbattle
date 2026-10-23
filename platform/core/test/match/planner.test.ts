import { afterEach, describe, expect, it, vi } from "vitest";
import { ESCALATE_THRESHOLD } from "../../src/constants";
import {
  callsOf,
  dummyModel,
  eventsOfKind,
  modelError,
  parseMatchLogFor,
  PLAN_QUESTIONS,
  PLANNER_MAX_GAP_TICKS,
  PLANNER_MIN_GAP_TICKS,
  PLANNER_TIMEOUT_MS,
  type AskRequest,
  type Reply,
} from "../../src/contracts";
import { runMatch } from "../../src/match";
import { counterConfig, fakeArena, stepAnswer } from "../fake-arena";
import { actor, never, outline, planned, player, resolver, scripted, stepped, ticks, upper, USAGE } from "./helpers";

// The planner role (DESIGN.md rows 39–40, §5.3; ruling R22.c–f): asked first at
// tick 1, then on escalate after PLANNER_MIN_GAP_TICKS or forced after
// PLANNER_MAX_GAP_TICKS, one call in flight, never holding a tick; its reply lands
// at the start of the first tick after it settles, rewrites memory when ok and
// leaves it when not, and is logged with its input. On the fake counters arena:
// actor-due ticks 1, 3, 5, … (actorIntervalTicks 2).

afterEach(() => {
  vi.useRealTimers();
});

/** The ticks at which `agent`'s planner was asked, from its Calls. */
const requests = (log: Parameters<typeof callsOf>[0], agent: string) => callsOf(log, agent, "planner").map((call) => call.requestedTick);

describe("the planner's cadence (R22.f)", () => {
  it("asks an agent's planner first at tick 1, with the plan questions and the agent's planner prompt as system", async () => {
    const seen: AskRequest[] = [];
    const planner = scripted("dummy/planner", () => planned("dummy/planner", "Go up."), seen);
    const agent = player("dummy/up", "dummy/planner", { planner: "Win by climbing." });
    await runMatch(fakeArena, counterConfig({ durationTicks: 3 }), [agent, upper], { models: resolver(actor("dummy/up", "up"), planner) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ system: "Win by climbing.", questions: PLAN_QUESTIONS });
  });

  it("asks again when the latest actor reply escalates (≥ ESCALATE_THRESHOLD) once PLANNER_MIN_GAP_TICKS have passed since the last request", async () => {
    const planner = actor("dummy/planner", "up"); // any reply will do: it lands and frees the planner
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 350 }), [player("dummy/hot", "dummy/planner"), upper], {
      models: resolver(actor("dummy/hot", "down", ESCALATE_THRESHOLD), planner),
    });
    expect(PLANNER_MIN_GAP_TICKS).toBe(100);
    expect(requests(log, "a0").slice(0, 4)).toEqual([1, 101, 201, 301]);
  });

  it("does not ask on an escalate below the threshold, and asks after PLANNER_MAX_GAP_TICKS anyway", async () => {
    const planner = actor("dummy/planner", "up");
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 900 }), [player("dummy/cool", "dummy/planner"), upper], {
      models: resolver(actor("dummy/cool", "down", ESCALATE_THRESHOLD - 0.0001), planner),
    });
    expect(PLANNER_MAX_GAP_TICKS).toBe(400);
    expect(requests(log, "a0")).toEqual([1, 401, 801]);
  });

  it("does not count an escalate from a failed actor call: only the latest reply's answers count", async () => {
    // The actor escalates at tick 1, then fails at every later call: no escalate is on record after tick 1.
    const flaky = scripted("dummy/flaky", (_req, n) => (n === 0 ? stepped("dummy/flaky", "down", 1) : { ok: false, error: modelError("server", "busy") }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 450 }), [player("dummy/flaky", "dummy/planner"), upper], {
      models: resolver(flaky, actor("dummy/planner", "up")),
    });
    expect(requests(log, "a0")).toEqual([1, 401]);
  });

  it("keeps one call in flight: no request while its planner thinks, however long; the next at the first due tick after it lands", async () => {
    const clock = ticks();
    const slow = scripted("dummy/slow", (_req, n) => (n === 0 ? clock.after(249).then(() => planned("dummy/slow", "Hold.")) : planned("dummy/slow", "Again.")));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 300 }), [player("dummy/hot", "dummy/slow"), upper], {
      models: resolver(actor("dummy/hot", "down", 1), slow),
      onTick: clock.onTick,
    });
    expect(callsOf(log, "a0", "planner").map((call) => [call.requestedTick, call.tick])).toEqual([
      [1, 250],
      [250, 251],
    ]);
  });

  it("asks only for an active agent: one that left the world is not asked again", async () => {
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 500 }), [player("dummy/climber", "dummy/planner"), player("dummy/down")], {
      models: resolver(actor("dummy/climber", "up", 1), actor("dummy/planner", "up"), actor("dummy/down", "down")),
    });
    expect(eventsOfKind(log, "Step").filter((step) => step.agent === "a0").at(-1)?.tick).toBe(5); // it left at +5
    expect(requests(log, "a0")).toEqual([1]);
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: 500 });
  });

  it("never holds a tick: the match plays to its end while the planner never answers", async () => {
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/down", "dummy/mute"), upper], {
      models: resolver(actor("dummy/down", "down"), scripted("dummy/mute", never)),
    });
    expect(eventsOfKind(log, "Tick").map((tick) => tick.tick)).toEqual(Array.from({ length: 41 }, (_, t) => t));
    expect(log.events.at(-1)).toMatchObject({ kind: "MatchEnd", tick: 40 });
  });
});

describe("the planner's call (R22.f, e)", () => {
  it("states what it is asked: the arena's static text, the observation as text, the agent's memory and the tick", async () => {
    const seen: AskRequest[] = [];
    const planner = scripted("dummy/planner", (_req, n) => planned("dummy/planner", `Plan ${n}.`, `Note ${n}.`), seen);
    const config = counterConfig({ durationTicks: 120, start: -2 });
    await runMatch(fakeArena, config, [player("dummy/hot", "dummy/planner"), upper], { models: resolver(actor("dummy/hot", "down", 1), planner) });
    expect(seen.map((req) => req.state)).toEqual([
      { static: fakeArena.staticText(config), observation: "counter -2, 120 ticks left", memory: { plan: "", scratchpad: "" }, tick: 1 },
      { static: fakeArena.staticText(config), observation: "counter -102, 20 ticks left", memory: { plan: "Plan 0.", scratchpad: "Note 0." }, tick: 101 },
    ]);
  });

  it("uses the arena's default planner prompt when the agent's is blank", async () => {
    const seen: AskRequest[] = [];
    const planner = scripted("dummy/planner", () => planned("dummy/planner", "Up."), seen);
    await runMatch(fakeArena, counterConfig({ durationTicks: 2 }), [player("dummy/up", "dummy/planner", { planner: " \n " }), upper], {
      models: resolver(actor("dummy/up", "up"), planner),
    });
    expect(seen[0]?.system).toBe(fakeArena.defaults.planner);
  });

  it("logs a landed call with its input, answers and usage, under the model's own name, never its questions", async () => {
    const planner = scripted("dummy/planner", () => planned("claude-ish", "Go up.", "a note"));
    const config = counterConfig({ durationTicks: 4 });
    const log = await runMatch(fakeArena, config, [player("dummy/up", "dummy/planner"), upper], { models: resolver(actor("dummy/up", "up"), planner) });
    expect(callsOf(log, "a0", "planner")).toEqual([
      {
        kind: "Call",
        tick: 2,
        requestedTick: 1,
        agent: "a0",
        role: "planner",
        model: "claude-ish",
        ok: true,
        answers: { plan: { type: "text", text: "Go up." }, scratchpad: { type: "text", text: "a note" } },
        usage: USAGE,
        input: { static: fakeArena.staticText(config), observation: "counter 0, 4 ticks left", memory: { plan: "", scratchpad: "" }, tick: 1 },
      },
    ]);
    expect(Object.keys(callsOf(log, "a0", "planner")[0]!)).toEqual(["kind", "tick", "requestedTick", "agent", "role", "model", "ok", "answers", "usage", "input"]);
    expect(parseMatchLogFor(fakeArena, JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("logs a failed call with its input and error, under the agent's model id, with no usage", async () => {
    const planner = scripted("dummy/planner", () => ({ ok: false, error: modelError("refusal", "no comment") }));
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/up", "dummy/planner"), upper], {
      models: resolver(actor("dummy/up", "up"), planner),
    });
    const [call] = callsOf(log, "a0", "planner");
    expect(call).toMatchObject({ tick: 2, requestedTick: 1, model: "dummy/planner", ok: false, error: { kind: "refusal", fatal: false, message: "no comment" } });
    expect(call).toHaveProperty("input");
    expect(call).not.toHaveProperty("usage");
  });

  it("does not let a model that changes its request change the log", async () => {
    const planner = scripted("dummy/vandal", (req) => {
      (req.state as { memory: { plan: string } }).memory.plan = "scribbled";
      return planned("dummy/vandal", "Up.");
    });
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 3 }), [player("dummy/up", "dummy/vandal"), upper], {
      models: resolver(actor("dummy/up", "up"), planner),
    });
    expect(callsOf(log, "a0", "planner")[0]?.input).toMatchObject({ memory: { plan: "", scratchpad: "" } });
  });
});

describe("when a planner reply lands (R22.c, f)", () => {
  it("at the start of the first tick after it settles, before that tick's actor calls, in slot order", async () => {
    const clock = ticks();
    const late = (name: string, at: number) => scripted(name, () => clock.after(at).then(() => planned(name, `${name} plan`)));
    // a1's reply settles first (during tick 2), a0's later (during tick 6); a0 and a1 both land at a due tick.
    const log = await runMatch(
      fakeArena,
      counterConfig({ durationTicks: 8 }),
      [player("dummy/down", "dummy/p0"), player("dummy/down", "dummy/p1")],
      { models: resolver(actor("dummy/down", "down"), late("dummy/p0", 6), late("dummy/p1", 2)), onTick: clock.onTick },
    );
    expect(outline(log.events.filter((event) => event.tick === 3 || event.tick === 7))).toEqual([
      ["Call", 3, "a1", "planner"],
      ["Call", 3, "a0", "actor"],
      ["Call", 3, "a1", "actor"],
      ["Step", 3, "a0"],
      ["Step", 3, "a1"],
      ["Tick", 3],
      ["Call", 7, "a0", "planner"],
      ["Call", 7, "a0", "actor"],
      ["Call", 7, "a1", "actor"],
      ["Step", 7, "a0"],
      ["Step", 7, "a1"],
      ["Tick", 7],
    ]);
  });

  it("logs replies that land on the same tick in slot order, whatever order they settled in", async () => {
    const clock = ticks();
    let order = 0;
    const settled: string[] = [];
    const late = (name: string) =>
      scripted(name, () =>
        clock.after(4).then(async () => {
          if (name === "dummy/p0") await null; // a0's settles a little after a1's
          settled.push(`${name} ${order++}`);
          return planned(name, "Hold.");
        }),
      );
    const log = await runMatch(
      fakeArena,
      counterConfig({ durationTicks: 6 }),
      [player("dummy/down", "dummy/p0"), player("dummy/down", "dummy/p1")],
      { models: resolver(actor("dummy/down", "down"), late("dummy/p0"), late("dummy/p1")), onTick: clock.onTick },
    );
    expect(settled).toEqual(["dummy/p1 0", "dummy/p0 1"]);
    expect(outline(eventsOfKind(log, "Call").filter((call) => call.role === "planner"))).toEqual([
      ["Call", 5, "a0", "planner"],
      ["Call", 5, "a1", "planner"],
    ]);
  });

  it("a model that answers at once lands at the next tick", async () => {
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 4 }), [player("dummy/up", "dummy/quick"), upper], {
      models: resolver(actor("dummy/up", "up"), dummyModel("dummy/quick", () => ({ plan: { type: "text", text: "Up." }, scratchpad: { type: "text", text: "" } }))),
    });
    expect(callsOf(log, "a0", "planner").map((call) => [call.requestedTick, call.tick, call.ok])).toEqual([[1, 2, true]]);
  });
});

describe("memory (R22.f, principle 6)", () => {
  it("an ok reply becomes the agent's plan and scratchpad; the actor reads the plan from that tick on", async () => {
    const clock = ticks();
    const actorSeen: AskRequest[] = [];
    const planner = scripted("dummy/planner", () => clock.after(4).then(() => planned("dummy/planner", "Climb now.", "first plan")));
    await runMatch(fakeArena, counterConfig({ durationTicks: 8 }), [player("dummy/spy", "dummy/planner"), upper], {
      models: resolver(scripted("dummy/spy", () => stepped("dummy/spy", "down"), actorSeen), planner),
      onTick: clock.onTick,
    });
    expect(actorSeen.map((req) => (req.state as { plan: string }).plan)).toEqual(["", "", "Climb now.", "Climb now."]); // ticks 1, 3, 5, 7
  });

  it("a failed call leaves memory as it was: an error, a timeout, an answer that does not hold up", async () => {
    const seen: AskRequest[] = [];
    const replies: (() => Reply | Promise<Reply>)[] = [
      () => planned("dummy/planner", "P1", "S1"),
      () => ({ ok: false, error: modelError("server", "bad gateway", 502) }),
      never, // times out
      () => planned("dummy/planner", "x".repeat(2001), "too long"),
      () => ({ ok: true, answers: { plan: { type: "choice", choice: "a", probabilities: {}, confidence: 1 } }, usage: USAGE, model: "dummy/planner" }) as Reply,
      () => planned("dummy/planner", "P2", "S2"),
    ];
    const planner = scripted("dummy/planner", (_req, n) => replies[n]!(), seen);
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 520 }), [player("dummy/hot", "dummy/planner"), upper], {
      models: resolver(actor("dummy/hot", "down", 1), planner),
      timeoutMs: (model, role) => (role === "planner" ? 30 : 1000),
      minWallMsPerTick: 1,
    });
    const calls = callsOf(log, "a0", "planner");
    expect(calls.map((call) => (call.ok ? "ok" : call.error?.kind))).toEqual(["ok", "server", "timeout", "invalid_output", "invalid_output", "ok"]);
    expect(calls.map((call) => call.error?.message)).toEqual([
      undefined,
      "bad gateway",
      "no answer within 30 ms",
      "invalid answer: plan.text: Too big: expected string to have <=2000 characters",
      'invalid answer: plan.type: Invalid input: expected "text"',
      undefined,
    ]);
    expect(seen.map((req) => (req.state as { memory: unknown }).memory)).toEqual([
      { plan: "", scratchpad: "" },
      { plan: "P1", scratchpad: "S1" },
      { plan: "P1", scratchpad: "S1" },
      { plan: "P1", scratchpad: "S1" },
      { plan: "P1", scratchpad: "S1" },
      { plan: "P1", scratchpad: "S1" },
    ]);
  }, 20_000);

  it("a reply without a plan or without a scratchpad keeps that part (ISSUES I-035)", async () => {
    const seen: AskRequest[] = [];
    const replies: Reply[] = [
      planned("dummy/planner", "P1", "S1"),
      { ok: true, answers: { scratchpad: { type: "text", text: "S2" } }, usage: USAGE, model: "dummy/planner" },
      { ok: true, answers: { plan: { type: "text", text: "P3" } }, usage: USAGE, model: "dummy/planner" },
      planned("dummy/planner", "", ""),
    ];
    const planner = scripted("dummy/planner", (_req, n) => replies[n] ?? planned("dummy/planner", "end"), seen);
    await runMatch(fakeArena, counterConfig({ durationTicks: 402 }), [player("dummy/hot", "dummy/planner"), upper], { models: resolver(actor("dummy/hot", "down", 1), planner) });
    expect(seen.map((req) => (req.state as { memory: unknown }).memory)).toEqual([
      { plan: "", scratchpad: "" },
      { plan: "P1", scratchpad: "S1" },
      { plan: "P1", scratchpad: "S2" },
      { plan: "P3", scratchpad: "S2" },
      { plan: "", scratchpad: "" }, // an empty plan is a plan
    ]);
  });
});

describe("the planner's timeout and signal (R22.f, R17)", () => {
  it("asks deps.timeoutMs for the planner's model and role", async () => {
    const asked: [string, string][] = [];
    await runMatch(fakeArena, counterConfig({ durationTicks: 1 }), [player("dummy/up", "dummy/planner"), upper], {
      models: resolver(actor("dummy/up", "up"), actor("dummy/planner", "up")),
      timeoutMs: (model, role) => {
        asked.push([model.id, role]);
        return 1000;
      },
    });
    expect(asked).toEqual([
      ["dummy/planner", "planner"],
      ["dummy/up", "actor"],
      ["bot/upper", "actor"],
    ]);
  });

  it("gives up after PLANNER_TIMEOUT_MS when deps.timeoutMs is absent, aborting the call's signal; the reply lands at the next tick", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const mute = scripted("dummy/mute", (req) => {
      signals.push(req.signal);
      return never();
    });
    // Every actor call times out too (ACTOR_TIMEOUT_MS, 2 s): ticks 1, 3, …, 19 take 2 s each, so tick 19's ends at 20 s.
    const running = runMatch(fakeArena, counterConfig({ durationTicks: 30 }), [player("dummy/hang", "dummy/mute"), player("dummy/hang")], {
      models: resolver(scripted("dummy/hang", never), mute),
    });
    await vi.advanceTimersByTimeAsync(PLANNER_TIMEOUT_MS - 1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000); // through tick 29's actor calls, the last
    const log = await running;
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toMatchObject({ name: "TimeoutError" });
    expect(callsOf(log, "a0", "planner")[0]).toMatchObject({
      tick: 20,
      requestedTick: 1,
      ok: false,
      error: { kind: "timeout", fatal: false, message: `no answer within ${PLANNER_TIMEOUT_MS} ms` },
    });
  });

  it("aborts the planner's signal when the match is cancelled, and logs the call in flight as aborted at the end", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const mute = scripted("dummy/mute", (req) => {
      signals.push(req.signal);
      return never();
    });
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 40 }), [player("dummy/down", "dummy/mute"), upper], {
      models: resolver(actor("dummy/down", "down"), mute),
      signal: controller.signal,
      onTick: (tick) => tick === 5 && controller.abort(),
    });
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(log.events.slice(-3)).toEqual([
      expect.objectContaining({ kind: "Tick", tick: 5 }),
      expect.objectContaining({
        kind: "Call",
        tick: 5,
        requestedTick: 1,
        agent: "a0",
        role: "planner",
        model: "dummy/mute",
        ok: false,
        error: { kind: "aborted", fatal: false, message: "the match was cancelled" },
      }),
      { kind: "MatchEnd", tick: 5, ranking: [] },
    ]);
  });

  it("cuts a call still in flight when the match ends, aborting its signal, and logs it after the last Tick (principle 4)", async () => {
    const signals: AbortSignal[] = [];
    const mute = scripted("dummy/mute", (req) => {
      signals.push(req.signal);
      return never();
    });
    const log = await runMatch(fakeArena, counterConfig({ durationTicks: 6 }), [player("dummy/down", "dummy/mute"), player("dummy/down", "dummy/mute")], {
      models: resolver(actor("dummy/down", "down"), mute),
    });
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
    expect(outline(log.events.slice(-4))).toEqual([
      ["Tick", 6],
      ["Call", 6, "a0", "planner"],
      ["Call", 6, "a1", "planner"],
      ["MatchEnd", 6],
    ]);
    expect(callsOf(log, "a1", "planner")[0]).toMatchObject({ requestedTick: 1, ok: false, error: { kind: "aborted", fatal: false, message: "the match ended" } });
    expect(log.events.at(-1)).toEqual({ kind: "MatchEnd", tick: 6, ranking: ["a0", "a1"], results: { a0: -6, a1: -6 } });
  });
});

describe("planner-less agents and bots (R22.f)", () => {
  it("never asks a planner for an agent without one", async () => {
    const seen: AskRequest[] = [];
    await runMatch(fakeArena, counterConfig({ durationTicks: 450 }), [player("dummy/spy"), upper], {
      models: resolver(scripted("dummy/spy", () => ({ ok: true, answers: { ...stepAnswer("down"), escalate: { type: "noul", noul: 1 } }, usage: USAGE, model: "dummy/spy" }), seen)),
    });
    expect(seen.every((req) => Object.keys(req.questions).includes("step"))).toBe(true);
  });
});
