import {
  DOER_INTERVAL_TICKS,
  MatchLogSchema,
  normalizeDeg,
  perceive,
  type Event as LogEvent,
  type MatchLog,
  type Observation,
  type TickFacts,
  type Vec2,
} from "@kbattle/core";
import { beforeAll, describe, expect, it } from "vitest";
import sampleJson from "../../../core/fixtures/sample-log.json" with { type: "json" };
import { indexLog, type LogIndex, type TickEvent } from "../../src/replay/log-index";
import { createStateAt, stateFromTick } from "../../src/replay/state-from-tick";
import { realMatch, type RealMatch } from "./real-match";

const sample = MatchLogSchema.parse(sampleJson);
const index = indexLog(sample);
const NO_FACTS: TickFacts = { shots: [], hits: [], nearMisses: [] };

describe("stateFromTick on the sample log", () => {
  it("tick 0: both agents at spawn, full HP, nothing happened yet", () => {
    const state = stateFromTick(index, sample, 0);
    expect(state.tick).toBe(0);
    expect(state.durationTicks).toBe(200); // from log.config
    expect(state.map.id).toBe("arena-1");
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 4, y: 50 }, facing: 0, hp: 100, alive: true, kills: 0, moved: false },
      { id: "a1", pos: { x: 96, y: 50 }, facing: 180, hp: 100, alive: true, kills: 0, moved: false },
    ]);
    expect(state.recent).toEqual([]); // no step yet: an empty perception window (R15)
    // 92 m apart: beyond the 60 m vision range.
    expect(perceive(state, "a0")).toEqual({
      self: { pos: { x: 4, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 10 },
      visible: [],
      heard: [],
      incoming: [],
    });
  });

  it("tick 141: the window holds ticks 132..141; this tick's shots stand where the shooters' Tick row puts them; moved compares with tick 140", () => {
    const state = stateFromTick(index, sample, 141);
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, alive: true, kills: 0, moved: false },
      { id: "a1", pos: { x: 60.76, y: 49.73 }, facing: -176.3, hp: 20, alive: true, kills: 0, moved: true },
    ]);
    expect(state.recent).toEqual([
      { ...NO_FACTS, hits: [{ target: "a1", from: { x: 26.57, y: 47.5 } }] }, // tick 132: b9 (a0's) hits a1
      ...Array.from({ length: 8 }, () => NO_FACTS),
      {
        shots: [
          { agent: "a0", pos: { x: 26.57, y: 47.5 } },
          { agent: "a1", pos: { x: 60.76, y: 49.73 } },
        ],
        hits: [],
        nearMisses: [],
      },
    ]);
    const seen = perceive(state, "a0");
    expect(seen.visible).toEqual([{ id: "a1", bearing: 0, dist: 34, moving: true }]);
    expect(seen.heard).toEqual([{ kind: "shot", bearing: 0, dist: "mid" }]); // its own shot is not heard
    expect(seen.self.secondsLeft).toBe(3); // (200 − 141) × 50 ms = 2.95 s, rounded half up to one decimal
  });

  it("tick 115: each step's shots and hits stand where the shooter stood at that tick (b6 was a1's, fired at 101)", () => {
    const state = stateFromTick(index, sample, 115);
    expect(state.recent).toHaveLength(DOER_INTERVAL_TICKS); // ticks 106..115
    expect(state.recent[5]).toEqual({ ...NO_FACTS, shots: [{ agent: "a0", pos: { x: 26.5, y: 50 } }, { agent: "a1", pos: { x: 68.25, y: 50 } }] }); // 111
    expect(state.recent[8]).toEqual({ ...NO_FACTS, hits: [{ target: "a1", from: { x: 26.5, y: 50 } }] }); // 114: b5, a0's
    expect(state.recent[9]).toEqual({ ...NO_FACTS, hits: [{ target: "a0", from: { x: 67.25, y: 50 } }] }); // 115: b6, a1's
    expect(perceive(state, "a0")).toMatchObject({ heard: [{ kind: "shot", bearing: 0, dist: "mid" }], incoming: [{ bearing: 0 }] }); // a1's shot of 111
    expect(perceive(state, "a1").incoming).toEqual([{ bearing: 0 }]); // b5 at 114, from a0 dead ahead
  });

  it("tick 142, the Tick after the death: a1 dead where it was last seen, a0 credited with the kill", () => {
    const state = stateFromTick(index, sample, 142);
    expect(state.agents).toEqual([
      { id: "a0", pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, alive: true, kills: 1, moved: false },
      { id: "a1", pos: { x: 60.76, y: 49.73 }, facing: -176.3, hp: 0, alive: false, kills: 0, moved: false },
    ]);
    expect(state.recent.at(-1)).toEqual({ ...NO_FACTS, hits: [{ target: "a1", from: { x: 26.57, y: 47.5 } }] });
    const a0 = perceive(state, "a0");
    expect(a0.self).toEqual({ pos: { x: 26.57, y: 47.5 }, facing: 3.7, hp: 80, kills: 1, secondsLeft: 2.9 });
    // The dead are not seen, but a1's last shot (tick 141, from its row of 141) is still in the window.
    expect([a0.visible, a0.heard, a0.incoming]).toEqual([[], [{ kind: "shot", bearing: 0, dist: "mid" }], []]);
    expect(perceive(state, "a1")).toMatchObject({ self: { hp: 0, kills: 0 }, visible: [], heard: [], incoming: [] });
  });

  it("clamps the tick like a scrub: fractional ticks floor, out-of-range ticks pin to 0..lastTick", () => {
    expect(stateFromTick(index, sample, 141.6)).toEqual(stateFromTick(index, sample, 141));
    expect(stateFromTick(index, sample, 10_000).tick).toBe(142);
    expect(stateFromTick(index, sample, -3)).toEqual(stateFromTick(index, sample, 0));
  });
});

/** A three-slot log around hand-written events; Tick rows may carry v1.5's `near`. */
function miniLog(events: (LogEvent | TickEvent)[]): MatchLog {
  return {
    version: 1,
    config: { mapId: "arena-1", seed: 3, durationTicks: 50, slots: [{ kind: "prompted" }, { kind: "doer" }, { kind: "bot", bot: "camper" }] },
    seed: 3,
    prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
    events: events as LogEvent[],
  };
}

// a1 fires b0 at a0 (tick 1), a0 fires b1 back (tick 2), b0 grazes a2 on tick 2,
// b1 kills a1 (tick 3), and a1's bullet b0, still in flight, hits a0 on tick 4.
// Tick 5 has events but no Tick row.
const mini = miniLog([
  { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 10, y: 50 }, facing: 0 },
  { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 40, y: 50 }, facing: 180 },
  { kind: "Spawn", tick: 0, agent: "a2", pos: { x: 10, y: 60 }, facing: 0 },
  { kind: "Tick", tick: 0, agents: [["a0", 10, 50, 0, 100], ["a1", 40, 50, 180, 100], ["a2", 10, 60, 0, 100]], bullets: [] },
  { kind: "Shot", tick: 1, agent: "a1", bullet: "b0" },
  { kind: "Tick", tick: 1, agents: [["a0", 10.25, 50, 0, 100], ["a1", 40, 50, 180, 20], ["a2", 10, 60, 0, 100]], bullets: [["b0", 36.4, 50]] },
  { kind: "Shot", tick: 2, agent: "a0", bullet: "b1" },
  {
    kind: "Tick",
    tick: 2,
    agents: [["a0", 10.25, 50, 0, 100], ["a1", 39.75, 50, 180, 20], ["a2", 10, 60, 0, 100]],
    bullets: [["b0", 33.4, 50], ["b1", 13.85, 50]],
    near: [["a2", 39.75, 50]],
  },
  { kind: "Hit", tick: 3, bullet: "b1", target: "a1", damage: 20 },
  { kind: "Death", tick: 3, agent: "a1", killer: "a0" },
  { kind: "Tick", tick: 3, agents: [["a0", 10.5, 50, 0, 100], ["a2", 10, 60, 0, 100]], bullets: [["b0", 30.4, 50]] },
  { kind: "Hit", tick: 4, bullet: "b0", target: "a0", damage: 20 },
  { kind: "Tick", tick: 4, agents: [["a0", 10.5, 50, 0, 80], ["a2", 10, 60, 0, 100]], bullets: [], near: [["a2", 10.5, 50]] },
  { kind: "Shot", tick: 5, agent: "a0", bullet: "b2" },
]);
const miniIndex = indexLog(mini);

describe("stateFromTick on a hand-built log", () => {
  it("rebuilds the window from ticks 1..t; near misses come from each Tick row's `near` field, none when it is absent", () => {
    const state = stateFromTick(miniIndex, mini, 2);
    expect(state.recent).toEqual([
      { shots: [{ agent: "a1", pos: { x: 40, y: 50 } }], hits: [], nearMisses: [] }, // tick 1
      { shots: [{ agent: "a0", pos: { x: 10.25, y: 50 } }], hits: [], nearMisses: [{ target: "a2", from: { x: 39.75, y: 50 } }] }, // tick 2
    ]);
    expect(perceive(state, "a2").incoming).toEqual([{ bearing: -19 }]); // 29.75 m right, 10 m up of a2, which faces +x
    expect(stateFromTick(miniIndex, mini, 1).recent).toEqual([{ shots: [{ agent: "a1", pos: { x: 40, y: 50 } }], hits: [], nearMisses: [] }]);
  });

  it("counts kills from Death events up to the tick, not after", () => {
    const kills = (t: number) => stateFromTick(miniIndex, mini, t).agents.map((a) => a.kills);
    expect(kills(2)).toEqual([0, 0, 0]);
    expect(kills(3)).toEqual([1, 0, 0]);
    expect(kills(5)).toEqual([1, 0, 0]);
  });

  it("the killing hit comes from the killer's position; the dead keep their last Tick position, HP 0", () => {
    const state = stateFromTick(miniIndex, mini, 3);
    expect(state.recent.at(-1)?.hits).toEqual([{ target: "a1", from: { x: 10.5, y: 50 } }]);
    expect(state.agents[1]).toEqual({ id: "a1", pos: { x: 39.75, y: 50 }, facing: 180, hp: 0, alive: false, kills: 0, moved: false });
  });

  it("a bullet whose owner died before it landed comes from the owner's last known position", () => {
    const state = stateFromTick(miniIndex, mini, 4);
    expect(state.recent.at(-1)).toEqual({ shots: [], hits: [{ target: "a0", from: { x: 39.75, y: 50 } }], nearMisses: [{ target: "a2", from: { x: 10.5, y: 50 } }] });
    expect(perceive(state, "a0").incoming).toEqual([{ bearing: 0 }]);
  });

  it("moved is true only when the position differs from the previous tick's row", () => {
    const moved = (t: number) => stateFromTick(miniIndex, mini, t).agents.map((a) => a.moved);
    expect(moved(0)).toEqual([false, false, false]); // no previous row
    expect(moved(1)).toEqual([true, false, false]);
    expect(moved(2)).toEqual([false, true, false]);
    expect(moved(3)).toEqual([true, false, false]); // a1 is dead: never moving
  });

  it("a tick without a Tick row reuses the last positions but only its own events: no borrowed near misses", () => {
    const state = stateFromTick(miniIndex, mini, 5);
    expect(state.tick).toBe(5);
    expect(state.agents.map((a) => [a.id, a.pos, a.hp, a.alive, a.moved])).toEqual([
      ["a0", { x: 10.5, y: 50 }, 80, true, false],
      ["a1", { x: 39.75, y: 50 }, 0, false, false],
      ["a2", { x: 10, y: 60 }, 100, true, false],
    ]);
    expect(state.recent).toHaveLength(5);
    expect(state.recent.at(-1)).toEqual({ shots: [{ agent: "a0", pos: { x: 10.5, y: 50 } }], hits: [], nearMisses: [] });
    expect(perceive(state, "a0").self.secondsLeft).toBe(2.3); // (50 − 5) × 50 ms = 2.25 s
  });

  it("an agent missing from the Tick row without a Death event counts as dead, at its spawn", () => {
    const log = miniLog([
      { kind: "Spawn", tick: 0, agent: "a0", pos: { x: 10, y: 50 }, facing: 0 },
      { kind: "Spawn", tick: 0, agent: "a1", pos: { x: 40, y: 50 }, facing: 180 },
      { kind: "Tick", tick: 0, agents: [["a0", 10, 50, 0, 100]], bullets: [] },
    ]);
    expect(stateFromTick(indexLog(log), log, 0).agents[1]).toEqual({
      id: "a1",
      pos: { x: 40, y: 50 },
      facing: 180,
      hp: 0,
      alive: false,
      kills: 0,
      moved: false,
    });
  });
});

describe("createStateAt", () => {
  it("memoizes per tick: one state for repeated asks of a tick, a new one when the tick changes", () => {
    const stateAt = createStateAt(index, sample);
    const at100 = stateAt(100);
    expect(stateAt(100)).toBe(at100);
    expect(stateAt(100.4)).toBe(at100); // the same tick on screen
    const at101 = stateAt(101);
    expect(at101).not.toBe(at100);
    expect(at101).toEqual(stateFromTick(index, sample, 101));
    expect(stateAt(100)).toEqual(at100);
  });

  it("keeps the last two ticks it built: the tick on screen and the tick a doer call saw (R18) are each built once", () => {
    const stateAt = createStateAt(index, sample);
    const at115 = stateAt(115);
    const at110 = stateAt(110);
    expect([stateAt(115), stateAt(110), stateAt(115)]).toEqual([at115, at110, at115]);
    expect(stateAt(115)).toBe(at115);
    expect(stateAt(110)).toBe(at110);
    const at116 = stateAt(116); // a third tick forgets the one asked for least recently (115)
    expect(stateAt(110)).toBe(at110);
    expect(stateAt(116)).toBe(at116);
    expect(stateAt(115)).not.toBe(at115);
    expect(stateAt(115)).toEqual(at115);
  });
});

// A real match: the log the viewer opens, against the world the sim held at
// every tick. Tick rows round positions to 2 decimals and facings to 1 (R10),
// so the rebuilt world is the live one to that rounding. What the log cannot
// give back is where an agent stood during the step it died in: it moved
// before the bullet landed, and rows omit it from then on. The rebuilt agent
// stays where its last row put it, and so do the shots it fired in that step
// and the hits of its bullets from then on (one step of movement, ≤ 0.25 m).
describe("stateFromTick on a real 16-bot match (core's runMatch, as scripts/run-match.ts runs it)", () => {
  let real: RealMatch;
  let realIndex: LogIndex;
  beforeAll(async () => {
    real = await realMatch();
    realIndex = indexLog(real.log);
  });

  const ROW_M = 0.005 + 1e-9;
  const ROW_DEG = 0.05 + 1e-9;
  const rounded = (got: Vec2, want: Vec2) => Math.abs(got.x - want.x) <= ROW_M && Math.abs(got.y - want.y) <= ROW_M;
  const show = (v: unknown) => JSON.stringify(v);

  it("rebuilds every agent at every tick: the living to the rows' rounding, the dead with HP 0; kills and moved exactly", () => {
    const wrong: string[] = [];
    let alive = 0;
    let dead = 0;
    for (const [tick, world] of real.live) {
      const state = stateFromTick(realIndex, real.log, tick);
      if (show(state.agents.map((a) => a.id)) !== show(world.agents.map((a) => a.id))) wrong.push(`tick ${tick}: agents ${show(state.agents.map((a) => a.id))}`);
      for (const want of world.agents) {
        const got = state.agents.find((a) => a.id === want.id);
        if (!got || got.alive !== want.alive || got.hp !== want.hp || got.kills !== want.kills) {
          wrong.push(`tick ${tick} ${want.id}: ${show(got)} vs live ${show({ alive: want.alive, hp: want.hp, kills: want.kills })}`);
          continue;
        }
        if (!want.alive) {
          dead++;
          continue;
        }
        alive++;
        if (!rounded(got.pos, want.pos) || Math.abs(normalizeDeg(got.facing - want.facing)) > ROW_DEG || got.moved !== want.moved) {
          wrong.push(`tick ${tick} ${want.id}: ${show(got)} vs live ${show({ pos: want.pos, facing: want.facing, moved: want.moved })}`);
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(alive).toBeGreaterThan(0);
    expect(dead).toBeGreaterThan(0);
  });

  it("rebuilds the window of every tick, step by step: shots where the shooters stood, hits from where the owner stood, every near miss from the row's `near`", () => {
    // Where the log puts an agent at a tick: its row at that tick, live to the rounding;
    // without one (it died in this step or before) its last row, the one before its death.
    const placed = (tick: number, id: string, live: Vec2): Vec2 => {
      if (realIndex.byTick(tick).agents.some(([agent]) => agent === id)) return live;
      const death = realIndex.deaths.get(id);
      const row = death && realIndex.byTick(death.tick - 1).agents.find(([agent]) => agent === id);
      return row ? { x: row[1], y: row[2] } : { x: Number.NaN, y: Number.NaN };
    };
    const wrong: string[] = [];
    const seen = { steps: 0, shots: 0, hits: 0, nearMisses: 0, fromLastRow: 0 };
    for (const [now, world] of real.live) {
      // The window at `now` holds steps now − n + 1 … now, oldest first (R15), as live.
      const window = stateFromTick(realIndex, real.log, now).recent;
      if (window.length !== world.recent.length) wrong.push(`tick ${now}: a window of ${window.length} steps, live ${world.recent.length}`);
      world.recent.forEach((want, step) => {
        const tick = now - (world.recent.length - 1 - step);
        const got = window[step] ?? NO_FACTS;
        seen.steps++;
        seen.shots += want.shots.length;
        seen.nearMisses += want.nearMisses.length;
        const sameShots =
          got.shots.length === want.shots.length &&
          got.shots.every((s, i) => {
            const live = want.shots[i];
            if (live === undefined || s.agent !== live.agent) return false;
            const pos = placed(tick, live.agent, live.pos);
            if (pos !== live.pos) seen.fromLastRow++;
            return rounded(s.pos, pos);
          });
        if (!sameShots) wrong.push(`tick ${tick} (window of ${now}) shots: ${show(got.shots)} vs live ${show(want.shots)}`);
        const sameMisses =
          got.nearMisses.length === want.nearMisses.length &&
          got.nearMisses.every((m, i) => m.target === want.nearMisses[i]?.target && rounded(m.from, want.nearMisses[i].from));
        if (!sameMisses) wrong.push(`tick ${tick} (window of ${now}) near misses: ${show(got.nearMisses)} vs live ${show(want.nearMisses)}`);
        // Hits follow the tick's Hit events, in the order step() records them.
        const hits = realIndex.eventsAt(tick).filter((e) => e.kind === "Hit");
        if (got.hits.length !== want.hits.length || hits.length !== want.hits.length) {
          wrong.push(`tick ${tick} (window of ${now}) hits: ${show(got.hits)} vs live ${show(want.hits)}`);
          return;
        }
        want.hits.forEach((hit, i) => {
          seen.hits++;
          const event = hits[i];
          const owner = event?.kind === "Hit" ? realIndex.shots.get(event.bullet)?.agent : undefined;
          if (owner === undefined) return void wrong.push(`tick ${tick} hit ${i}: no Shot event for its bullet`);
          const from = placed(tick, owner, hit.from);
          if (from !== hit.from) seen.fromLastRow++;
          const rebuilt = got.hits[i];
          if (rebuilt?.target !== hit.target || !rounded(rebuilt.from, from)) wrong.push(`tick ${tick} hit ${i}: ${show(rebuilt)} vs ${show({ target: hit.target, from })}`);
        });
      });
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(seen.steps).toBeGreaterThan(5 * real.live.size); // full windows nearly all match long
    expect(seen.shots).toBeGreaterThan(0);
    expect(seen.hits).toBeGreaterThan(0);
    expect(seen.nearMisses).toBeGreaterThan(0);
    expect(seen.fromLastRow).toBeGreaterThan(0); // this match has shots and hits by agents gone from the rows
  });

  it("so each living agent perceives itself, the shots it hears and the fire coming at it as it did live (bearings to the degree)", () => {
    // Bearings may differ by a degree where the rows' rounding crosses a whole degree. A hit
    // whose owner is gone from the rows can be off by more at point-blank range (9° once, at
    // 1.6 m, over five matches; none here). Who it sees is not compared: rounding moves enemies
    // across the cone's edge (16 of 5,702 views on this match) or past a wall's corner. What it
    // hears is compared as a set (two sounds at nearly the same distance can swap places) and
    // may differ in a few views: a shooter that died in the step it fired stands at its previous
    // row (ISSUES I-019; a5 and a11 shoot each other at tick 91 here, 3.8 m from a9, up to 7°
    // off), and a shot at the edge of hearing range can round across it. Measured: 13 of 5,702
    // views on this match, at most 17 per match over five.
    const wrong: string[] = [];
    const sounds: string[] = [];
    let views = 0;
    let incoming = 0;
    let heard = 0;
    const near = (a: number, b: number | undefined) => b !== undefined && Math.abs(normalizeDeg(a - b)) <= 1;
    /** Whether each sound of `a` pairs with its own sound of `b`: same kind and band, bearing within a degree (closest first). */
    const sameSounds = (a: Observation["heard"], b: Observation["heard"]) => {
      const left = [...b];
      return (
        a.length === b.length &&
        a.every((h) => {
          const gap = (o: Observation["heard"][number]) => (o.kind === h.kind && o.dist === h.dist ? Math.abs(normalizeDeg(o.bearing - h.bearing)) : Infinity);
          const i = left.reduce((best, o, j) => (gap(o) < (best < 0 ? Infinity : gap(left[best]!)) ? j : best), -1);
          return i >= 0 && gap(left[i]!) <= 1 && left.splice(i, 1).length === 1;
        })
      );
    };
    for (const [tick, world] of real.live) {
      const state = stateFromTick(realIndex, real.log, tick);
      for (const agent of world.agents) {
        if (!agent.alive) continue;
        const live = perceive(world, agent.id);
        const replayed = perceive(state, agent.id);
        views++;
        incoming += live.incoming.length;
        heard += live.heard.length;
        const sameIncoming = replayed.incoming.length === live.incoming.length && replayed.incoming.every((x, i) => near(x.bearing, live.incoming[i]?.bearing));
        if (show(replayed.self) !== show(live.self) || !sameIncoming) {
          wrong.push(`tick ${tick} ${agent.id}: ${show([replayed.self, replayed.incoming])} vs live ${show([live.self, live.incoming])}`);
        }
        if (!sameSounds(replayed.heard, live.heard)) sounds.push(`tick ${tick} ${agent.id}: ${show(replayed.heard)} vs live ${show(live.heard)}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(incoming).toBeGreaterThan(0);
    expect(heard).toBeGreaterThan(5000);
    expect(sounds.length, sounds.slice(0, 3).join("\n")).toBeLessThanOrEqual(Math.ceil(0.005 * views));
  });
});
