// The registry (DESIGN.md row 42, §5.1; ruling R21.g): the arenas a page or a
// script offers, by id. Core builds none: the instance that names arenas lives
// where they are imported (the web in R1.3, scripts), so the platform never
// names a game.

import type { Arena } from "./arena";

export interface Registry {
  /** The arenas' ids, in the order they were given. */
  ids(): string[];
  /** The arena with this id; throws when there is none. */
  get(id: string): Arena;
}

/** A registry of `entries`; throws when two share an id. Later changes to the array do not reach it. */
export function createRegistry(entries: readonly Arena[]): Registry {
  const arenas = [...entries];
  arenas.forEach((arena, i) => {
    if (arenas.findIndex((other) => other.id === arena.id) !== i) throw new Error(`two arenas have the id "${arena.id}"`);
  });
  return {
    ids: () => Array.from(arenas, (arena) => arena.id),
    get(id) {
      const arena = arenas.find((candidate) => candidate.id === id);
      if (!arena) throw new Error(`no arena "${id}" (known: ${arenas.length > 0 ? Array.from(arenas, (a) => a.id).join(", ") : "none"})`);
      return arena;
    },
  };
}
