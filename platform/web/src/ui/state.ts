// The page's state (DESIGN.md §7 items 1-3): the provider key, the prompts and
// the match form, in a tiny store saved to localStorage; and the pure rules that
// turn the form into a MatchConfig. Run match (v4.2) calls validateForm.

import { MAP_IDS, MatchConfigSchema, PromptsSchema, type MatchConfig, type Prompts, type Slot } from "@kbattle/core";
import * as z from "zod";
import { formatIssuePath } from "../replay/errors";
import { DEFAULT_CONFIG, DEFAULT_PROMPTS } from "./defaults";
import { loadState, saveState, type StorageLike } from "./storage";

/** The match form as the user left it (DESIGN.md §7 item 3). NaN is an emptied number input. */
export interface MatchForm {
  mapId: string;
  seed: number;
  /** Total slots; whatever is not prompted or doer-only is a bot. */
  slots: number;
  prompted: number;
  doerOnly: number;
  durationTicks: number;
}

/** What the page keeps between visits. */
export interface UiState {
  /** The provider key, "" when none is saved. */
  key: string;
  prompts: Prompts;
  config: MatchForm;
}

/** One problem with the form or the prompts; `path` as code writes it (`doerInstructions.move`). */
export interface FormIssue {
  path: string;
  message: string;
}

export type ConfigResult = { ok: true; value: MatchConfig } | { ok: false; issues: FormIssue[] };
export type FormResult = { ok: true; config: MatchConfig; prompts: Prompts } | { ok: false; issues: FormIssue[] };

type Range = Readonly<{ min: number; max: number }>;

const rangeOf = (schema: { minValue: number | null; maxValue: number | null }): Range =>
  Object.freeze({ min: schema.minValue ?? 0, max: schema.maxValue ?? Number.MAX_SAFE_INTEGER });

/** Slots in a match the page offers (row 6); MatchConfig itself allows 2 for headless tests. */
export const SLOT_RANGE: Range = Object.freeze({ min: 4, max: 16 });
/** Seed and duration bounds, read from core's MatchConfig schema so the form cannot drift from it. */
export const SEED_RANGE: Range = rangeOf(MatchConfigSchema.shape.seed);
export const DURATION_RANGE: Range = rangeOf(MatchConfigSchema.shape.durationTicks);

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

/**
 * The slots of a match in seat order: prompted, then doer-only, then bots alternating
 * wanderer and camper (row 23). Agent ids follow it, so a0 is the first prompted slot.
 * Throws a RangeError unless the counts are whole and prompted + doerOnly <= total;
 * toMatchConfig checks the form first.
 */
export function slotsFor(total: number, prompted: number, doerOnly: number): Slot[] {
  if (!isCount(total) || !isCount(prompted) || !isCount(doerOnly) || prompted + doerOnly > total) {
    throw new RangeError(`${prompted} prompted and ${doerOnly} doer-only slots do not fit in ${total} slots`);
  }
  return Array.from({ length: total }, (_, i): Slot => {
    if (i < prompted) return { kind: "prompted" };
    if (i < prompted + doerOnly) return { kind: "doer" };
    return { kind: "bot", bot: (i - prompted - doerOnly) % 2 === 0 ? "wanderer" : "camper" };
  });
}

export const hasKey = (key: string): boolean => key.trim() !== "";

/**
 * The form as it runs: without a key there are no prompted slots (DESIGN.md §7
 * item 3), so prompted counts as 0. The saved form keeps the user's number for
 * when a key comes back.
 */
export function effectiveConfig(config: MatchForm, key: string): MatchForm {
  return hasKey(key) ? config : { ...config, prompted: 0 };
}

/** Every failure of the field gives the one message, which says what is allowed. */
function wholeNumber(range: Partial<Range> & { min: number }, message: string) {
  const n = z.number({ error: message }).int({ error: message }).min(range.min, { error: message });
  return range.max === undefined ? n : n.max(range.max, { error: message });
}

const fromTo = ({ min, max }: Range, unit = "") => `must be a whole number${unit} from ${min} to ${max}`;
const COUNT = "must be a whole number, 0 or more";

const MatchFormSchema = z
  .object({
    mapId: z.string().superRefine((id, ctx) => {
      if (!MAP_IDS.includes(id)) {
        ctx.addIssue({ code: "custom", message: `unknown map ${JSON.stringify(id)}; the maps are ${MAP_IDS.join(", ")}` });
      }
    }),
    seed: wholeNumber(SEED_RANGE, fromTo(SEED_RANGE)),
    slots: wholeNumber(SLOT_RANGE, fromTo(SLOT_RANGE)),
    prompted: wholeNumber({ min: 0 }, COUNT),
    doerOnly: wholeNumber({ min: 0 }, COUNT),
    durationTicks: wholeNumber(DURATION_RANGE, fromTo(DURATION_RANGE, " of ticks")),
  })
  .superRefine((form, ctx) => {
    const { slots, prompted, doerOnly } = form;
    if (prompted > slots) {
      ctx.addIssue({ code: "custom", path: ["prompted"], message: `${prompted} prompted slots do not fit in ${slots} slots` });
    } else if (prompted + doerOnly > slots) {
      ctx.addIssue({
        code: "custom",
        path: ["doerOnly"],
        message: `${prompted} prompted and ${doerOnly} doer-only slots do not fit in ${slots} slots`,
      });
    }
  });

const issuesOf = (error: z.ZodError): FormIssue[] =>
  error.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message }));

/** The MatchConfig the form describes, checked with zod against the form rules and core's MatchConfig. */
export function toMatchConfig(form: MatchForm): ConfigResult {
  const parsed = MatchFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const { mapId, seed, durationTicks, slots, prompted, doerOnly } = parsed.data;
  const config = MatchConfigSchema.safeParse({ mapId, seed, durationTicks, slots: slotsFor(slots, prompted, doerOnly) });
  return config.success ? { ok: true, value: config.data } : { ok: false, issues: issuesOf(config.error) };
}

/** What Run match checks: the form (in no-key mode without a key) as a MatchConfig, and the prompts as Prompts. */
export function validateForm(state: UiState): FormResult {
  const config = toMatchConfig(effectiveConfig(state.config, state.key));
  const prompts = PromptsSchema.safeParse(state.prompts);
  if (config.ok && prompts.success) return { ok: true, config: config.value, prompts: prompts.data };
  return {
    ok: false,
    issues: [...(config.ok ? [] : config.issues), ...(prompts.success ? [] : issuesOf(prompts.error))],
  };
}

/** "Config OK", or the problems as a count line and one `path: message` line each. */
export function formatFormResult(result: FormResult): string {
  if (result.ok) return "Config OK";
  const count = result.issues.length === 1 ? "1 problem" : `${result.issues.length} problems`;
  return [`${count}:`, ...result.issues.map((issue) => `${issue.path || "(form)"}: ${issue.message}`)].join("\n");
}

export interface Store {
  readonly state: UiState;
  /** Replaces the state with what storage holds (defaults where it holds nothing usable) and tells subscribers. */
  load(): void;
  /** Writes the whole state to storage. */
  save(): void;
  /** Changes the given parts, saves just those, and tells subscribers. */
  set(patch: Partial<UiState>): void;
  /** Calls `listener` with the new state after every load and set. Returns the unsubscribe function. */
  subscribe(listener: (state: UiState) => void): () => void;
}

/** A store over `storage` (null: memory only), starting from the defaults until load(). */
export function createStore(storage: StorageLike | null): Store {
  let state: UiState = { key: "", prompts: DEFAULT_PROMPTS, config: DEFAULT_CONFIG };
  const listeners = new Set<(state: UiState) => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener(state);
  };
  return {
    get state() {
      return state;
    },
    load() {
      state = loadState(storage);
      notify();
    },
    save() {
      saveState(storage, state);
    },
    set(patch) {
      state = { ...state, ...patch };
      saveState(storage, patch);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
