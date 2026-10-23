import type { DoerAnswers } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import { FIRE_THRESHOLD } from "../../src/constants";
import { actionFromAnswers, type ActionAnswers } from "../../src/sim/actions";
import { STOP_ACTION } from "../../src/types";

// R9: doer answers → the Action the sim applies until the next answer.

const choice = <T extends string>(pick: T) => ({
  type: "choice" as const,
  choice: pick,
  probabilities: { [pick]: 1 },
  confidence: 1,
});
const noul = (p: number) => ({ type: "noul" as const, noul: p });

const full: DoerAnswers = {
  move: choice("forward"),
  turn: choice("face_target"),
  fire: noul(0.8),
  target: choice("a3"),
  escalate: noul(0.9),
};

describe("actionFromAnswers", () => {
  it("maps each answer to its action field", () => {
    expect(actionFromAnswers(full, ["a3", "a5"])).toEqual({
      move: "forward",
      turn: "face_target",
      fire: true,
      target: "a3",
    });
  });

  it("fires at noul ≥ FIRE_THRESHOLD (row 25)", () => {
    expect(FIRE_THRESHOLD).toBe(0.5);
    expect(actionFromAnswers({ fire: noul(0.5) }, []).fire).toBe(true);
    expect(actionFromAnswers({ fire: noul(0.4999) }, []).fire).toBe(false);
    expect(actionFromAnswers({}, []).fire).toBe(false);
  });

  it("does not keep previous values: a missing move is stop, a missing turn is none", () => {
    expect(actionFromAnswers({ fire: noul(1) }, [])).toEqual({ move: "stop", turn: "none", fire: true, target: null });
    expect(actionFromAnswers({}, [])).toEqual(STOP_ACTION);
  });

  it("treats an unknown move or turn like a missing one", () => {
    const odd = { move: choice("jump"), turn: choice("spin") } as unknown as DoerAnswers;
    expect(actionFromAnswers(odd, [])).toEqual(STOP_ACTION);
  });

  it("targets only a visible id; none, a hidden id or no answer give null", () => {
    expect(actionFromAnswers({ target: choice("a5") }, ["a3", "a5"]).target).toBe("a5");
    expect(actionFromAnswers({ target: choice("none") }, ["a3"]).target).toBeNull();
    expect(actionFromAnswers({ target: choice("a7") }, ["a3"]).target).toBeNull();
    expect(actionFromAnswers({ target: choice("none") }, ["none"]).target).toBeNull();
    expect(actionFromAnswers({}, ["a3"]).target).toBeNull();
  });

  it("face_target without a target means none (§5.4)", () => {
    expect(actionFromAnswers({ turn: choice("face_target") }, ["a3"]).turn).toBe("none");
    expect(actionFromAnswers({ turn: choice("face_target"), target: choice("a9") }, ["a3"]).turn).toBe("none");
  });

  it("ignores escalate: that is the brain's business", () => {
    const { move, turn, fire, target } = full;
    expect(actionFromAnswers(full, ["a3"])).toEqual(actionFromAnswers({ move, turn, fire, target }, ["a3"]));
    expect(actionFromAnswers({ escalate: noul(1) }, [])).toEqual(STOP_ACTION);
  });

  it("reads only the picks and the P(yes) it needs, from any answers of that shape (ActionAnswers, R0.4)", () => {
    // The battle royale arena hands it version-2 answers, the kit's legacy loop version-1 DoerAnswers.
    const answers: ActionAnswers = { move: { choice: "left" }, turn: { choice: "face_target" }, fire: { noul: 0.6 }, target: { choice: "a2" } };
    expect(actionFromAnswers(answers, ["a2"])).toEqual({ move: "left", turn: "face_target", fire: true, target: "a2" });
    expect(actionFromAnswers(full satisfies ActionAnswers, ["a3"])).toEqual({ move: "forward", turn: "face_target", fire: true, target: "a3" });
  });

  it("returns a fresh object, never the frozen STOP_ACTION", () => {
    const action = actionFromAnswers({}, []);
    expect(action).not.toBe(STOP_ACTION);
    expect(Object.isFrozen(action)).toBe(false);
  });
});
