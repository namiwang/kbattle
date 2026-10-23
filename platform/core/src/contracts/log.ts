// The version-2 log (DESIGN.md §5.5, rows 43 and 47; ruling R21.f): the one
// file of a match. The platform owns the envelope and three event kinds — Call
// (every model call, replacing v1's Doer and Thinker), Tick (the arena's
// payload after each step) and MatchEnd; every other kind is the arena's.
//
// parseMatchLog checks the platform's part: an arena event only needs a kind
// and a tick, and keeps all its fields. parseMatchLogFor(arena, …) also hands
// the config, each Tick payload and each arena event to the arena's schemas.
// Unknown fields of platform objects are dropped, so a newer file opens in an
// older viewer. Every event tick lies within 0..config.durationTicks (ISSUES
// I-014: a viewer indexes ticks, so a crafted 1e8 would hang it).

import * as z from "zod";
import { AgentIdSchema, AgentSpecSchema, RoleSchema, type AgentId, type Role } from "./agent";
import { BaseConfigSchema, type Arena, type ArenaTypes, type EventBase } from "./arena";
import { MAX_AGENTS, MIN_AGENTS } from "./constants";
import { ModelErrorSchema, UsageSchema } from "./model";
import { AnswersSchema, QuestionsSchema } from "./question";

const TickNumber = z.number().int().min(0);

/**
 * One model call. `requestedTick` is when it was asked, `tick` when its outcome
 * landed (the same for the actor, which holds its tick). An actor call carries
 * its answers or error and usage; a planner call also its input (R22.e).
 */
export const CallEventSchema = z
  .object({
    kind: z.literal("Call"),
    tick: TickNumber,
    requestedTick: TickNumber,
    agent: AgentIdSchema,
    role: RoleSchema,
    /** The model that answered, as it names itself; the spec's model id when the call failed. */
    model: z.string().min(1),
    ok: z.boolean(),
    questions: QuestionsSchema.optional(),
    answers: AnswersSchema.optional(),
    error: ModelErrorSchema.optional(),
    usage: UsageSchema.optional(),
    input: z.unknown().optional(),
  })
  .refine((call) => call.requestedTick <= call.tick, { path: ["requestedTick"], message: "requestedTick cannot be after tick" })
  .refine((call) => !call.ok || call.answers !== undefined, { path: ["answers"], message: "ok: true needs answers" })
  .refine((call) => call.ok || call.error !== undefined, { path: ["error"], message: "ok: false needs an error" });
export type CallEvent = z.infer<typeof CallEventSchema>;

/** The arena's payload after the step of `tick` (tick 0: after spawn), what a replay draws from. */
export const TickEventSchema = z.object({ kind: z.literal("Tick"), tick: TickNumber, data: z.unknown() });
export type TickEvent<Data = unknown> = { kind: "Tick"; tick: number; data: Data };

/** The ranking, winner first, and the arena's results per agent when it has them. A cancelled match ranks nobody. */
export const MatchEndEventSchema = z.object({
  kind: z.literal("MatchEnd"),
  tick: TickNumber,
  ranking: z.array(AgentIdSchema),
  results: z.record(AgentIdSchema, z.unknown()).optional(),
});
export type MatchEndEvent = z.infer<typeof MatchEndEventSchema>;

/** The platform's event kinds; an arena's kinds are any others. */
export const PLATFORM_EVENT_KINDS = Object.freeze(["Call", "Tick", "MatchEnd"] as const);
export type PlatformEvent = CallEvent | TickEvent | MatchEndEvent;

const PLATFORM_EVENTS = { Call: CallEventSchema, Tick: TickEventSchema, MatchEnd: MatchEndEventSchema } as const;
const isPlatformKind = (kind: string): kind is keyof typeof PLATFORM_EVENTS => Object.hasOwn(PLATFORM_EVENTS, kind);

/** An arena's event as the platform sees it: a kind of its own, a tick, and any other fields, kept as they are. */
export const ArenaEventSchema = z.looseObject({
  kind: z
    .string()
    .min(1)
    .refine((kind) => !isPlatformKind(kind), { message: "Call, Tick and MatchEnd are the platform's kinds" }),
  tick: TickNumber,
});
export type ArenaEvent = z.infer<typeof ArenaEventSchema>;

export type Event = PlatformEvent | ArenaEvent;

/**
 * Any event: one of a platform kind is read by that kind's schema (unknown fields
 * dropped), any other kind passes through with all its fields. Errors point into
 * the event ("answers", "tick"), whatever its kind.
 */
export const EventSchema = z.looseObject({ kind: z.string().min(1), tick: TickNumber }).transform((event, ctx): Event => {
  if (!isPlatformKind(event.kind)) return event;
  const parsed = PLATFORM_EVENTS[event.kind].safeParse(event);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
  return z.NEVER;
});

export const MatchLogSchema = z
  .object({
    version: z.literal(2),
    arena: z.string().min(1),
    mode: z.string().min(1),
    /** The arena's config: the platform reads seed and durationTicks and keeps the arena's fields as they are. */
    config: BaseConfigSchema.loose(),
    /** By slot: agent `a<slot>` is agents[slot]. */
    agents: z.array(AgentSpecSchema).min(MIN_AGENTS).max(MAX_AGENTS),
    events: z.array(EventSchema),
  })
  .superRefine((log, ctx) => {
    log.agents.forEach((agent, i) => {
      if (agent.arena === log.arena) return;
      ctx.addIssue({ code: "custom", path: ["agents", i, "arena"], message: `an agent for "${agent.arena}" in a log of "${log.arena}"` });
    });
    const last = log.config.durationTicks;
    log.events.forEach((event, i) => {
      if (event.tick <= last) return;
      ctx.addIssue({ code: "custom", path: ["events", i, "tick"], message: `tick is after config.durationTicks (${last})` });
    });
  });
export type MatchLog = z.infer<typeof MatchLogSchema>;

/** An event of an arena's log, typed with the arena's payload and events. */
export type EventFor<T extends ArenaTypes> = CallEvent | TickEvent<T["TickData"]> | MatchEndEvent | T["Event"];

/** A log as its arena reads it: its config, Tick payloads and events typed by the arena. */
export type MatchLogFor<T extends ArenaTypes> = Omit<MatchLog, "config" | "events"> & { config: T["Config"]; events: EventFor<T>[] };

/** The platform's part of a log; throws a ZodError whose issues give the paths ("events", 12, "tick"). */
export function parseMatchLog(json: unknown): MatchLog {
  return MatchLogSchema.parse(json);
}

/**
 * A log checked by its arena as well: the platform's part first, then that it is
 * this arena's log in one of its modes, its config by arena.config, each Tick
 * payload by arena.tickData and each arena event by arena.events, all read as
 * those schemas read them. Throws a ZodError; every issue's path names where
 * ("events", 12, "data", …).
 */
export function parseMatchLogFor<T extends ArenaTypes>(arena: Arena<T>, json: unknown): MatchLogFor<T> {
  return MatchLogSchema.transform((log, ctx): MatchLogFor<T> => {
    let fits = true;
    const refuse = (path: PropertyKey[], message: string) => {
      fits = false;
      ctx.addIssue({ code: "custom", path, message });
    };
    const report = (path: PropertyKey[], error: z.ZodError) => {
      fits = false;
      for (const issue of error.issues) ctx.addIssue({ ...issue, path: [...path, ...issue.path] });
    };
    if (log.arena !== arena.id) {
      refuse(["arena"], `a log of "${log.arena}", not "${arena.id}"`);
      return z.NEVER;
    }
    if (!arena.modes.includes(log.mode)) refuse(["mode"], `"${log.mode}" is not a mode of ${arena.id} (${arena.modes.join(", ")})`);
    const config = arena.config.safeParse(log.config);
    if (!config.success) report(["config"], config.error);
    const events: EventFor<T>[] = [];
    log.events.forEach((event, i) => {
      if (event.kind === "Tick") {
        const data = arena.tickData.safeParse((event as TickEvent).data);
        if (data.success) events.push({ kind: "Tick", tick: event.tick, data: data.data });
        else report(["events", i, "data"], data.error);
      } else if (isPlatformKind(event.kind)) {
        events.push(event as PlatformEvent);
      } else {
        const parsed = arena.events.safeParse(event);
        if (parsed.success) events.push(parsed.data);
        else report(["events", i], parsed.error);
      }
    });
    if (!fits || !config.success) return z.NEVER;
    return { ...log, config: config.data, events };
  }).parse(json);
}

/**
 * The event type of kind K among events E: the kind's own type when E has one,
 * else an arena event of that kind (a plain log types no arena kinds; parse it
 * with parseMatchLogFor to get them).
 */
export type EventOf<K extends string, E extends EventBase = Event> = [Extract<E, { kind: K }>] extends [never]
  ? Exclude<E, PlatformEvent> & { kind: K }
  : Extract<E, { kind: K }>;

/** The events of one kind, in log order, typed to that kind. */
export function eventsOfKind<E extends EventBase, K extends E["kind"]>(log: { readonly events: readonly E[] }, kind: K): EventOf<K, E>[] {
  return log.events.filter((event) => event.kind === kind) as EventOf<K, E>[];
}

/** The highest tick of any event (where a replay ends); 0 for a log without events. */
export function lastTick(log: { readonly events: readonly EventBase[] }): number {
  let last = 0;
  for (const event of log.events) if (event.tick > last) last = event.tick;
  return last;
}

/** One agent's calls in log order, of one role when `role` is given. */
export function callsOf(log: { readonly events: readonly EventBase[] }, agent: AgentId, role?: Role): CallEvent[] {
  const calls: CallEvent[] = [];
  for (const event of log.events) {
    if (event.kind !== "Call") continue;
    const call = event as CallEvent; // the platform's kind: a Call, by the log's schema
    if (call.agent === agent && (role === undefined || call.role === role)) calls.push(call);
  }
  return calls;
}
