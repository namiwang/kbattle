// The thinker's prompt text (DESIGN.md §5.4): a fixed harness prompt followed by
// the user's prompt as the system prompt, and one user message per call with the
// agent's perception, its current plan, the digest of what changed and its
// scratchpad. Only what core.perceive gives the agent goes in (principle 3).
import {
  AGENT_HP,
  ARENA_HEIGHT_M,
  ARENA_WIDTH_M,
  BULLET_DAMAGE,
  DOER_INTERVAL_TICKS,
  HEAR_SHOT_RANGE_M,
  HEAR_STEPS_RANGE_M,
  HEARING_BANDS_M,
  normalizeDeg,
  THINKER_MAX_GAP_TICKS,
  THINKER_MIN_GAP_TICKS,
  TICK_MS,
  VISION_CONE_DEG,
  VISION_RANGE_M,
  type Observation,
  type Prompts,
} from "@decision-arena/core";
import { PLAN_REPLY_CHARS } from "./schemas";

const seconds = (ticks: number) => (ticks * TICK_MS) / 1000;

/**
 * The fixed first part of every thinker system prompt (§5.4): the game, what the
 * agent can do, how to read the user message, and the JSON to answer with. Users
 * never see or edit it. Numbers come from core's constants, so it follows a retune.
 */
export const HARNESS_PROMPT = `You are the thinker of one agent in kbattle, a top-down battle royale on a ${ARENA_WIDTH_M} x ${ARENA_HEIGHT_M} m arena with walls. The last one alive wins; ranking is survival, then kills, then hp. Hp starts at ${AGENT_HP}; a hit costs ${BULLET_DAMAGE}. Walls block bullets and sight.

A doer model steers your agent every ${seconds(DOER_INTERVAL_TICKS)} s: move (forward, back, left, right, stop; relative to facing), turn (left, right, none, face_target), fire, target (a visible enemy). You are called when it finds your plan no longer fits (at most every ${seconds(THINKER_MIN_GAP_TICKS)} s), and at least every ${seconds(THINKER_MAX_GAP_TICKS)} s.

Each call gives you:
Now (tick N, seconds left; a tick is ${TICK_MS} ms):
self: position (x, y) in m, y down; facing in degrees, 0° = +x, clockwise; hp; kills.
visible: enemies within ${VISION_CONE_DEG / 2}° of facing and ${VISION_RANGE_M} m, in line of sight: id at bearing, distance.
heard: shots within ${HEAR_SHOT_RANGE_M} m, steps within ${HEAR_STEPS_RANGE_M} m; near < ${HEARING_BANDS_M.near} m, mid < ${HEARING_BANDS_M.mid} m, far.
incoming: where bullets that hit or just missed you came from.
Bearings are degrees off your facing, + = right.
Current plan: your last plan.
Since your last call: what changed, newest first.
Scratchpad: your notes.

Reply with:
text: the new plan, given to the doer verbatim at every decision. Concrete and situational, in its terms: where to move and face, whom to target, when to fire or fall back. Short.
scratchpad: your private memory for the next call, rewritten each time. Short.

Output only the JSON {"text": string ≤ ${PLAN_REPLY_CHARS.text} chars, "scratchpad": string ≤ ${PLAN_REPLY_CHARS.scratchpad} chars}.`;

/** The thinker's system prompt: the harness, then the user's prompt under its own heading (§5.4). */
export function buildSystem(prompts: Pick<Prompts, "thinkerSystem">): string {
  return `${HARNESS_PROMPT}\n\n# Your instructions\n${prompts.thinkerSystem}`;
}

/** What one thinker call is about: the tick, what the agent perceives, and the text it carries between calls. */
export interface ThinkerTurn {
  tick: number;
  observation: Observation;
  /** The plan the doer follows now. */
  plan: string;
  /** What the thinker wrote for itself last time (row 12, principle 6). */
  scratchpad: string;
  /** What changed since the last call (event-digest.ts). */
  digest: string;
}

/** The user message of one thinker call: four sections, in the order the harness describes. */
export function buildUserMessage({ tick, observation, plan, scratchpad, digest }: ThinkerTurn): string {
  const secondsLeft = Math.round(observation.self.secondsLeft * 10) / 10;
  return [
    `# Now (tick ${tick}, ${secondsLeft}s left)\n${formatObservation(observation)}`,
    `# Current plan\n${orElse(plan, "(none yet)")}`,
    `# Since your last call\n${orElse(digest, "(nothing new)")}`,
    `# Scratchpad\n${orElse(scratchpad, "(empty)")}`,
  ].join("\n\n");
}

/** Rough token count for budgets (§5.4): a token per four characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The observation as four text lines: self, visible, heard, incoming. Lists keep
 * perception's order (nearest first, §5.4 most-important-first); fields are written
 * in a fixed order, so the text depends only on the values. Positions and distances
 * are rounded to whole meters and angles to whole degrees in (-180, 180].
 */
export function formatObservation({ self, visible, heard, incoming }: Observation): string {
  return [
    `self: at (${meters(self.pos.x)}, ${meters(self.pos.y)}), facing ${degrees(self.facing)}, hp ${self.hp}, kills ${self.kills}`,
    `visible: ${list(visible.map((v) => `${v.id} at ${degrees(v.bearing)} ${meters(v.dist)} m${v.moving ? " moving" : ""}`))}`,
    `heard: ${list(heard.map((h) => `${h.kind} at ${degrees(h.bearing)} ${h.dist}`))}`,
    `incoming: ${list(incoming.map((i) => `from ${degrees(i.bearing)}`))}`,
  ].join("\n");
}

function meters(value: number): number {
  return Math.round(value); // a template literal writes -0 as "0"
}

function degrees(angle: number): string {
  return `${normalizeDeg(Math.round(angle))}°`;
}

function list(items: string[]): string {
  return items.length === 0 ? "none" : items.join("; ");
}

/** `text`, or `placeholder` when it is blank, so no section reads as cut off. */
function orElse(text: string, placeholder: string): string {
  return text.trim() === "" ? placeholder : text;
}
