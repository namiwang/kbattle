// A headless bot match in Node (v1.4 demo), on the match loop (runMatch, v1.5).
//
//   pnpm --filter core exec tsx scripts/run-bots.ts [mapId] [seed] [bot,bot,...]
//
// Defaults: map-1, seed 1, wanderer vs camper, MATCH_DURATION_TICKS. Prints
// who decided when, the first Death, who is alive at the end, and the MatchEnd.

import { botProviders } from "../src/bots";
import { MATCH_DURATION_TICKS } from "../src/constants";
import { eventsOfKind } from "../src/log";
import { BotKindSchema, MatchConfigSchema, type MatchConfig } from "../src/schemas";
import { runMatch } from "../src/sim/match";
import type { WorldState } from "../src/types";

const [mapId = "map-1", seed = "1", kinds = "wanderer,camper"] = process.argv.slice(2);
const config: MatchConfig = MatchConfigSchema.parse({
  mapId,
  seed: Number(seed),
  durationTicks: MATCH_DURATION_TICKS,
  slots: kinds.split(",").map((bot) => ({ kind: "bot", bot: BotKindSchema.parse(bot) })),
});

const asked = new Map<string, number[]>();
const bots = botProviders(config.seed);
let state: WorldState | undefined;

const started = performance.now();
const log = await runMatch(config, {
  prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
  providers: (slot, i) => {
    const bot = bots(slot, i);
    return {
      decide(ctx) {
        asked.set(ctx.agent, [...(asked.get(ctx.agent) ?? []), ctx.tick]);
        return bot.decide(ctx);
      },
    };
  },
  onTick: (_, world) => {
    state = world;
  },
});
const ms = performance.now() - started;
const final = state!;

const who = (id: string) => {
  const slot = config.slots[Number(id.slice(1))];
  return slot?.kind === "bot" ? `${id} (${slot.bot})` : id;
};
const ticks = (list: number[]) =>
  list.length <= 4 ? list.join(", ") : `${list.slice(0, 3).join(", ")}, …, ${list.at(-1)}`;

const players = final.agents.map((a) => who(a.id)).join(" vs ");
console.log(`${config.mapId}, seed ${config.seed}, up to ${config.durationTicks} ticks: ${players}`);
for (const [agent, list] of asked) console.log(`  ${agent} decided ${list.length} times, on ticks ${ticks(list)}`);
const [first] = eventsOfKind(log, "Death");
console.log(first ? `first Death: tick ${first.tick}, ${who(first.agent)} killed by ${who(first.killer)}` : "first Death: none");
const alive = final.agents.filter((a) => a.alive).map((a) => a.id);
const shots = eventsOfKind(log, "Shot").length;
const hits = eventsOfKind(log, "Hit").length;
console.log(`end: tick ${final.tick}, alive [${alive.join(", ")}]; ${shots} shots, ${hits} hits`);
for (const a of final.agents) {
  const where = `at (${a.pos.x.toFixed(1)}, ${a.pos.y.toFixed(1)})${a.alive ? "" : `, died at tick ${a.deathTick}`}`;
  console.log(`  ${who(a.id).padEnd(14)} hp ${String(a.hp).padStart(3)}  kills ${a.kills}  ${where}`);
}
const end = eventsOfKind(log, "MatchEnd")[0]!;
console.log(`MatchEnd { tick: ${end.tick}, ranking: [${end.ranking.join(", ")}] }`);
console.log(`took ${ms.toFixed(0)} ms`);
