// A headless bot match in Node (v1.4 demo), on the stand-in loop in
// test/bots/headless.ts until v1.5's match loop replaces it.
//
//   pnpm --filter core exec tsx scripts/run-bots.ts [mapId] [seed] [bot,bot,...]
//
// Defaults: arena-1, seed 1, wanderer vs camper, MATCH_DURATION_TICKS. Prints
// who decided when, the first Death, and who is alive at the end.

import { BotKindSchema, MatchConfigSchema, type MatchConfig } from "../src/schemas";
import { MATCH_DURATION_TICKS } from "../src/constants";
import type { DecisionContext, DecisionProvider } from "../src/sim/providers";
import { botsFor, runHeadless } from "../test/bots/headless";

const [mapId = "arena-1", seed = "1", kinds = "wanderer,camper"] = process.argv.slice(2);
const config: MatchConfig = MatchConfigSchema.parse({
  mapId,
  seed: Number(seed),
  durationTicks: MATCH_DURATION_TICKS,
  slots: kinds.split(",").map((bot) => ({ kind: "bot", bot: BotKindSchema.parse(bot) })),
});

const asked = new Map<string, number[]>();
const counting = (bot: DecisionProvider): DecisionProvider => ({
  decide(ctx: DecisionContext) {
    asked.set(ctx.agent, [...(asked.get(ctx.agent) ?? []), ctx.tick]);
    return bot.decide(ctx);
  },
});

const started = performance.now();
const { state, deaths, shots, hits } = await runHeadless(config, botsFor(config).map(counting));
const ms = performance.now() - started;

const who = (id: string) => {
  const slot = config.slots[Number(id.slice(1))];
  return slot?.kind === "bot" ? `${id} (${slot.bot})` : id;
};
const ticks = (list: number[]) =>
  list.length <= 4 ? list.join(", ") : `${list.slice(0, 3).join(", ")}, …, ${list.at(-1)}`;

const players = state.agents.map((a) => who(a.id)).join(" vs ");
console.log(`${config.mapId}, seed ${config.seed}, up to ${config.durationTicks} ticks: ${players}`);
for (const [agent, list] of asked) console.log(`  ${agent} decided ${list.length} times, on ticks ${ticks(list)}`);
const [first] = deaths;
console.log(first ? `first Death: tick ${first.tick}, ${who(first.agent)} killed by ${who(first.killer)}` : "first Death: none");
const alive = state.agents.filter((a) => a.alive).map((a) => a.id);
console.log(`end: tick ${state.tick}, alive [${alive.join(", ")}]; ${shots} shots, ${hits} hits`);
for (const a of state.agents) {
  const where = `at (${a.pos.x.toFixed(1)}, ${a.pos.y.toFixed(1)})${a.alive ? "" : `, died at tick ${a.deathTick}`}`;
  console.log(`  ${who(a.id).padEnd(14)} hp ${String(a.hp).padStart(3)}  kills ${a.kills}  ${where}`);
}
console.log(`took ${ms.toFixed(0)} ms`);
