// A 16-bot match in Node (v1.5 demo): 8 wanderers and 8 campers, the whole
// MatchLog written as compact JSON (what the viewer's Download saves).
//
//   pnpm --filter core exec tsx scripts/run-match.ts [out.json | -] [mapId] [seed]
//
// Defaults: stdout, map-1, seed 7, MATCH_DURATION_TICKS. The log is checked
// against MatchLogSchema before it is written. The summary (how it ended, event
// counts, size, wall time) goes to stdout when the log goes to a file, and to
// stderr when the log goes to stdout, so `> match.json` captures the log alone.

import { writeFileSync } from "node:fs";
import { botProviders } from "../src/bots";
import { MATCH_DURATION_TICKS } from "../src/constants";
import { eventsOfKind } from "../src/log";
import { MatchConfigSchema, MatchLogSchema, type Prompts, type Slot } from "../src/schemas";
import { runMatch } from "../src/sim/match";

const [out = "-", mapId = "map-1", seed = "7"] = process.argv.slice(2);
const say = (line: string) => (out === "-" ? process.stderr : process.stdout).write(`${line}\n`);

const config = MatchConfigSchema.parse({
  mapId,
  seed: Number(seed),
  durationTicks: MATCH_DURATION_TICKS,
  slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
});
const prompts: Prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };

const started = performance.now();
const log = await runMatch(config, { providers: botProviders(config.seed), prompts });
const matchMs = performance.now() - started;

const text = JSON.stringify(log);
const checked = performance.now();
MatchLogSchema.parse(JSON.parse(text));
const checkMs = performance.now() - checked;
if (out === "-") process.stdout.write(text);
else writeFileSync(out, text);

const end = eventsOfKind(log, "MatchEnd")[0]!;
const survivors = eventsOfKind(log, "Tick").at(-1)!.agents.map(([id]) => id);
const kinds: Record<string, number> = {};
for (const e of log.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const nearRows = eventsOfKind(log, "Tick").reduce((n, t) => n + (t.near?.length ?? 0), 0);
const bytes = Buffer.byteLength(text);
const bySlot = (id: string) => {
  const slot = config.slots[Number(id.slice(1))];
  return slot?.kind === "bot" ? `${id} (${slot.bot})` : id;
};

say(`${config.mapId}, seed ${config.seed}, 16 bots (8 wanderers, 8 campers), up to ${config.durationTicks} ticks`);
say(`end: tick ${end.tick}, alive [${survivors.join(", ")}]; ranking ${end.ranking.slice(0, 3).map(bySlot).join(", ")}, …`);
say(`events: ${log.events.length} ${JSON.stringify(kinds)}; near-miss rows ${nearRows}`);
say(`size: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MB) compact JSON, valid MatchLog${out === "-" ? "" : `, written to ${out}`}`);
say(`wall: match ${matchMs.toFixed(0)} ms for ${end.tick} ticks (${((end.tick * 50) / 1000).toFixed(0)} s of sim time); schema check ${checkMs.toFixed(0)} ms`);
