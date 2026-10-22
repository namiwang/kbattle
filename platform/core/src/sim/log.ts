// The log writer (DESIGN.md §5.3, principle 7; sim ruling R10; ISSUES I-014,
// I-016): what the match loop appends, turned into the one-file MatchLog.
//
// Spawn and Tick rows are built from the world and rounded as people and the
// mind panel read them: x and y to 2 decimals, facing to 1 (then into
// (-180, 180]), hp whole; perceive rounds the agent's own position and facing
// the same way, so a view rebuilt from Tick rows matches the one the agent got.
// Dead agents are left out of Tick rows; bullets are listed while in flight;
// near misses are written only when there are some. Every event's tick is an
// integer in 0..config.durationTicks: the writer refuses anything else.
// (platform/core/src/log.ts holds the read helpers over a finished log.)

import { normalizeDeg } from "../angles";
import type { EventOf } from "../log";
import type { Event, MatchConfig, MatchLog, Prompts } from "../schemas";
import type { AgentId, WorldState } from "../types";
import { roundTo } from "./round";

export interface LogWriter {
  /** A Spawn event per agent (slot order), then the Tick snapshot of that world (R1: tick 0). */
  spawn(state: WorldState): void;
  /** Appends events as they are, in order (Thinker, Doer, Shot, Hit, Death). */
  append(events: readonly Event[]): void;
  /** The Tick event of `state`: positions after the step of `state.tick`. */
  tick(state: WorldState): void;
  /** The MatchEnd event: ranking winner first, empty for a cancelled match. */
  end(tick: number, ranking: readonly AgentId[]): void;
  /** The log so far, as a snapshot: later appends do not change it. */
  log(): MatchLog;
}

/**
 * A writer for one match. It keeps its own copies of `config` and `prompts`, and
 * throws a RangeError for an event tick that is not an integer in
 * 0..config.durationTicks (nothing is appended then).
 */
export function createLogWriter(config: MatchConfig, prompts: Prompts): LogWriter {
  const header = { version: 1 as const, config: structuredClone(config), seed: config.seed, prompts: structuredClone(prompts) };
  const last = config.durationTicks;
  const events: Event[] = [];
  const push = (batch: readonly Event[]) => {
    for (const event of batch) {
      if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick > last) {
        throw new RangeError(`${event.kind} event at tick ${event.tick}: a log's ticks are integers in 0..${last}`);
      }
    }
    events.push(...batch);
  };
  return {
    spawn(state) {
      push([...spawnEvents(state), tickEvent(state)]);
    },
    append(batch) {
      push(batch);
    },
    tick(state) {
      push([tickEvent(state)]);
    },
    end(tick, ranking) {
      push([{ kind: "MatchEnd", tick, ranking: [...ranking] }]);
    },
    log() {
      return { ...header, events: [...events] };
    },
  };
}

/** A Spawn event per agent, in slot order, at the world's tick. */
export function spawnEvents(state: WorldState): EventOf<"Spawn">[] {
  return state.agents.map((agent) => ({
    kind: "Spawn",
    tick: state.tick,
    agent: agent.id,
    pos: { x: roundTo(agent.pos.x, 2), y: roundTo(agent.pos.y, 2) },
    facing: facingOf(agent.facing),
  }));
}

/**
 * The Tick event of a world: [id, x, y, facing, hp] for each living agent,
 * [id, x, y] for each bullet in flight, and, when a bullet passed close to
 * someone this tick without hitting, near: [target, fromX, fromY] from the near
 * misses of the step that produced the tick, the newest entry of state.recent
 * (ISSUES I-016; the older entries were written by their own Tick events).
 */
export function tickEvent(state: WorldState): EventOf<"Tick"> {
  const event: EventOf<"Tick"> = {
    kind: "Tick",
    tick: state.tick,
    agents: state.agents
      .filter((agent) => agent.alive)
      .map((agent) => [agent.id, roundTo(agent.pos.x, 2), roundTo(agent.pos.y, 2), facingOf(agent.facing), Math.round(agent.hp)]),
    bullets: state.bullets.map((bullet) => [bullet.id, roundTo(bullet.pos.x, 2), roundTo(bullet.pos.y, 2)]),
  };
  const nearMisses = state.recent.at(-1)?.nearMisses ?? [];
  if (nearMisses.length > 0) {
    event.near = nearMisses.map((miss) => [miss.target, roundTo(miss.from.x, 2), roundTo(miss.from.y, 2)]);
  }
  return event;
}

/** A facing to 1 decimal, in (-180, 180] (-179.96 rounds to -180, which is 180). */
function facingOf(facing: number): number {
  return normalizeDeg(roundTo(facing, 1));
}
