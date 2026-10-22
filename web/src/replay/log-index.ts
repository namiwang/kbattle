// Index over a parsed MatchLog so the replay can jump to any tick in O(1)
// (scrubbing never replays from zero). The renderer only reads Tick events,
// which carry every position (DESIGN.md §5.3); nothing here runs the sim.

import { AGENT_HP, lastTick as lastTickOf, type Event, type EventOf, type MatchLog, type Slot } from "@kbattle/core";

/** A near miss on a Tick row, `[targetId, fromX, fromY]` (ISSUES I-016): `from` is where the shooter stood. */
export type NearMissRow = readonly [target: string, fromX: number, fromY: number];

/**
 * A Tick event as the viewer reads it. v1.5 adds the optional `near` field
 * (present only when non-empty); a log written before it has none.
 */
export type TickEvent = EventOf<"Tick"> & { readonly near?: readonly NearMissRow[] };
export type SpawnEvent = EventOf<"Spawn">;
export type ShotEvent = EventOf<"Shot">;
export type DeathEvent = EventOf<"Death">;
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
  const recorded: (TickEvent | undefined)[] = new Array(lastTick + 1);
  const atTick: (Event[] | undefined)[] = new Array(lastTick + 1);
  for (const event of log.events) {
    (atTick[event.tick] ??= []).push(event);
    if (event.kind === "Tick") recorded[event.tick] = event;
    else if (event.kind === "Spawn") spawns.set(event.agent, event);
    else if (event.kind === "Death") deaths.set(event.agent, event);
    else if (event.kind === "Shot") shots.set(event.bullet, event);
  }

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
