// Benchmark (v1.3 budget: perceive for 16 agents in one tick under 1 ms).
// Not a test: timings depend on the machine. Prints the mean and the 99th
// percentile of one tick's worth of perception (every agent once).
//
//   pnpm --filter core exec tsx scripts/bench-perceive.ts
//
// Worlds: 16 agents on arena-1 (4 obstacles) and on arena-1 plus four more
// boxes (8 obstacles); "played" = spawned then 300 ticks of seeded random
// actions (bullets, and shots, hits and near misses in the perception window),
// "dense" = all 16 alive in a 50 m ring facing its center, so nearly every
// pair needs a line-of-sight test, all walking, and every agent's shot plus
// hits and near misses spread over the window's DOER_INTERVAL_TICKS steps (R15).

import { headingTo } from "../src/angles";
import { DOER_INTERVAL_TICKS } from "../src/constants";
import { getMap } from "../src/maps";
import type { MapSpec, Slot } from "../src/schemas";
import { perceive } from "../src/sim/perceive";
import { createRng, nextFloat, type RngState } from "../src/sim/rng";
import { step } from "../src/sim/step";
import { spawn } from "../src/sim/world";
import { MOVE_CHOICES, TURN_CHOICES, type Action, type TickFacts, type WorldState } from "../src/types";

const arena1 = getMap("arena-1");
const box = (x: number, y: number) => ({
  vertices: [{ x, y }, { x: x + 4, y }, { x: x + 4, y: y + 4 }, { x, y: y + 4 }],
});
const eight: MapSpec = { ...arena1, id: "arena-1+4", obstacles: [...arena1.obstacles, box(30, 12), box(66, 84), box(84, 36), box(12, 60)] };

const slots: Slot[] = Array.from({ length: 16 }, () => ({ kind: "bot", bot: "wanderer" }));

function played(map: MapSpec): WorldState {
  let state = spawn({ mapId: map.id, seed: 7, durationTicks: 6000, slots }, map);
  let rng: RngState = createRng(99);
  const float = () => {
    const d = nextFloat(rng);
    rng = d.rng;
    return d.value;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(float() * items.length)]!;
  for (let t = 1; t <= 300; t++) {
    const actions: Record<string, Action> = {};
    if (t % 10 === 1) {
      for (const a of state.agents) {
        actions[a.id] = { move: pick(MOVE_CHOICES), turn: pick(TURN_CHOICES), fire: float() < 0.7, target: pick(state.agents).id };
      }
    }
    state = step(state, actions).state;
  }
  return state;
}

function dense(map: MapSpec): WorldState {
  const base = spawn({ mapId: map.id, seed: 7, durationTicks: 6000, slots }, map);
  const center = { x: 50, y: 50 };
  const agents = base.agents.map((a, i) => {
    const angle = (2 * Math.PI * i) / 16;
    const pos = { x: 50 + 25 * Math.cos(angle) + 0.3 * i, y: 50 + 25 * Math.sin(angle) };
    return { ...a, pos, facing: headingTo(pos, center), moved: true };
  });
  const recent: TickFacts[] = Array.from({ length: DOER_INTERVAL_TICKS }, (_, step) => ({
    shots: agents.filter((_, i) => i % DOER_INTERVAL_TICKS === step).map((a) => ({ agent: a.id, pos: a.pos })),
    hits: agents.slice(0, 4).map((a, i) => ({ target: a.id, from: agents[i + 8]!.pos })),
    nearMisses: agents.slice(4, 8).map((a, i) => ({ target: a.id, from: agents[i + 10]!.pos })),
  }));
  return { ...base, agents, recent };
}

function bench(label: string, state: WorldState): void {
  const ids = state.agents.map((a) => a.id);
  const tick = () => {
    let n = 0;
    for (const id of ids) n += perceive(state, id).visible.length;
    return n;
  };
  for (let i = 0; i < 2000; i++) tick(); // warm up the JIT
  const runs = 20000;
  const samples = new Float64Array(runs);
  let seen = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    seen = tick();
    samples[i] = performance.now() - t0;
  }
  samples.sort();
  const mean = samples.reduce((s, v) => s + v, 0) / runs;
  const p99 = samples[Math.floor(runs * 0.99)]!;
  const views = ids.length;
  console.log(
    `${label.padEnd(30)} ${views} views/tick, ${String(seen).padStart(3)} sightings: ` +
      `mean ${(mean * 1000).toFixed(1)} µs, p99 ${(p99 * 1000).toFixed(1)} µs per tick (budget 1000 µs)`,
  );
}

console.log(`node ${process.version}, ${process.arch}`);
bench("arena-1 (4 obstacles), played", played(arena1));
bench("arena-1 (4 obstacles), dense", dense(arena1));
bench("arena-1+4 (8 obstacles), played", played(eight));
bench("arena-1+4 (8 obstacles), dense", dense(eight));
