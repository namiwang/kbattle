// A 16-bot match in Node, written as a version-2 log (the v1.5 demo on the
// platform's loop, R0.4): 8 wanderers and 8 campers alternating, the whole
// MatchLog as compact JSON (what the viewer's Download will save from R0.5).
//
//   pnpm --filter @decision-arena/arena-battle-royale exec tsx scripts/run-match.ts [out.json | -] [mapId] [seed]
//
// Defaults: stdout, map-1, seed 7, DEFAULT_DURATION_TICKS (6,000). The same CLI
// as the kit's version-1 scripts/run-match.ts. The log is checked with
// parseMatchLogFor(battleRoyale, …) before it is written. The summary (how it
// ended, event counts, size, wall time) goes to stdout when the log goes to a
// file, and to stderr when the log goes to stdout, so `> match.json` captures
// the log alone.

import { botSpec, eventsOfKind, parseMatchLogFor, runMatch, tickMsOf } from "@decision-arena/core";
import { writeFileSync } from "node:fs";
import { battleRoyale, DEFAULT_DURATION_TICKS } from "../src";

const [out = "-", mapId = "map-1", seed = "7"] = process.argv.slice(2);
const say = (line: string) => (out === "-" ? process.stderr : process.stdout).write(`${line}\n`);

const config = battleRoyale.config.parse({ mapId, seed: Number(seed), durationTicks: DEFAULT_DURATION_TICKS });
const bots = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? "wanderer" : "camper"));
const agents = bots.map((name) => botSpec(battleRoyale.id, name));

const started = performance.now();
const log = await runMatch(battleRoyale, config, agents);
const matchMs = performance.now() - started;

const text = JSON.stringify(log);
const checked = performance.now();
parseMatchLogFor(battleRoyale, JSON.parse(text));
const checkMs = performance.now() - checked;
if (out === "-") process.stdout.write(text);
else writeFileSync(out, text);

const end = eventsOfKind(log, "MatchEnd")[0]!;
const survivors = eventsOfKind(log, "Tick").at(-1)!.data.agents.map(([id]) => id);
const kinds: Record<string, number> = {};
for (const e of log.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const nearRows = eventsOfKind(log, "Tick").reduce((n, t) => n + (t.data.near?.length ?? 0), 0);
const bytes = Buffer.byteLength(text);
const bySlot = (id: string) => `${id} (${bots[Number(id.slice(1))]})`;

say(`${config.mapId}, seed ${config.seed}, 16 bots (8 wanderers, 8 campers), up to ${config.durationTicks} ticks`);
say(`end: tick ${end.tick}, alive [${survivors.join(", ")}]; ranking ${end.ranking.slice(0, 3).map(bySlot).join(", ")}, …`);
say(`events: ${log.events.length} ${JSON.stringify(kinds)}; near-miss rows ${nearRows}`);
say(`size: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MB) compact JSON, a valid version-2 log${out === "-" ? "" : `, written to ${out}`}`);
say(`wall: match ${matchMs.toFixed(0)} ms for ${end.tick} ticks (${((end.tick * tickMsOf(battleRoyale)) / 1000).toFixed(0)} s of sim time); check ${checkMs.toFixed(0)} ms`);
