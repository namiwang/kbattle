// Scripted bots (DESIGN.md §13 Bots, rows 23 and 33; sim rulings R8, R13): the
// quality floor and the minds of headless tests. A bot decides once per decision
// interval, from its observation alone: it ignores the plan and the call's signal
// (R17). One mind per bot (makeBotMind) and two ways to ask it, until R0.5 retires
// the first: makeBot, a version-1 DecisionProvider for the kit's legacy loop, and
// the battle royale arena's bot Models (arenas/battle-royale/src/bots.ts).

import type { Slot } from "@decision-arena/core/legacy";
import type { DecisionProvider, ProviderFactory } from "../legacy/providers";
import { camperMind } from "./camper";
import { botAnswer, type BotKind, type BotMind } from "./shared";
import { wandererMind } from "./wanderer";

export { BOT_KINDS, type BotIntent, type BotKind, type BotMind } from "./shared";

/**
 * A fresh mind for one agent. Deterministic given (seed, slot): it owns a private
 * RNG derived from both, and its intents depend only on that and the (tick,
 * observation) pairs it is given, in order. Make one per agent per match.
 */
export function makeBotMind(kind: BotKind, seed: number, slot: number): BotMind {
  switch (kind) {
    case "wanderer":
      return wandererMind(seed, slot);
    case "camper":
      return camperMind(seed, slot);
  }
}

/** A fresh bot for one slot as a version-1 DecisionProvider: its mind's intent at ctx.tick, as a DoerAnswer. */
export function makeBot(kind: BotKind, seed: number, slot: number): DecisionProvider {
  const mind = makeBotMind(kind, seed, slot);
  return {
    decide: (ctx) => Promise.resolve(botAnswer(kind, mind.decide(ctx.tick, ctx.observation))),
  };
}

/**
 * runMatch's provider factory for a match whose slots are all bots: a fresh
 * makeBot(slot.bot, seed, slotIndex) per slot. Throws on a slot that is not a bot.
 */
export function botProviders(seed: number): ProviderFactory {
  return (slot: Slot, slotIndex) => {
    if (slot.kind !== "bot") throw new Error(`slot ${slotIndex} is "${slot.kind}", not a bot`);
    return makeBot(slot.bot, seed, slotIndex);
  };
}
