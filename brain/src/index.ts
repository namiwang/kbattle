// @kbattle/brain public surface: the thinker contract (DESIGN.md §5.4, §5.6) and
// its Anthropic implementation. The doer side arrives in v3.1.
export type { ThinkerError, ThinkerInput, ThinkerProvider, ThinkerResult } from "./types";
export { PlanSchema } from "./schemas";
export type { Plan } from "./schemas";
export { makeAnthropicThinker } from "./providers/anthropic";
export type { AnthropicThinkerOptions } from "./providers/anthropic";
