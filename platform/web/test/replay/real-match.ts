// A real match for the replay tests: the 16-bot match core's
// scripts/run-match.ts writes by default (arena-1, seed 7, wanderers and
// campers alternating, MATCH_DURATION_TICKS), run in-process (about 40 ms, no
// network), with the live world of every tick kept from runMatch's onTick. The
// log is what the viewer opens; the live worlds are what the agents perceived.

import { botProviders, MATCH_DURATION_TICKS, MatchConfigSchema, runMatch, type MatchLog, type Slot, type WorldState } from "@decision-arena/core";

export interface RealMatch {
  readonly log: MatchLog;
  /** The world at the end of every tick 0..last, as the sim held it (unrounded). */
  readonly live: ReadonlyMap<number, WorldState>;
}

export async function realMatch(seed = 7, mapId = "arena-1"): Promise<RealMatch> {
  const config = MatchConfigSchema.parse({
    mapId,
    seed,
    durationTicks: MATCH_DURATION_TICKS,
    slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
  });
  const live = new Map<number, WorldState>();
  const log = await runMatch(config, {
    providers: botProviders(seed),
    prompts: { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } },
    onTick: (tick, state) => live.set(tick, state),
  });
  return { log, live };
}
