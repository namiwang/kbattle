// The thinker's output schema lives in core's legacy entry with the other version-1
// boundary schemas (DESIGN.md §5.3).
import { PlanSchema } from "@decision-arena/core/legacy";

export { PlanSchema };
export type { Plan } from "@decision-arena/core/legacy";

/**
 * The lengths the harness prompt asks the thinker for, in characters: well under
 * PlanSchema's 2,000 and 4,000, so a reply fits the provider's max_tokens (ISSUES
 * I-013) and the next call's input stays in budget (§5.4).
 */
export const PLAN_REPLY_CHARS = Object.freeze({ text: 600, scratchpad: 1200 });

/**
 * PlanSchema with the asked-for lengths: what the provider sends as its structured
 * output schema, where the lengths travel as hints. Replies are still parsed with
 * PlanSchema, so a reply that runs a little long is kept.
 */
export const PlanReplySchema = PlanSchema.extend({
  text: PlanSchema.shape.text.max(PLAN_REPLY_CHARS.text),
  scratchpad: PlanSchema.shape.scratchpad.max(PLAN_REPLY_CHARS.scratchpad),
});
