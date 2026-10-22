// What the page keeps in localStorage (DESIGN.md §7, §10 Keys): the provider
// key, the prompts and the match form, under versioned `kbattle:v1:*` keys.
//
// - The key is plain text, the convention the v0.6 spike page already uses, so
//   both pages share it. Prompts and form are JSON.
// - Loading never fails: a value that is missing, not JSON or the wrong shape
//   gives the default, field by field, so one bad field does not cost the user
//   the rest of a long prompt. A storage that throws (blocked, full) reads as
//   empty and drops writes; the page then works for this visit only.
// - Versioning is in the key names: a stored shape that changes incompatibly
//   moves to `kbattle:v2:*` and v1 values are left behind.

import { MAP_IDS, PromptsSchema } from "@kbattle/core";
import * as z from "zod";
import { DEFAULT_CONFIG, DEFAULT_PROMPTS } from "./defaults";
import type { UiState } from "./state";

export const STORAGE_KEYS = Object.freeze({
  key: "kbattle:v1:anthropic-key",
  prompts: "kbattle:v1:prompts",
  config: "kbattle:v1:config",
});

/** The part of the Web Storage API the page uses; tests pass a fake. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** window.localStorage, or null where the browser refuses it (sandboxed frames, blocked storage). */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const doer = PromptsSchema.shape.doerInstructions.shape;
const StoredPrompts = z
  .object({
    thinkerSystem: PromptsSchema.shape.thinkerSystem.catch(DEFAULT_PROMPTS.thinkerSystem),
    doerInstructions: z
      .object({
        move: doer.move.catch(DEFAULT_PROMPTS.doerInstructions.move),
        turn: doer.turn.catch(DEFAULT_PROMPTS.doerInstructions.turn),
        fire: doer.fire.catch(DEFAULT_PROMPTS.doerInstructions.fire),
        target: doer.target.catch(DEFAULT_PROMPTS.doerInstructions.target),
      })
      .catch(DEFAULT_PROMPTS.doerInstructions),
  })
  .catch(DEFAULT_PROMPTS);

// Any finite number loads as it was typed; the form's validation, not loading, reports
// values out of range. NaN was saved as null and loads as the default.
const StoredConfig = z
  .object({
    mapId: z
      .string()
      .refine((id) => MAP_IDS.includes(id))
      .catch(DEFAULT_CONFIG.mapId),
    seed: z.number().catch(DEFAULT_CONFIG.seed),
    slots: z.number().catch(DEFAULT_CONFIG.slots),
    prompted: z.number().catch(DEFAULT_CONFIG.prompted),
    doerOnly: z.number().catch(DEFAULT_CONFIG.doerOnly),
    durationTicks: z.number().catch(DEFAULT_CONFIG.durationTicks),
  })
  .catch(DEFAULT_CONFIG);

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Blocked or full: this visit keeps working from memory.
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  const text = read(storage, key);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The saved state, with defaults wherever storage holds nothing usable. */
export function loadState(storage: StorageLike | null): UiState {
  return {
    key: read(storage, STORAGE_KEYS.key)?.trim() ?? "",
    prompts: StoredPrompts.parse(readJson(storage, STORAGE_KEYS.prompts)),
    config: StoredConfig.parse(readJson(storage, STORAGE_KEYS.config)),
  };
}

/** Saves the parts of `state` that are present. A blank key removes the stored one. */
export function saveState(storage: StorageLike | null, state: Partial<UiState>): void {
  if (state.key !== undefined) {
    const key = state.key.trim();
    write(storage, STORAGE_KEYS.key, key === "" ? null : key);
  }
  if (state.prompts !== undefined) write(storage, STORAGE_KEYS.prompts, JSON.stringify(state.prompts));
  if (state.config !== undefined) write(storage, STORAGE_KEYS.config, JSON.stringify(state.config));
}
