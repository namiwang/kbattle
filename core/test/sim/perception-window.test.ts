import { beforeAll, describe, expect, it } from "vitest";
import { bearingTo, normalizeDeg } from "../../src/angles";
import { botProviders } from "../../src/bots";
import { DOER_INTERVAL_TICKS, HEAR_SHOT_RANGE_M, HEARING_BANDS_M, MATCH_DURATION_TICKS } from "../../src/constants";
import { eventsOfKind } from "../../src/log";
import type { MatchConfig, MatchLog, Prompts, Slot } from "../../src/schemas";
import { runMatch } from "../../src/sim/match";
import type { AgentId, HearingBand, Observation } from "../../src/types";
import { dist, type Vec2 } from "../../src/vec2";

// The perception window (sim ruling R15, review C1). Every slot decides on ticks
// 1, 11, 21, … (R1) from the world before that tick's step, and a weapon cools
// down over exactly DOER_INTERVAL_TICKS, so shots land on decision ticks: when
// perception read only the newest step, no decision ever heard a shot. Perception
// now merges the shots, hits and near misses of the last DOER_INTERVAL_TICKS
// steps, so each one reaches the next decision of every agent that perceives it,
// exactly once. Checked from outside the sim: a spy records the observation of
// every doer call of a 16-bot match, and the log says what happened.

const PROMPTS: Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };

/** The v1.5 match: 16 bots, wanderers and campers alternating, on arena-1, seed 7. */
const SIXTEEN: MatchConfig = {
  mapId: "arena-1",
  seed: 7,
  durationTicks: MATCH_DURATION_TICKS,
  slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
};

interface Decision {
  tick: number;
  agent: AgentId;
  observation: Observation;
}

const band = (d: number): HearingBand => (d < HEARING_BANDS_M.near ? "near" : d < HEARING_BANDS_M.mid ? "mid" : "far");

/**
 * Whether `d` is so close to a band edge or the hearing range that the rows' rounding can move it
 * across, or, for a position taken from an earlier row (`approx`), up to a step of walking.
 */
const borderline = (d: number, approx = false) =>
  [HEARING_BANDS_M.near, HEARING_BANDS_M.mid, HEAR_SHOT_RANGE_M].some((edge) => Math.abs(d - edge) < (approx ? 0.3 : 0.02));

/**
 * A maximum matching between `as` and `bs` under `fits` (augmenting paths): for each a, the index
 * of the b it takes, or -1. Lists here are a dozen entries, so the quadratic search is cheap.
 */
function maxMatching<A, B>(as: readonly A[], bs: readonly B[], fits: (a: A, b: B) => boolean): number[] {
  const owner = new Array<number>(bs.length).fill(-1); // b → the a that took it
  const take = (a: number, seen: boolean[]): boolean => {
    for (let b = 0; b < bs.length; b++) {
      if (seen[b] || !fits(as[a]!, bs[b]!)) continue;
      seen[b] = true;
      if (owner[b] === -1 || take(owner[b]!, seen)) {
        owner[b] = a;
        return true;
      }
    }
    return false;
  };
  for (let a = 0; a < as.length; a++) take(a, new Array<boolean>(bs.length).fill(false));
  const taken = new Array<number>(as.length).fill(-1);
  owner.forEach((a, b) => {
    if (a >= 0) taken[a] = b;
  });
  return taken;
}

describe("perception window: 16 bots on arena-1, seed 7 (R15, review C1)", () => {
  let log: MatchLog;
  const decisions: Decision[] = [];
  /** Where the log puts each agent at a tick: its row; `approx` when the row omits it (it died in or before that step: its last row, ISSUES I-019). */
  let placed: (tick: number, id: AgentId) => { pos: Vec2; approx: boolean } | undefined;
  let rows: Map<number, Map<AgentId, Vec2>>;

  beforeAll(async () => {
    const bots = botProviders(SIXTEEN.seed);
    log = await runMatch(SIXTEEN, {
      prompts: PROMPTS,
      providers: (slot, slotIndex) => {
        const bot = bots(slot, slotIndex);
        return {
          decide(ctx) {
            decisions.push({ tick: ctx.tick, agent: ctx.agent, observation: structuredClone(ctx.observation) });
            return bot.decide(ctx);
          },
        };
      },
    });
    rows = new Map(eventsOfKind(log, "Tick").map((e) => [e.tick, new Map(e.agents.map(([id, x, y]): [AgentId, Vec2] => [id, { x, y }]))]));
    const deaths = new Map(eventsOfKind(log, "Death").map((e) => [e.agent, e.tick]));
    placed = (tick, id) => {
      const pos = rows.get(tick)?.get(id);
      if (pos) return { pos, approx: false };
      const death = deaths.get(id);
      const last = death === undefined ? undefined : rows.get(death - 1)?.get(id);
      return last && { pos: last, approx: true };
    };
  }, 30_000);

  /** The ticks whose steps a decision at `tick` perceives: the steps since the previous decision, t − 10 … t − 1. */
  const windowOf = (tick: number) => ({ from: Math.max(1, tick - DOER_INTERVAL_TICKS), to: tick - 1 });
  const heardShots = (o: Observation) => o.heard.filter((h) => h.kind === "shot");

  it("some decisions hear shots and some feel incoming fire", () => {
    expect(decisions.length).toBeGreaterThan(500); // the match ends by elimination near tick 1,170
    expect(decisions.filter((d) => heardShots(d.observation).length > 0).length).toBeGreaterThan(0);
    expect(decisions.filter((d) => d.observation.incoming.length > 0).length).toBeGreaterThan(0);
  });

  it("the deciding agents hear about as many shots as there were (shot, other living agent in range) pairs (×0.5 to ×1.5)", () => {
    // Counted from the log at each shot's tick; a listener hears the shot at its next decision,
    // a few ticks later, unless it died first or the match ended.
    let pairs = 0;
    for (const shot of eventsOfKind(log, "Shot")) {
      const from = placed(shot.tick, shot.agent)!.pos;
      for (const [id, pos] of rows.get(shot.tick)!) if (id !== shot.agent && dist(pos, from) <= HEAR_SHOT_RANGE_M) pairs++;
    }
    const heard = decisions.reduce((n, d) => n + heardShots(d.observation).length, 0);
    expect(pairs).toBeGreaterThan(500);
    expect(heard).toBeGreaterThanOrEqual(0.5 * pairs);
    expect(heard).toBeLessThanOrEqual(1.5 * pairs);
  });

  it("each decision hears every other agent's shot since its previous decision, once, from where the shooter stood", () => {
    // What the log says the decision at t should hear: Shot events of ticks t − 10 … t − 1 by
    // other agents within HEAR_SHOT_RANGE_M, as a band and a bearing from the shooter's row at
    // the shot's tick to the listener's own position and facing in the observation. Heard
    // entries and these shots must pair up one to one: a shot heard twice, or one from an older
    // window, has nothing to pair with. A shot matches to the degree (the rows round positions
    // and facings); a shooter that died in the step it fired has only its previous row (ISSUES
    // I-019), so its shot matches within 15°.
    const shots = eventsOfKind(log, "Shot");
    const wrong: string[] = [];
    let matched = 0;
    for (const { tick, agent, observation } of decisions) {
      const { from, to } = windowOf(tick);
      const me = observation.self;
      const expected = shots
        .filter((s) => s.tick >= from && s.tick <= to && s.agent !== agent)
        .map((s) => {
          const at = placed(s.tick, s.agent)!;
          const d = dist(me.pos, at.pos);
          return { bullet: s.bullet, d, band: band(d), bearing: normalizeDeg(Math.round(bearingTo(me.pos, me.facing, at.pos))), approx: at.approx };
        })
        .filter((e) => e.d <= HEAR_SHOT_RANGE_M || borderline(e.d, e.approx));
      const heard = heardShots(observation);
      const taken = maxMatching(
        expected,
        heard,
        (e, h) => (e.band === h.dist || borderline(e.d, e.approx)) && Math.abs(normalizeDeg(e.bearing - h.bearing)) <= (e.approx ? 15 : 1),
      );
      expected.forEach((e, i) => {
        if (taken[i]! < 0 && !borderline(e.d, e.approx)) wrong.push(`${agent} at ${tick} did not hear ${e.bullet} (${e.band} at ${e.bearing})`);
      });
      heard.forEach((h, j) => {
        if (taken.includes(j)) matched++;
        else wrong.push(`${agent} at ${tick} heard ${JSON.stringify(h)} but no shot of ticks ${from}..${to} fits`);
      });
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(500);
  });

  it("each decision feels every hit and near miss on the agent since its previous decision: hits, then near misses, oldest first", () => {
    // From the log: Hit events on the agent (from where the bullet's owner stood at the hit's
    // tick) and the Tick rows' `near` entries naming it (ISSUES I-016), ticks t − 10 … t − 1.
    const hits = eventsOfKind(log, "Hit");
    const owner = new Map(eventsOfKind(log, "Shot").map((s) => [s.bullet, s.agent]));
    const near = eventsOfKind(log, "Tick").flatMap((t) => (t.near ?? []).map(([target, x, y]) => ({ tick: t.tick, target, from: { x, y } })));
    const wrong: string[] = [];
    let felt = 0;
    for (const { tick, agent, observation } of decisions) {
      const { from, to } = windowOf(tick);
      const inWindow = (t: number) => t >= from && t <= to;
      const me = observation.self;
      const sources = [
        ...hits.filter((h) => inWindow(h.tick) && h.target === agent).map((h) => placed(h.tick, owner.get(h.bullet)!)!),
        ...near.filter((n) => inWindow(n.tick) && n.target === agent).map((n) => ({ pos: n.from, approx: false })),
      ];
      const want = sources.map((s) => normalizeDeg(Math.round(bearingTo(me.pos, me.facing, s.pos))));
      const got = observation.incoming.map((i) => i.bearing);
      const same = got.length === want.length && got.every((b, i) => Math.abs(normalizeDeg(b - want[i]!)) <= (sources[i]!.approx ? 15 : 1));
      if (!same) wrong.push(`${agent} at ${tick}: incoming ${JSON.stringify(got)}, the log says ${JSON.stringify(want)}`);
      felt += got.length;
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(felt).toBeGreaterThan(100);
  });
});
