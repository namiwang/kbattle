// What the battle royale logs (DESIGN.md §5.5, §13; rulings R10, R24; ISSUES
// I-014, I-016): its event kinds, Spawn from the arena and Shot, Hit and Death
// from the kit's step, and the Tick payload the renderer and the agent panel
// read. Both are exactly the version-1 log's: same fields, same order, same
// rounding, so the parity test (R25) can compare a version-2 log with the stored
// version-1 run event for event.
//
// Rows are rounded as people and the agent panel read them: x and y to 2
// decimals, facing to 1 (then into (-180, 180]), hp whole; perceive rounds the
// agent's own position and facing the same way, so a view rebuilt from Tick rows
// matches the one the agent got. Dead agents are left out of Tick rows; bullets
// are listed while in flight; near misses are written only when there are some.

import { roundTo } from "@decision-arena/core";
import { normalizeDeg, Vec2Schema, type WorldState } from "@decision-arena/kit-shooter";
import * as z from "zod";

const TickNumber = z.number().int().min(0);
const AgentId = z.string().min(1); // `a0`…`a15` in slot order
const BulletId = z.string().min(1); // `b<n>`, ascending

/** An agent enters the world at tick 0: where it stands and where it faces. */
export const SpawnEventSchema = z.object({ kind: z.literal("Spawn"), tick: TickNumber, agent: AgentId, pos: Vec2Schema, facing: z.number() });
/** `agent` fired `bullet`. */
export const ShotEventSchema = z.object({ kind: z.literal("Shot"), tick: TickNumber, agent: AgentId, bullet: BulletId });
/** `bullet` hit `target` for `damage` HP. */
export const HitEventSchema = z.object({ kind: z.literal("Hit"), tick: TickNumber, bullet: BulletId, target: AgentId, damage: z.number().positive() });
/** `agent` died, killed by `killer`, the hitting bullet's owner. */
export const DeathEventSchema = z.object({ kind: z.literal("Death"), tick: TickNumber, agent: AgentId, killer: AgentId });

/** The arena's event kinds (arena.events). */
export const BattleRoyaleEventSchema = z.discriminatedUnion("kind", [SpawnEventSchema, ShotEventSchema, HitEventSchema, DeathEventSchema]);
export type BattleRoyaleEvent = z.infer<typeof BattleRoyaleEventSchema>;
export type SpawnEvent = z.infer<typeof SpawnEventSchema>;

/**
 * Tick.data (arena.tickData): positions after the step of the tick, so the
 * renderer never runs the sim. agents: [id, x, y, facing, hp] for agents alive
 * after this tick; bullets: [id, x, y] while in flight; near: [target, fromX,
 * fromY] for each bullet that passed within INCOMING_RADIUS_M of a living agent
 * this tick without hitting it, from = the shooter's position, present only
 * when there is one (ISSUES I-016).
 */
export const TickDataSchema = z.object({
  agents: z.array(z.tuple([AgentId, z.number(), z.number(), z.number(), z.number()])),
  bullets: z.array(z.tuple([BulletId, z.number(), z.number()])),
  near: z.array(z.tuple([AgentId, z.number(), z.number()])).optional(),
});
export type TickData = z.infer<typeof TickDataSchema>;

/** A Spawn event per agent, in slot order, at the world's tick. */
export function spawnEvents(state: WorldState): SpawnEvent[] {
  return state.agents.map((agent) => ({
    kind: "Spawn",
    tick: state.tick,
    agent: agent.id,
    pos: { x: roundTo(agent.pos.x, 2), y: roundTo(agent.pos.y, 2) },
    facing: facingOf(agent.facing),
  }));
}

/**
 * The Tick payload of a world: its living agents and bullets in flight, and the
 * near misses of the step that produced the tick, the newest entry of the
 * perception window (the older ones were written by their own ticks).
 */
export function tickData(state: WorldState): TickData {
  const data: TickData = {
    agents: state.agents
      .filter((agent) => agent.alive)
      .map((agent) => [agent.id, roundTo(agent.pos.x, 2), roundTo(agent.pos.y, 2), facingOf(agent.facing), Math.round(agent.hp)]),
    bullets: state.bullets.map((bullet) => [bullet.id, roundTo(bullet.pos.x, 2), roundTo(bullet.pos.y, 2)]),
  };
  const nearMisses = state.recent.at(-1)?.nearMisses ?? [];
  if (nearMisses.length > 0) data.near = nearMisses.map((miss) => [miss.target, roundTo(miss.from.x, 2), roundTo(miss.from.y, 2)]);
  return data;
}

/** A facing to 1 decimal, in (-180, 180] (-179.96 rounds to -180, which is 180). */
function facingOf(facing: number): number {
  return normalizeDeg(roundTo(facing, 1));
}
