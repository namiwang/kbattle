// Scripted bots (DESIGN.md §6.2 Bots, rows 23 and 33; sim rulings R8, R13): the
// quality floor and the minds of headless tests. They decide on the doer cadence
// like every other slot and answer through the same DecisionProvider interface,
// at once, from the observation alone: they ignore the plan and the call's
// signal (R17).

import type { BotKind } from "@decision-arena/core/legacy";
import type { DecisionProvider, ProviderFactory } from "../legacy/providers";
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

/**
 * runMatch's provider factory for a match whose slots are all bots: a fresh
 * makeBot(slot.bot, seed, slotIndex) per slot. Throws on a slot that is not a bot.
 */
export function botProviders(seed: number): ProviderFactory {
  return (slot, slotIndex) => {
    if (slot.kind !== "bot") throw new Error(`slot ${slotIndex} is "${slot.kind}", not a bot`);
    return makeBot(slot.bot, seed, slotIndex);
  };
}
