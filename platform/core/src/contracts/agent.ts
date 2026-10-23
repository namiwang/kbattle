// Agents (DESIGN.md §5.4, rows 39 and 41; ruling R21.d): what a player authors
// for one arena — the model in each role and the player's words — and what the
// planner keeps between calls. Validated where a spec enters: the form, a file,
// a log. Unknown keys are dropped, so a newer file opens in an older viewer.

import * as z from "zod";
import { QuestionIdSchema } from "./question";

/** An agent in a match: `a<slot>`, a0 … a15 in slot order. */
export const AgentIdSchema = z.string().min(1);
export type AgentId = z.infer<typeof AgentIdSchema>;

/** A model's place in an agent: the actor answers the arena's questions on every interval; the planner rewrites memory (row 39). */
export const RoleSchema = z.enum(["actor", "planner"]);
export type Role = z.infer<typeof RoleSchema>;

const Assigned = z.object({ model: z.string().min(1) });

export const AgentSpecSchema = z.object({
  /** The arena this agent is written for (an agent belongs to one arena, row 41). */
  arena: z.string().min(1),
  /** A catalog model id per role; no planner means the arena's fixed plan (a doer-only agent, v3 row 32). */
  roles: z.object({ actor: Assigned, planner: Assigned.optional() }),
  /**
   * The player's words: the planner's system prompt, and per actor question
   * instructions that replace the arena's default when not blank (R22.d).
   */
  prompts: z.object({
    planner: z.string().max(8000),
    actor: z.record(QuestionIdSchema, z.string().max(500)),
  }),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

/** A bot slot: an agent whose actor is the arena's bot `name` (model `bot/<name>`), with no planner and no words. */
export function botSpec(arena: string, name: string): AgentSpec {
  return { arena, roles: { actor: { model: `bot/${name}` } }, prompts: { planner: "", actor: {} } };
}

/** What the planner writes and the actor reads (principle 6): the plan text and the planner's own notes. */
export const MemorySchema = z.object({
  plan: z.string().max(2000),
  scratchpad: z.string().max(4000),
});
export type Memory = z.infer<typeof MemorySchema>;
