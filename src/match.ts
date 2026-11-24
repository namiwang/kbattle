// pnpm match [log.json] [map] [seed]: plays a battle royale of 16 bots, wanderer and camper alternating,
// prints how it ended, and writes the log when a path is given.

import { writeFileSync } from "node:fs";
import { battleRoyale } from "./arenas/battle-royale/arena.ts";
import { runMatch } from "./core/run.ts";

const [path, map = "map-1", seedText = "7"] = process.argv.slice(2);
const seed = Number(seedText);
if (!Number.isInteger(seed) || seed < 0) throw new Error(`a seed is a whole number, not "${seedText}"`);

const agents = Array.from({ length: 16 }, (_, i) => ({ actor: i % 2 === 0 ? "bot/wanderer" : "bot/camper" }));
const log = await runMatch(battleRoyale, { seed, map }, agents);
const end = log.events.at(-1);
if (end?.kind !== "End") throw new Error("the log has no End");
const json = JSON.stringify(log);
if (path) writeFileSync(path, json);

console.log(`${map}, seed ${seed}: ended at tick ${end.tick}`);
console.log(`ranking: ${end.ranking.join(" ")}${end.error === undefined ? "" : ` (${end.error})`}`);
console.log(`log: ${log.events.length} events, ${Buffer.byteLength(json)} bytes${path ? `, written to ${path}` : ""}`);
