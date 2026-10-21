// Scripted bots (DESIGN.md §6.2 Bots, rows 23 and 33; sim rulings R8, R13): the
// quality floor and the minds of headless tests. They decide on the doer cadence
// like every other slot and answer through the same DecisionProvider interface.

import type { BotKind } from "../schemas";
import type { DecisionProvider } from "../sim/providers";
import { makeCamper } from "./camper";
import { makeWanderer } from "./wanderer";

/**
 * A fresh bot for one slot. Deterministic given (seed, slot): it owns a private
 * RNG derived from both, and its answers depend only on that and the
 * observations it is given, in order. Make one per slot per match.
 */
export function makeBot(kind: BotKind, seed: number, slot: number): DecisionProvider {
  switch (kind) {
    case "wanderer":
      return makeWanderer(seed, slot);
    case "camper":
      return makeCamper(seed, slot);
  }
}
