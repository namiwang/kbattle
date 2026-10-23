// The world at one tick as perception reads it, rebuilt from the log
// (DESIGN.md §5.3: perceive is pure, so the replay recomputes what an agent
// perceived instead of logging it; sim rulings R6, R7, R15). Nothing here runs
// the sim.
//
// From the Tick row of the tick: position, facing and HP; alive = in the row.
// Agents missing from it are dead: last position seen (the row before their
// death), HP 0. kills: Death events up to the tick naming the agent as killer.
// moved: the position differs from the previous tick's row.
//
// The perception window (`recent`): the steps of the last DOER_INTERVAL_TICKS
// ticks up to this one (ticks 1..t while t < DOER_INTERVAL_TICKS), oldest
// first, as the sim keeps it. Each step s: its Shot events, standing where the
// shooter's row of tick s puts it; its Hit events, from where the bullet's
// owner (its Shot event) stood at tick s, as step() reports them; near misses
// from the optional `near` field of the row of tick s (v1.5, ISSUES I-016),
// none when it is absent or tick s has no row. An agent missing from the row
// of tick s (it died in that step or before) stands at its last row
// (ISSUES I-019).

import { DOER_INTERVAL_TICKS } from "@decision-arena/core";
import type { MatchLog } from "@decision-arena/core/legacy";
import {
  getMap,
  type PerceivedAgent,
  type PerceptionState,
  type TickFacts,
  type Vec2,
} from "@decision-arena/kit-shooter";
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

  const recent: TickFacts[] = [];
  for (let s = Math.max(1, t - DOER_INTERVAL_TICKS + 1); s <= t; s++) recent.push(stepFacts(index, s));

  return { tick: t, durationTicks: log.config.durationTicks, map: getMap(log.config.mapId), agents, recent };
}

/** What happened during the step of tick `s`, as step() recorded it: shots, hits and near misses. */
function stepFacts(index: LogIndex, s: number): TickFacts {
  const frame = index.byTick(s);
  const rows = rowsById(frame);
  const posAt = (id: string): Vec2 | undefined => {
    const row = rows.get(id);
    return row ? { x: row[1], y: row[2] } : index.agents.includes(id) ? lastSeen(index, id).pos : undefined;
  };
  const facts: TickFacts = { shots: [], hits: [], nearMisses: [] };
  for (const event of index.eventsAt(s)) {
    if (event.kind === "Shot") {
      const pos = posAt(event.agent);
      if (pos) facts.shots.push({ agent: event.agent, pos });
    } else if (event.kind === "Hit") {
      const owner = index.shots.get(event.bullet)?.agent;
      const from = owner === undefined ? undefined : posAt(owner);
      if (from) facts.hits.push({ target: event.target, from });
    }
  }
  // Only the row of tick s itself: near misses never carry over a tick without one.
  if (frame.tick === s) {
    for (const [target, x, y] of frame.near ?? []) facts.nearMisses.push({ target, from: { x, y } });
  }
  return facts;
}

/**
 * stateFromTick for one log, remembering the last two ticks it built:
 * everything drawn for the tick on screen (camera, overlay, the mind panel's
 * Perception block) shares one state, and the mind panel's Doer section
 * another, the tick before the doer call in force (R18); each is rebuilt only
 * when its tick changes. A third tick forgets the one asked for least recently.
 */
export function createStateAt(index: LogIndex, log: MatchLog): (tick: number) => PerceptionState {
  let kept: { tick: number; state: PerceptionState }[] = []; // most recently asked for last
  return (tick) => {
    const t = clampTick(tick, index.lastTick);
    const hit = kept.find((k) => k.tick === t) ?? { tick: t, state: stateFromTick(index, log, t) };
    kept = [...kept.filter((k) => k !== hit), hit].slice(-2);
    return hit.state;
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
