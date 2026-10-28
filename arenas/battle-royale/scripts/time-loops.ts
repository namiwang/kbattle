// The wall-time gate of R0.4 (ruling R25; PLAN R0.4 "wall time within 2× of
// today's"): the version-2 loop (core's runMatch over the battle royale arena,
// the bots as Models) against the kit's version-1 loop (its legacy runMatch with
// botProviders) on the parity match, 16 bots on map-1, seed 7, up to 6,000 ticks.
// One warm-up run of each, then `runs` timed runs of each (5 by default),
// interleaved, in one process. Prints every run, both medians and their ratio,
// and exits 1 when the version-2 median is more than twice the version-1 median.
// A one-off: it goes with the kit's legacy loop in R0.5.
//
//   pnpm --filter @decision-arena/arena-battle-royale exec tsx scripts/time-loops.ts [runs]

import { botSpec, runMatch } from "@decision-arena/core";
import { MatchConfigSchema, type Prompts, type Slot } from "@decision-arena/core/legacy";
import { botProviders, runMatch as runVersion1 } from "@decision-arena/kit-shooter";
import { battleRoyale, DEFAULT_DURATION_TICKS } from "../src";

const runs = Number(process.argv[2] ?? 5);
const kinds = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? "wanderer" : "camper") as "wanderer" | "camper");

const v1Config = MatchConfigSchema.parse({
  mapId: "map-1",
  seed: 7,
  durationTicks: DEFAULT_DURATION_TICKS,
  slots: kinds.map((bot): Slot => ({ kind: "bot", bot })),
});
const prompts: Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };
const v2Config = battleRoyale.config.parse({ mapId: "map-1", seed: 7, durationTicks: DEFAULT_DURATION_TICKS });
const agents = kinds.map((name) => botSpec(battleRoyale.id, name));

const loops = {
  v1: () => runVersion1(v1Config, { providers: botProviders(v1Config.seed), prompts }),
  v2: () => runMatch(battleRoyale, v2Config, agents),
};

async function timed(run: () => Promise<{ events: readonly unknown[] }>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

const median = (xs: readonly number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

await timed(loops.v1); // warm-up
await timed(loops.v2);
const times = { v1: [] as number[], v2: [] as number[] };
for (let i = 0; i < runs; i++) {
  times.v1.push(await timed(loops.v1));
  times.v2.push(await timed(loops.v2));
}
const v1 = median(times.v1);
const v2 = median(times.v2);
const ms = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(", ");
console.log(`version-1 loop (kit legacy runMatch): ${ms(times.v1)} ms; median ${v1.toFixed(1)} ms`);
console.log(`version-2 loop (core runMatch, battle royale): ${ms(times.v2)} ms; median ${v2.toFixed(1)} ms`);
console.log(`ratio v2 / v1: ${(v2 / v1).toFixed(2)} (gate: at most 2)`);
if (v2 > 2 * v1) process.exit(1);
