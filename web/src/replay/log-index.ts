// Index over a parsed MatchLog so the replay can jump to any tick in O(1)
// (scrubbing never replays from zero). The renderer only reads Tick events,
// which carry every position (DESIGN.md §5.3); nothing here runs the sim.

import { AGENT_HP, lastTick as lastTickOf, type EventOf, type MatchLog, type Slot } from "@kbattle/core";

export type TickEvent = EventOf<"Tick">;
export type SpawnEvent = EventOf<"Spawn">;
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
  readonly spawns: ReadonlyMap<string, SpawnEvent>;
  readonly deaths: ReadonlyMap<string, DeathEvent>;
  /** The frame at `tick`, floored and clamped to 0..lastTick. */
  byTick(tick: number): TickEvent;
  /** Slot kind of an agent: `aN` sits in slot N (§6.1). */
  kindOf(agentId: string): SlotKind | undefined;
}

export function indexLog(log: MatchLog): LogIndex {
  const lastTick = lastTickOf(log);
  const spawns = new Map<string, SpawnEvent>();
  const deaths = new Map<string, DeathEvent>();
  const recorded: (TickEvent | undefined)[] = new Array(lastTick + 1);
  for (const event of log.events) {
    if (event.kind === "Tick") recorded[event.tick] = event;
    else if (event.kind === "Spawn") spawns.set(event.agent, event);
    else if (event.kind === "Death") deaths.set(event.agent, event);
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

  return {
    lastTick,
    ticks,
    spawns,
    deaths,
    byTick(tick) {
      const t = Number.isNaN(tick) ? 0 : Math.min(Math.max(Math.floor(tick), 0), lastTick);
      const found = ticks[t];
      if (!found) throw new Error(`no frame at tick ${t}`); // unreachable: ticks covers 0..lastTick
      return found;
    },
    kindOf(agentId) {
      const slot = /^a(\d+)$/.exec(agentId)?.[1];
      return slot === undefined ? undefined : log.config.slots[Number(slot)]?.kind;
    },
  };
}
