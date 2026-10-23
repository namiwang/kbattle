import { checkAnswers, MemorySchema, QuestionsSchema, type Answers } from "@decision-arena/core";
import { FIRE_THRESHOLD, MOVE_CHOICES, STOP_ACTION, TURN_CHOICES } from "@decision-arena/kit-shooter";
import { describe, expect, it } from "vitest";
import { battleRoyale, DEFAULTS, MOVE_CRITERIA, NO_TARGET, TURN_CRITERIA } from "../src";
import { enemy, obs } from "./helpers";

// The actor's questions and how its answers become an action (DESIGN.md §13
// "What this arena owns", §5.3; rulings R9, R24; ISSUES I-005): move, turn and
// fire always, target only when someone is visible, with fixed criteria and the
// arena's default instructions (the loop puts the player's in); the answers
// become the kit's Action through actionFromAnswers over what the agent sees.

const memory = { plan: "", scratchpad: "" };
const SEEING = obs({ pos: { x: 22.5, y: 61 }, facing: -30, hp: 72 }, { visible: [enemy("a3", -12, 38, true), enemy("a7", 20, 51)] });
const BLIND = obs();

const choice = (pick: string) => ({ type: "choice" as const, choice: pick, probabilities: { [pick]: 1 }, confidence: 1 });
const noul = (p: number) => ({ type: "noul" as const, noul: p });

describe("battleRoyale.questions (R24)", () => {
  it("asks move and turn over every fixed option with the fixed criteria, and fire, with the default instructions", () => {
    const q = battleRoyale.questions(SEEING, memory);
    expect(q.move).toEqual({ type: "choice", instructions: DEFAULTS.actor.move, criteria: MOVE_CRITERIA });
    expect(q.turn).toEqual({ type: "choice", instructions: DEFAULTS.actor.turn, criteria: TURN_CRITERIA });
    expect(q.fire).toEqual({ type: "noul", instructions: DEFAULTS.actor.fire });
    expect(Object.keys(MOVE_CRITERIA)).toEqual([...MOVE_CHOICES]);
    expect(Object.keys(TURN_CRITERIA)).toEqual([...TURN_CHOICES]);
  });

  it("asks target over the visible enemies, nearest first, then none, each described", () => {
    const q = battleRoyale.questions(SEEING, memory);
    expect(q.target).toEqual({
      type: "choice",
      instructions: DEFAULTS.actor.target,
      criteria: {
        a3: "the enemy at bearing -12°, 38 m away, moving",
        a7: "the enemy at bearing 20°, 51 m away",
        none: NO_TARGET,
      },
    });
    expect(Object.keys(q)).toEqual(["move", "turn", "fire", "target"]);
  });

  it("leaves target out when nobody is visible: one option is not a choice (ISSUES I-005)", () => {
    const q = battleRoyale.questions(BLIND, memory);
    expect(q).not.toHaveProperty("target");
    expect(Object.keys(q)).toEqual(["move", "turn", "fire"]);
  });

  it("never asks escalate, the platform's own question", () => {
    expect(battleRoyale.questions(SEEING, memory)).not.toHaveProperty("escalate");
  });

  it("builds questions the platform's schema accepts, with and without a target", () => {
    expect(QuestionsSchema.parse(battleRoyale.questions(SEEING, memory))).toEqual(battleRoyale.questions(SEEING, memory));
    expect(QuestionsSchema.safeParse(battleRoyale.questions(BLIND, memory)).success).toBe(true);
  });

  it("states what a decision of each move and turn does, from the kit's speeds: 2.5 m and 90° per decision", () => {
    expect(MOVE_CRITERIA.forward).toBe("walk straight ahead, the way you face (2.5 m per decision)");
    expect(TURN_CRITERIA.left).toBe("turn left, toward negative bearings (90° per decision)");
    expect(TURN_CRITERIA.right).toBe("turn right, toward positive bearings (90° per decision)");
    expect(TURN_CRITERIA.face_target).toBe("turn toward the target you pick; with no target, keep facing the same way");
  });

  it("keeps every fixed text within the question limits and freezes the criteria", () => {
    for (const text of [...Object.values(MOVE_CRITERIA), ...Object.values(TURN_CRITERIA), NO_TARGET, ...Object.values(DEFAULTS.actor)]) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(500);
    }
    expect([Object.isFrozen(MOVE_CRITERIA), Object.isFrozen(TURN_CRITERIA), Object.isFrozen(DEFAULTS), Object.isFrozen(DEFAULTS.actor)]).toEqual([true, true, true, true]);
  });
});

describe("battleRoyale.defaults: what a player starts from (R21.c, R24)", () => {
  it("are the page's current default prompts: the thinker prompt as the planner's, one instruction per actor question", () => {
    expect(DEFAULTS.planner).toBe(
      "Play to survive first and to win second. Keep moving between pieces of cover and pick your fights: " +
        "shoot enemies you see before they see you, and break line of sight when you are hit from a direction " +
        "you cannot see. Below 40 HP, stop chasing and hide behind cover until the field thins out. " +
        "Write each plan as one or two short orders for the doer: where to go, whom to shoot, when to back off.",
    );
    expect(DEFAULTS.actor).toEqual({
      move:
        "Follow the plan. Move toward cover or the place the plan names; back off when you take fire you " +
        "cannot answer; stop when an enemy is in range to shoot.",
      turn: "Face your target when you have one. Otherwise turn toward incoming fire, then toward the last shot or footsteps you heard.",
      fire: "Fire when your target is visible, close to straight ahead, and within about 40 m.",
      target: "The closest visible enemy, unless the plan names another; none when the plan says to avoid fights.",
    });
    expect(battleRoyale.defaults).toBe(DEFAULTS);
  });

  it("has a fixed plan for an agent without a planner, within the plan's limit", () => {
    expect(DEFAULTS.fixedPlan.trim().length).toBeGreaterThan(0);
    expect(MemorySchema.safeParse({ plan: DEFAULTS.fixedPlan, scratchpad: "" }).success).toBe(true);
  });
});

describe("battleRoyale.actionFrom: answers to the kit's Action (R9)", () => {
  /** The answers as the loop hands them over: checked against the questions asked. */
  const checked = (questions: ReturnType<typeof battleRoyale.questions>, raw: Answers): Answers => {
    const result = checkAnswers(questions, raw);
    if (!result.ok) throw new Error(result.error);
    return result.answers;
  };

  it("maps each answer to its action field, targeting a visible enemy", () => {
    const answers = checked(battleRoyale.questions(SEEING, memory), { move: choice("forward"), turn: choice("face_target"), fire: noul(0.8), target: choice("a7") });
    expect(battleRoyale.actionFrom(answers, SEEING, undefined)).toEqual({ move: "forward", turn: "face_target", fire: true, target: "a7" });
  });

  it("fires at P(yes) ≥ FIRE_THRESHOLD", () => {
    expect(FIRE_THRESHOLD).toBe(0.5);
    expect(battleRoyale.actionFrom({ fire: noul(0.5) }, BLIND, undefined).fire).toBe(true);
    expect(battleRoyale.actionFrom({ fire: noul(0.4999) }, BLIND, undefined).fire).toBe(false);
  });

  it("never keeps the previous action: a missing answer is stop, none, hold fire, no target", () => {
    const previous = { move: "forward" as const, turn: "left" as const, fire: true, target: "a3" };
    expect(battleRoyale.actionFrom({}, SEEING, previous)).toEqual(STOP_ACTION);
    expect(battleRoyale.actionFrom({ fire: noul(1) }, SEEING, previous)).toEqual({ move: "stop", turn: "none", fire: true, target: null });
  });

  it("targets only an enemy it sees; face_target without one is none", () => {
    expect(battleRoyale.actionFrom({ turn: choice("face_target"), target: choice("a9") }, SEEING, undefined)).toEqual({ ...STOP_ACTION, turn: "none" });
    expect(battleRoyale.actionFrom({ turn: choice("face_target"), target: choice("none") }, SEEING, undefined).turn).toBe("none");
  });

  it("reads only answers of the right type, and ignores escalate", () => {
    const odd: Answers = { move: noul(1), turn: { type: "text", text: "left" }, fire: choice("yes"), escalate: noul(1) };
    expect(battleRoyale.actionFrom(odd, BLIND, undefined)).toEqual(STOP_ACTION);
  });

  it("returns a fresh object", () => {
    const action = battleRoyale.actionFrom({}, BLIND, undefined);
    expect(action).not.toBe(STOP_ACTION);
    expect(Object.isFrozen(action)).toBe(false);
  });
});
