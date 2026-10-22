// Index over a parsed MatchLog so the replay can jump to any tick in O(1)
// (scrubbing never replays from zero). The renderer only reads Tick events,
// which carry every position (DESIGN.md §5.3); nothing here runs the sim.

import { AGENT_HP, lastTick as lastTickOf, type Event, type EventOf, type MatchLog, type Slot } from "@decision-arena/core";

/**
 * A Tick event. Its optional `near` lists the near misses of the step that
 * produced it as `[targetId, fromX, fromY]`, `from` being where the shooter
 * stood (v1.5, ISSUES I-016); it is absent when there were none.
 */
export type TickEvent = EventOf<"Tick">;
export type SpawnEvent = EventOf<"Spawn">;
export type ShotEvent = EventOf<"Shot">;
export type DeathEvent = EventOf<"Death">;
/** One doer call (DESIGN.md §5.3, §5.5): answers when ok, else the error, and the agent keeps its last answers. */
export type DoerEvent = EventOf<"Doer">;
/** One thinker call: applied (or failed) at `tick`, asked for at `requestedTick` (§5.3). */
export type ThinkerEvent = EventOf<"Thinker">;
export type SlotKind = Slot["kind"];

export interface LogIndex {
  /** Highest tick of any event; the replay runs over 0..lastTick. */
  readonly lastTick: number;
  /**
   * The frame to draw at each tick 0..lastTick: that tick's Tick event, else
   * the latest earlier one, else (before the first Tick) the agents at spawn.
   */
  readonly ticks: readonly TickEvent[];
  /** Every agent of the match in spawn (slot) order; ids the first frame names without a Spawn event come after. */
  readonly agents: readonly string[];
  readonly spawns: ReadonlyMap<string, SpawnEvent>;
  readonly deaths: ReadonlyMap<string, DeathEvent>;
  /** Shot events by bullet id: who fired each bullet, and when. */
  readonly shots: ReadonlyMap<string, ShotEvent>;
  /** Each agent's Doer events in tick order (log order within a tick); agents without any are absent. */
  readonly doerCalls: ReadonlyMap<string, readonly DoerEvent[]>;
  /** Each agent's Thinker events in tick order (log order within a tick); agents without any are absent. */
  readonly thinkerCalls: ReadonlyMap<string, readonly ThinkerEvent[]>;
  /** The frame at `tick`, floored and clamped to 0..lastTick. */
  byTick(tick: number): TickEvent;
  /** The events logged at exactly `tick`, in log order; empty when there are none. */
  eventsAt(tick: number): readonly Event[];
  /** Slot kind of an agent: `aN` sits in slot N (§6.1). */
  kindOf(agentId: string): SlotKind | undefined;
}

/** `tick` floored and clamped to 0..lastTick, NaN to 0: the tick a scrub to `tick` shows. */
export function clampTick(tick: number, lastTick: number): number {
  return Number.isNaN(tick) ? 0 : Math.min(Math.max(Math.floor(tick), 0), lastTick);
}

const NO_EVENTS: readonly Event[] = Object.freeze([]);

export function indexLog(log: MatchLog): LogIndex {
  const lastTick = lastTickOf(log);
  const spawns = new Map<string, SpawnEvent>();
  const deaths = new Map<string, DeathEvent>();
  const shots = new Map<string, ShotEvent>();
  const doerCalls = new Map<string, DoerEvent[]>();
  const thinkerCalls = new Map<string, ThinkerEvent[]>();
  const recorded: (TickEvent | undefined)[] = new Array(lastTick + 1);
  const atTick: (Event[] | undefined)[] = new Array(lastTick + 1);
  for (const event of log.events) {
    (atTick[event.tick] ??= []).push(event);
    if (event.kind === "Tick") recorded[event.tick] = event;
    else if (event.kind === "Spawn") spawns.set(event.agent, event);
    else if (event.kind === "Death") deaths.set(event.agent, event);
    else if (event.kind === "Shot") shots.set(event.bullet, event);
    else if (event.kind === "Doer") listOf(doerCalls, event.agent).push(event);
    else if (event.kind === "Thinker") listOf(thinkerCalls, event.agent).push(event);
  }
  // The writer logs in tick order; a file written by hand may not. Sorting is stable.
  for (const calls of [...doerCalls.values(), ...thinkerCalls.values()]) calls.sort((a, b) => a.tick - b.tick);

  let frame: TickEvent = {
    kind: "Tick",
    tick: 0,
    agents: [...spawns.values()].map((s) => [s.agent, s.pos.x, s.pos.y, s.facing, AGENT_HP]),
    bullets: [],
  };
  const ticks: TickEvent[] = [];
  for (let t = 0; t <= lastTick; t++) {
    frame = recorded[t] ?? frame;
    ticks.push(frame);
  }

  const agents = new Set(spawns.keys());
  for (const [id] of ticks[0]?.agents ?? []) agents.add(id);

  return {
    lastTick,
    ticks,
    agents: [...agents],
    spawns,
    deaths,
    shots,
    doerCalls,
    thinkerCalls,
    byTick(tick) {
      const t = clampTick(tick, lastTick);
      const found = ticks[t];
      if (!found) throw new Error(`no frame at tick ${t}`); // unreachable: ticks covers 0..lastTick
      return found;
    },
    eventsAt(tick) {
      return (Number.isInteger(tick) ? atTick[tick] : undefined) ?? NO_EVENTS;
    },
    kindOf(agentId) {
      const slot = /^a(\d+)$/.exec(agentId)?.[1];
      return slot === undefined ? undefined : log.config.slots[Number(slot)]?.kind;
    },
  };
}

function listOf<T>(lists: Map<string, T[]>, key: string): T[] {
  let list = lists.get(key);
  if (!list) lists.set(key, (list = []));
  return list;
}
