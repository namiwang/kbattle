// The world at one tick as perception reads it, rebuilt from the log
// (DESIGN.md §5.3: perceive is pure, so the replay recomputes what an agent
// perceived instead of logging it; sim rulings R6, R7). Nothing here runs the sim.
//
// From the Tick row of the tick: position, facing and HP; alive = in the row.
// Agents missing from it are dead: last position seen (the row before their
// death), HP 0. kills: Death events up to the tick naming the agent as killer.
// moved: the position differs from the previous tick's row. lastTick (what
// happened during the step that produced the tick): its Shot events, standing
// where the shooter is now; its Hit events, from where the bullet's owner (its
// Shot event) is now, as step() reports them; near misses from the row's
// optional `near` field (v1.5, ISSUES I-016), none when it is absent.

import { getMap, type MatchLog, type PerceivedAgent, type PerceptionState, type TickFacts, type Vec2 } from "@kbattle/core";
import { clampTick, type LogIndex, type TickEvent } from "./log-index";

type AgentRow = TickEvent["agents"][number];

/** The state `perceive` needs at `tick` (floored and clamped to the log like a scrub). */
export function stateFromTick(index: LogIndex, log: MatchLog, tick: number): PerceptionState {
  const t = clampTick(tick, index.lastTick);
  const frame = index.byTick(t);
  const rows = rowsById(frame);
  const previous = t > 0 ? index.byTick(t - 1) : frame;
  // A tick without a Tick row repeats the previous frame: nobody moved on it.
  const before = previous === frame ? undefined : rowsById(previous);

  const kills = new Map<string, number>();
  for (const death of index.deaths.values()) {
    if (death.tick <= t) kills.set(death.killer, (kills.get(death.killer) ?? 0) + 1);
  }

  const agents = agentIds(index, frame).map((id): PerceivedAgent => {
    const row = rows.get(id);
    if (!row) return { id, ...lastSeen(index, id), hp: 0, alive: false, kills: kills.get(id) ?? 0, moved: false };
    const [, x, y, facing, hp] = row;
    const was = before?.get(id);
    const moved = was !== undefined && (was[1] !== x || was[2] !== y);
    return { id, pos: { x, y }, facing, hp, alive: true, kills: kills.get(id) ?? 0, moved };
  });
  const posOf = new Map(agents.map((a) => [a.id, a.pos]));

  const lastTick: TickFacts = { shots: [], hits: [], nearMisses: [] };
  for (const event of index.eventsAt(t)) {
    if (event.kind === "Shot") {
      const pos = posOf.get(event.agent);
      if (pos) lastTick.shots.push({ agent: event.agent, pos: { ...pos } });
    } else if (event.kind === "Hit") {
      const owner = index.shots.get(event.bullet)?.agent;
      const from = owner === undefined ? undefined : posOf.get(owner);
      if (from) lastTick.hits.push({ target: event.target, from: { ...from } });
    }
  }
  // Only this tick's own row: near misses never carry over a tick without one.
  if (frame.tick === t) {
    for (const [target, x, y] of frame.near ?? []) lastTick.nearMisses.push({ target, from: { x, y } });
  }

  return { tick: t, durationTicks: log.config.durationTicks, map: getMap(log.config.mapId), agents, lastTick };
}

/**
 * stateFromTick for one log, remembering the last tick it built: everything
 * drawn for the tick on screen (camera, overlay) shares one state, rebuilt
 * only when the tick changes.
 */
export function createStateAt(index: LogIndex, log: MatchLog): (tick: number) => PerceptionState {
  let last: { tick: number; state: PerceptionState } | undefined;
  return (tick) => {
    const t = clampTick(tick, index.lastTick);
    if (last?.tick !== t) last = { tick: t, state: stateFromTick(index, log, t) };
    return last.state;
  };
}

function rowsById(frame: TickEvent): Map<string, AgentRow> {
  return new Map(frame.agents.map((row) => [row[0], row]));
}

/** Every agent of the match (LogIndex.agents), plus any this tick's row names that the index does not know. */
function agentIds(index: LogIndex, frame: TickEvent): string[] {
  const ids = new Set(index.agents);
  for (const [id] of frame.agents) ids.add(id);
  return [...ids];
}

/** Where an agent that is not in the current row was last seen: the row before its death, else its spawn. */
function lastSeen(index: LogIndex, id: string): { pos: Vec2; facing: number } {
  const death = index.deaths.get(id);
  const row = death ? index.byTick(death.tick - 1).agents.find(([agent]) => agent === id) : undefined;
  if (row) return { pos: { x: row[1], y: row[2] }, facing: row[3] };
  const spawn = index.spawns.get(id);
  if (spawn) return { pos: { ...spawn.pos }, facing: spawn.facing };
  const first = index.byTick(0).agents.find(([agent]) => agent === id);
  return first ? { pos: { x: first[1], y: first[2] }, facing: first[3] } : { pos: { x: 0, y: 0 }, facing: 0 };
}
