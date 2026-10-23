// Replaying a recorded match (DESIGN.md §6.1; plan v1.6): minds that answer from
// a MatchLog instead of thinking, so the same seed and the same recorded
// answers, replayed at their recorded ticks, reproduce the same log byte for
// byte (the determinism contract at the top of match.ts). A recorded failure
// is replayed as a failure with the same text, so the replayed Doer event and
// the action the agent keeps both match; a recorded Thinker event lands at its
// recorded tick through pollEvents.

import type { EventOf, MatchLog } from "@decision-arena/core/legacy";
import type { MapSpec } from "../maps";
import type { AgentId } from "../types";
import { runMatch } from "./match";
import type { DecisionProvider } from "./providers";

/**
 * `agentId`'s recorded mind. decide at tick t resolves with the answers of its
 * Doer event at t, or rejects with that event's error when the call failed; with
 * no Doer event at t it rejects with "replay: no recorded doer call …", so a
 * replay that drifted from its recording shows where. It answers at once and
 * ignores the call's signal (R17): a recorded timeout is replayed as its error.
 * pollEvents(t) returns its Thinker events stamped t, in log order.
 */
export function makeReplayingProvider(log: MatchLog, agentId: AgentId): DecisionProvider {
  const calls = new Map<number, EventOf<"Doer">>();
  const thoughts = new Map<number, EventOf<"Thinker">[]>();
  for (const event of log.events) {
    if (event.kind === "Doer" && event.agent === agentId) calls.set(event.tick, event);
    else if (event.kind === "Thinker" && event.agent === agentId) {
      thoughts.set(event.tick, [...(thoughts.get(event.tick) ?? []), event]);
    }
  }
  return {
    decide({ tick }) {
      const call = calls.get(tick);
      if (!call) return Promise.reject(new Error(`replay: no recorded doer call for ${agentId} at tick ${tick}`));
      if (!call.ok || !call.answers) return Promise.reject(new Error(call.error ?? "replay: a failed call without an error"));
      return Promise.resolve({ model: "replay", answers: call.answers });
    },
    pollEvents(tick) {
      return thoughts.get(tick) ?? [];
    },
  };
}

/**
 * Plays a recorded match again: runMatch with the log's config and prompts and a
 * replaying provider per slot (agent `a<slot>`). A cancelled recording (its
 * MatchEnd ranking is []) is cancelled after the same tick. Pass the map when
 * the recording did not use the bundled one.
 */
export function replayMatch(log: MatchLog, opts: { map?: MapSpec } = {}): Promise<MatchLog> {
  const last = log.events.at(-1);
  const cancelledAt = last?.kind === "MatchEnd" && last.ranking.length === 0 ? last.tick : null;
  const controller = new AbortController();
  return runMatch(log.config, {
    map: opts.map,
    prompts: log.prompts,
    providers: (_slot, slotIndex) => makeReplayingProvider(log, `a${slotIndex}`),
    signal: controller.signal,
    onTick: (tick) => {
      if (tick === cancelledAt) controller.abort();
    },
  });
}
