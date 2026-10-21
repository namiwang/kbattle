// Bundled maps: hand-authored JSON in core/maps (DESIGN.md §6.2). Each is parsed
// through MapSpecSchema on first use, then cached and deeply frozen, so a caller
// that mutates a spawn point fails loudly instead of corrupting the shared map.

import arena1 from "../maps/arena-1.json" with { type: "json" };
import { MapSpecSchema, type MapSpec } from "./schemas";

const BUNDLED: Readonly<Record<string, unknown>> = { "arena-1": arena1 };

/** Ids of the bundled maps. */
export const MAP_IDS: readonly string[] = Object.freeze(Object.keys(BUNDLED));

const parsed = new Map<string, MapSpec>();

/** The bundled map with this id. Throws on an unknown id. */
export function getMap(id: string): MapSpec {
  const cached = parsed.get(id);
  if (cached) return cached;
  if (!Object.hasOwn(BUNDLED, id)) {
    throw new Error(`unknown map id "${id}" (known: ${MAP_IDS.join(", ")})`);
  }
  const map = deepFreeze(MapSpecSchema.parse(BUNDLED[id]));
  parsed.set(id, map);
  return map;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
