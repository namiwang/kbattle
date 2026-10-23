import { describe, expect, expectTypeOf, it } from "vitest";
import { createRegistry, type Arena } from "../../src/contracts";
import { fakeArena } from "../fake-arena";

// The registry (DESIGN.md row 42; ruling R21.g): the list of arenas a page or a
// script knows. It is built where arenas are imported, never in core.

const other: Arena = { ...fakeArena, id: "counters-2", title: "Counters again" } as Arena;

describe("createRegistry", () => {
  it("lists the ids in the order given and returns each arena by its id", () => {
    const registry = createRegistry([fakeArena, other]);
    expect(registry.ids()).toEqual(["counters", "counters-2"]);
    expect(registry.get("counters")).toBe(fakeArena);
    expect(registry.get("counters-2")).toBe(other);
  });

  it("throws on an unknown id, naming it", () => {
    const registry = createRegistry([fakeArena]);
    expect(() => registry.get("racing")).toThrow(/"racing"/);
    expect(() => registry.get("toString")).toThrow(/"toString"/);
  });

  it("refuses two arenas with the same id", () => {
    expect(() => createRegistry([fakeArena, other, { ...fakeArena } as Arena])).toThrow(/"counters"/);
  });

  it("hands out its own copy of the ids, and keeps its own copy of the list", () => {
    const entries: Arena[] = [fakeArena];
    const registry = createRegistry(entries);
    registry.ids().push("racing");
    entries.push(other);
    expect(registry.ids()).toEqual(["counters"]);
    expect(() => registry.get("counters-2")).toThrow();
  });

  it("holds arenas of different types side by side, as plain Arenas", () => {
    expectTypeOf(createRegistry).parameter(0).toEqualTypeOf<readonly Arena[]>();
    expectTypeOf(createRegistry([fakeArena]).get).returns.toEqualTypeOf<Arena>();
  });
});
