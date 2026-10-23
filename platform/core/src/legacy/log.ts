// Read helpers over a parsed MatchLog. They are written against the z.infer types
// from ./schemas, so a schema change that breaks them breaks the typecheck.

import type { Event, MatchLog } from "./schemas";

export type EventKind = Event["kind"];

/** The event type of one kind, e.g. EventOf<"Tick">. */
export type EventOf<K extends EventKind> = Extract<Event, { kind: K }>;

/** The events of one kind, in log order, typed to that kind. */
export function eventsOfKind<K extends EventKind>(log: MatchLog, kind: K): EventOf<K>[] {
  return log.events.filter((event): event is EventOf<K> => event.kind === kind);
}

/** The highest tick of any event (where a replay ends); 0 for a log with no events. */
export function lastTick(log: MatchLog): number {
  let last = 0;
  for (const event of log.events) if (event.tick > last) last = event.tick;
  return last;
}
