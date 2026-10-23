import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AgentIdSchema,
  AgentSpecSchema,
  botSpec,
  MemorySchema,
  RoleSchema,
  type AgentSpec,
  type Memory,
  type Role,
} from "../../src/contracts";
import { issuePaths, roundTrip, without } from "./helpers";

// What a player authors for one arena (DESIGN.md §5.4, rows 39 and 41; ruling
// R21.d): models in their roles plus the player's words. Validated where it
// enters: the form, a file, a log.

const spec = {
  arena: "counters",
  roles: { actor: { model: "workers-ai/@cf/cloudflare/clef-flash" }, planner: { model: "anthropic/claude-haiku-5-5" } },
  prompts: { planner: "Climb early, then hold.", actor: { step: "Go up unless the plan says otherwise." } },
};

describe("AgentSpec", () => {
  it("parses an agent with an actor and a planner and round-trips", () => {
    expect(roundTrip(AgentSpecSchema, spec)).toEqual(spec);
  });

  it("accepts an actor-only agent, blank prompts and the length limits", () => {
    const actorOnly = { ...spec, roles: { actor: spec.roles.actor } };
    expect(issuePaths(AgentSpecSchema, actorOnly)).toEqual([]);
    expect(issuePaths(AgentSpecSchema, { ...spec, prompts: { planner: "", actor: {} } })).toEqual([]);
    const longest = { planner: "x".repeat(8000), actor: { step: "x".repeat(500) } };
    expect(issuePaths(AgentSpecSchema, { ...spec, prompts: longest })).toEqual([]);
  });

  it.each([
    ["an empty arena id", { ...spec, arena: "" }, ["arena"]],
    ["no actor", { ...spec, roles: { planner: spec.roles.planner } }, ["roles", "actor"]],
    ["an empty actor model id", { ...spec, roles: { actor: { model: "" } } }, ["roles", "actor", "model"]],
    ["an empty planner model id", { ...spec, roles: { ...spec.roles, planner: { model: "" } } }, ["roles", "planner", "model"]],
    ["a planner prompt over 8000 characters", { ...spec, prompts: { ...spec.prompts, planner: "x".repeat(8001) } }, ["prompts", "planner"]],
    ["an actor instruction over 500 characters", { ...spec, prompts: { ...spec.prompts, actor: { step: "x".repeat(501) } } }, ["prompts", "actor", "step"]],
    ["an instruction for a key that is not a QuestionId", { ...spec, prompts: { ...spec.prompts, actor: { Step: "x" } } }, ["prompts", "actor", "Step"]],
    ["no prompts", without(spec, "prompts"), ["prompts"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(AgentSpecSchema, value)).toContainEqual(path);
  });

  it("drops an unknown field instead of rejecting it (a newer file in an older viewer)", () => {
    expect(AgentSpecSchema.parse({ ...spec, name: "Climber" })).toEqual(spec);
  });
});

describe("botSpec: a bot slot is an agent whose actor is the bot (R21.d)", () => {
  it("names the bot as the actor model bot/<name>, with no planner and blank prompts", () => {
    expect(botSpec("counters", "upper")).toEqual({
      arena: "counters",
      roles: { actor: { model: "bot/upper" } },
      prompts: { planner: "", actor: {} },
    });
  });

  it("is a valid AgentSpec as it is", () => {
    const bot = botSpec("battle-royale", "wanderer");
    expect(AgentSpecSchema.parse(bot)).toEqual(bot);
  });
});

describe("Memory: the plan and the scratchpad (principle 6; the v1 Plan limits)", () => {
  it("parses empty memory and the limits, 2000 and 4000 characters", () => {
    expect(roundTrip(MemorySchema, { plan: "", scratchpad: "" })).toEqual({ plan: "", scratchpad: "" });
    expect(issuePaths(MemorySchema, { plan: "x".repeat(2000), scratchpad: "x".repeat(4000) })).toEqual([]);
  });

  it.each([
    ["a plan over 2000 characters", { plan: "x".repeat(2001), scratchpad: "" }, ["plan"]],
    ["a scratchpad over 4000 characters", { plan: "", scratchpad: "x".repeat(4001) }, ["scratchpad"]],
    ["a missing scratchpad", { plan: "Go up." }, ["scratchpad"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(MemorySchema, value)).toContainEqual(path);
  });
});

describe("Role and AgentId", () => {
  it("has two roles, the actor and the planner (row 39)", () => {
    expect(RoleSchema.options).toEqual(["actor", "planner"]);
    expect(issuePaths(RoleSchema, "thinker")).toEqual([[]]);
    expectTypeOf<Role>().toEqualTypeOf<"actor" | "planner">();
  });

  it("an agent id is a non-empty string", () => {
    expect(issuePaths(AgentIdSchema, "a0")).toEqual([]);
    expect(issuePaths(AgentIdSchema, "")).toEqual([[]]);
  });

  it("infers the spec's shape", () => {
    expectTypeOf<AgentSpec["roles"]["planner"]>().toEqualTypeOf<{ model: string } | undefined>();
    expectTypeOf<AgentSpec["prompts"]["actor"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<Memory>().toEqualTypeOf<{ plan: string; scratchpad: string }>();
  });
});
