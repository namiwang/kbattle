// Replaying a recorded match (DESIGN.md §5.3 "replaying", §5.5; ruling R22.h,
// k): models that answer from a log's Call events instead of thinking, and a
// match played again with one per role per agent, which reproduces the log byte
// for byte (the determinism contract at the top of run.ts).
//
// What a clock decided in the recording comes back from the log, never from this
// run's clock: a recorded timeout is answered as its error at once (the replay's
// own timeouts are off), a planner reply lands at its recorded tick, a cancelled
// recording is cancelled after the same tick. A replaying actor answers at the
// tick it is asked; a replaying planner holds its reply until the tick before the
// recorded landing has been logged (replayMatch tells it through onTick), so the
// loop sees it settled at the start of the landing tick. A planner call the
// recording cut at its end (logged after the last Tick) is never answered: the
// replayed match cuts it the same way.

import {
  modelError,
  QUESTION_TYPES,
  type AgentId,
  type AgentSpec,
  type Arena,
  type ArenaTypes,
  type CallEvent,
  type EventBase,
  type MatchEndEvent,
  type MatchLogFor,
  type Model,
  type Reply,
  type Role,
} from "../contracts";
import { playMatch } from "./run";

/** What a replay reads of a log: a MatchLog, or a MatchLogFor<T> (parseMatchLogFor's). */
export interface RecordedMatch {
  mode: string;
  config: unknown;
  agents: readonly AgentSpec[];
  events: readonly EventBase[];
}

/** A model answering from a recording; it learns where the match is from tickDone. */
export interface ReplayingModel extends Model {
  /** Tick `tick` has been logged: replies recorded as landing at tick + 1 are given now, and later calls belong to tick + 1. */
  tickDone(tick: number): void;
}

/** A recorded call: its Call event, and whether the recording cut it at its end (a planner call logged after the last Tick). */
interface Recorded {
  call: CallEvent;
  cut: boolean;
}

/**
 * `agent`'s recorded `role` (R22.k): asked at tick t, it gives the reply of the
 * agent's Call of that role requested at t (its answers, usage and model name, or
 * its error), at once for the actor and once tick (landing − 1) is done for the
 * planner. A call it has no record of gets an `invalid_output` error naming the
 * agent, the role and the tick, so a replay that drifted from its recording shows
 * where. It ignores the call's signal: a recorded timeout comes back as its error.
 * Its id is the agent's recorded model for the role.
 */
export function makeReplayingModel(log: Pick<RecordedMatch, "agents" | "events">, agent: AgentId, role: Role): ReplayingModel {
  let lastTickAt = -1;
  log.events.forEach((event, i) => {
    if (event.kind === "Tick") lastTickAt = i;
  });
  const byTick: Record<number, Recorded> = {};
  log.events.forEach((event, i) => {
    if (event.kind !== "Call") return;
    const call = event as CallEvent; // the platform's kind: a Call, by the log's schema
    if (call.agent === agent && call.role === role) byTick[call.requestedTick] = { call, cut: role === "planner" && i > lastTickAt };
  });
  const spec = log.agents[Number(agent.slice(1))];
  const id = (role === "planner" ? spec?.roles.planner?.model : spec?.roles.actor.model) ?? `replay/${agent}/${role}`;

  let now = 1; // the tick being played
  const held: { after: number; give: () => void }[] = [];
  return {
    id,
    supports: new Set(QUESTION_TYPES),
    ask() {
      const recorded = Object.hasOwn(byTick, now) ? byTick[now] : undefined;
      if (!recorded) return Promise.resolve(drifted(`replay: no recorded ${role} call for ${agent} at tick ${now}`));
      if (recorded.cut) return new Promise<Reply>(() => {});
      const reply = replyOf(recorded.call);
      if (recorded.call.tick <= now) return Promise.resolve(reply);
      // Not async on purpose: the loop sees the reply one promise turn after tickDone gives it.
      return new Promise<Reply>((give) => held.push({ after: recorded.call.tick - 1, give: () => give(reply) }));
    },
    tickDone(tick) {
      now = tick + 1;
      for (let i = 0; i < held.length; ) {
        const entry = held[i]!;
        if (entry.after > tick) {
          i++;
          continue;
        }
        held.splice(i, 1);
        entry.give();
      }
    },
  };
}

/**
 * Plays a recorded match again (R22.k): runMatch with the log's mode, config and
 * agents and a replaying model per role per agent, bots included, with no
 * timeouts and no wall floor. A recording whose MatchEnd ranks nobody (cancelled,
 * or ended by a fatal reply) is cancelled after its last tick; the loop puts the
 * arena's ending and a fatal reply before a cancel, so each comes back as it was.
 * `opts.onTick` is called after the replay's own hook, with the replayed state.
 */
export function replayMatch<T extends ArenaTypes>(
  arena: Arena<T>,
  log: RecordedMatch,
  opts: { onTick?: (tick: number, state: T["State"]) => void } = {},
): Promise<MatchLogFor<T>> {
  const last = log.events.at(-1);
  const cancelledAt = last?.kind === "MatchEnd" && (last as MatchEndEvent).ranking.length === 0 ? last.tick : undefined;
  const controller = new AbortController();
  const models: ReplayingModel[] = [];
  return playMatch(
    arena,
    log.config,
    log.agents,
    {
      mode: log.mode,
      timeoutMs: () => Infinity,
      signal: controller.signal,
      onTick(tick, state) {
        for (const model of models) model.tickDone(tick);
        if (tick === cancelledAt) controller.abort();
        opts.onTick?.(tick, state);
      },
    },
    (_id, { slot, role }) => {
      const model = makeReplayingModel(log, `a${slot}`, role);
      models.push(model);
      return model;
    },
  );
}

/** The reply a recorded Call stands for. */
function replyOf(call: CallEvent): Reply {
  if (call.ok) return { ok: true, answers: call.answers ?? {}, usage: call.usage ?? { inputTokens: 0, outputTokens: 0 }, model: call.model };
  return { ok: false, error: call.error ?? modelError("invalid_output", "replay: a failed call without an error") };
}

function drifted(message: string): Reply {
  return { ok: false, error: modelError("invalid_output", message) };
}
