// Read-outs next to the match form: the bots that fill the remaining slots, and
// the duration in sim seconds. Plain functions of the form, so Node tests them.

import { TICK_MS } from "@decision-arena/core";
import type { MatchForm } from "./state";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The bots in the slots that are neither prompted nor doer-only: "4 wanderers, 3 campers"
 * (slotsFor alternates them, wanderer first), "none", or "—" when the counts do not add up.
 * Arithmetic only: the input is whatever the user typed, however large.
 */
export function botsLabel({ slots, prompted, doerOnly }: Pick<MatchForm, "slots" | "prompted" | "doerOnly">): string {
  const counts = [slots, prompted, doerOnly];
  const bots = slots - prompted - doerOnly;
  if (!counts.every((n) => Number.isInteger(n) && n >= 0) || bots < 0) return "—";
  const wanderers = Math.ceil(bots / 2);
  const campers = bots - wanderers;
  const parts = [wanderers > 0 ? plural(wanderers, "wanderer") : "", campers > 0 ? plural(campers, "camper") : ""];
  return parts.filter((part) => part !== "").join(", ") || "none";
}

/** A duration in ticks as sim seconds, "300 s"; empty when there is no number to convert. */
export function secondsLabel(ticks: number): string {
  if (!Number.isFinite(ticks)) return "";
  return `${Number(((ticks * TICK_MS) / 1000).toFixed(2))} s`;
}
