// @decision-arena/models public surface: the thinker contract (DESIGN.md §5.4, §5.6), its
// Anthropic implementation, and the thinker client with its prompt text and
// observation digest (v3.2). The doer side arrives in v3.1.
export { FATAL_THINKER_ERRORS, thinkerError } from "./types";
export type {
  FatalThinkerErrorKind,
  ThinkerError,
  ThinkerErrorKind,
  ThinkerInput,
  ThinkerProvider,
  ThinkerResult,
} from "./types";
export { PLAN_REPLY_CHARS, PlanReplySchema, PlanSchema } from "./schemas";
export type { Plan } from "./schemas";
export { makeAnthropicThinker, thinkingParamFor } from "./providers/anthropic";
export type { AnthropicThinkerOptions } from "./providers/anthropic";
export { buildSystem, buildUserMessage, estimateTokens, formatObservation, HARNESS_PROMPT } from "./thinker-prompt";
export type { ThinkerTurn } from "./thinker-prompt";
export { createDigest, DIGEST_MAX_CHARS } from "./event-digest";
export type { Digest } from "./event-digest";
export { makeThinkerClient, THINKER_TIMEOUT_MS } from "./thinker-client";
export type {
  ThinkerCall,
  ThinkerCallInput,
  ThinkerClient,
  ThinkerClientOptions,
  ThinkerLogInput,
} from "./thinker-client";
