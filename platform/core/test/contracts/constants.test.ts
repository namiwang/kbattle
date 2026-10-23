import { describe, expect, it } from "vitest";
import * as contracts from "../../src/contracts";
import { checkAnswers, ESCALATE_QUESTION, MemorySchema, NoulQuestionSchema, PLAN_QUESTIONS, QuestionsSchema } from "../../src/contracts";

// The platform's own numbers and fixed questions (DESIGN.md rows 26, 39, 40, §5.3;
// ruling R21.e). TICK_MS, ESCALATE_THRESHOLD and TICK_MIN_WALL_MS stay in
// platform/core/src/constants.ts.

describe("DESIGN.md row 40 and R21.e: every platform constant exports its default", () => {
  it.each([
    ["ACTOR_INTERVAL_TICKS", 10],
    ["ACTOR_TIMEOUT_MS", 2000],
    ["PLANNER_MIN_GAP_TICKS", 100],
    ["PLANNER_MAX_GAP_TICKS", 400],
    ["PLANNER_TIMEOUT_MS", 20_000],
    ["MIN_AGENTS", 2],
    ["MAX_AGENTS", 16],
  ])("%s = %j", (name, value) => {
    expect(contracts).toHaveProperty(name, value);
  });
});

describe("invariants that later tuning must keep", () => {
  it("the planner's min gap is shorter than its max gap", () => {
    expect(contracts.PLANNER_MIN_GAP_TICKS).toBeLessThan(contracts.PLANNER_MAX_GAP_TICKS);
  });

  it("a match takes at least two agents and allows more than it requires", () => {
    expect(contracts.MIN_AGENTS).toBeGreaterThanOrEqual(2);
    expect(contracts.MAX_AGENTS).toBeGreaterThan(contracts.MIN_AGENTS);
  });
});

describe("ESCALATE_QUESTION: the platform's fixed actor question (§5.3)", () => {
  it("is a valid noul question with both sides of its criteria", () => {
    expect(NoulQuestionSchema.parse(ESCALATE_QUESTION)).toEqual(ESCALATE_QUESTION);
    expect(ESCALATE_QUESTION.criteria?.true).toBeTruthy();
    expect(ESCALATE_QUESTION.criteria?.false).toBeTruthy();
  });

  it("cannot be changed by whoever is handed it", () => {
    expect(Object.isFrozen(ESCALATE_QUESTION)).toBe(true);
    expect(Object.isFrozen(ESCALATE_QUESTION.criteria)).toBe(true);
  });
});

describe("PLAN_QUESTIONS: what the planner is asked (§5.3)", () => {
  it("is a valid question set of two text questions, plan and scratchpad", () => {
    expect(QuestionsSchema.parse(PLAN_QUESTIONS)).toEqual(PLAN_QUESTIONS);
    expect(Object.keys(PLAN_QUESTIONS)).toEqual(["plan", "scratchpad"]);
    expect([PLAN_QUESTIONS.plan?.type, PLAN_QUESTIONS.scratchpad?.type]).toEqual(["text", "text"]);
  });

  it("lets through exactly the answers that fit Memory: the longest plan and scratchpad pass, one more character does not", () => {
    const answer = (plan: number, scratchpad: number) => ({
      plan: { type: "text", text: "p".repeat(plan) },
      scratchpad: { type: "text", text: "s".repeat(scratchpad) },
    });
    const longest = checkAnswers(PLAN_QUESTIONS, answer(2000, 4000));
    expect(longest.ok).toBe(true);
    if (longest.ok) {
      const memory = { plan: longest.answers.plan?.type === "text" ? longest.answers.plan.text : "", scratchpad: "s".repeat(4000) };
      expect(MemorySchema.safeParse(memory).success).toBe(true);
    }
    expect(checkAnswers(PLAN_QUESTIONS, answer(2001, 0))).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid answer: plan\.text: /) });
    expect(checkAnswers(PLAN_QUESTIONS, answer(0, 4001))).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid answer: scratchpad\.text: /) });
  });

  it("cannot be changed by whoever is handed it", () => {
    expect(Object.isFrozen(PLAN_QUESTIONS)).toBe(true);
    expect(Object.isFrozen(PLAN_QUESTIONS.plan)).toBe(true);
    expect(Object.isFrozen(PLAN_QUESTIONS.scratchpad)).toBe(true);
  });
});
