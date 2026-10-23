// The battle royale's match config (DESIGN.md §13 "What this arena owns",
// rulings R21.c, R24): the platform's seed and length plus the map. The agents
// are the platform's (the slots of version 1 are gone from the config), and the
// mode is the envelope's.

import { BaseConfigSchema } from "@decision-arena/core";
import { MAP_IDS, secondsToTicks } from "@decision-arena/kit-shooter";
import * as z from "zod";

/** §13 ASSUMED: a match lasts at most 6,000 ticks, 5 min of sim time, unless the last agent alive ends it first. */
export const DEFAULT_DURATION_TICKS = secondsToTicks(300);

/** The config schema of an arena over these maps: BaseConfigSchema plus `mapId`, one of `mapIds`. */
export function configSchema(mapIds: readonly string[]) {
  const [first, ...rest] = mapIds;
  if (first === undefined) throw new Error("an arena needs at least one map");
  return BaseConfigSchema.extend({ mapId: z.enum([first, ...rest]) });
}

export const BattleRoyaleConfigSchema = configSchema(MAP_IDS);
export type BattleRoyaleConfig = z.infer<typeof BattleRoyaleConfigSchema>;
