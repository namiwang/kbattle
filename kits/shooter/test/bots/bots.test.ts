import { BotKindSchema, DoerAnswerSchema } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import { makeBot } from "../../src/bots";
import { actionFromAnswers } from "../../src/sim/actions";
import { decideAll, enemy, obs, syntheticViews } from "./helpers";

// makeBot(kind, seed, slot) → DecisionProvider (sim rulings R8, R13): bots run
// through the same code path as prompted minds, answering in Clef's shape with
// crisp probabilities; each owns a private RNG derived from (seed, slot).

const KINDS = BotKindSchema.options;

describe("makeBot", () => {
  it("makes a DecisionProvider for each bot kind, whose decide returns a Promise", async () => {
    for (const kind of KINDS) {
      const bot = makeBot(kind, 1, 0);
      const pending = bot.decide({ tick: 1, agent: "a0", observation: obs(), plan: "", signal: new AbortController().signal });
      expect(pending).toBeInstanceOf(Promise);
      expect((await pending).model).toBe(`bot:${kind}`);
    }
  });

  it("every answer over 50 synthetic decisions validates as a DoerAnswer, crisp, never escalating", async () => {
    for (const kind of KINDS) {
      for (const seed of [1, 2, 3]) {
        for (const answer of await decideAll(makeBot(kind, seed, seed), syntheticViews(seed))) {
          expect(DoerAnswerSchema.parse(answer)).toEqual(answer);
          const { move, turn, fire, target, escalate } = answer.answers;
          for (const choice of [move, turn, target]) {
            if (choice) expect([choice.probabilities, choice.confidence]).toEqual([{ [choice.choice]: 1 }, 1]);
          }
          expect([0, 1]).toContain(fire?.noul);
          expect(escalate).toEqual({ type: "noul", noul: 0 });
        }
      }
    }
  });

  it("answers target only when someone is visible (ISSUES I-005), and its answers map to the intended action", async () => {
    const [alone, engaged] = await decideAll(makeBot("wanderer", 1, 0), [obs(), obs({}, { visible: [enemy("a4", 3)] })]);
    expect(alone!.answers.target).toBeUndefined();
    expect(actionFromAnswers(alone!.answers, [])).toEqual({ move: "forward", turn: "none", fire: false, target: null });
    expect(actionFromAnswers(engaged!.answers, ["a4"])).toEqual({
      move: "forward",
      turn: "face_target",
      fire: true,
      target: "a4",
    });
  });

  it("is deterministic: the same (kind, seed, slot) gives the same 50-answer stream", async () => {
    for (const kind of KINDS) {
      for (const seed of [1, 7, 42]) {
        const views = syntheticViews(seed);
        expect(await decideAll(makeBot(kind, seed, 3), views)).toEqual(await decideAll(makeBot(kind, seed, 3), views));
      }
    }
  });

  it("draws from its own RNG: another seed or another slot gives another stream", async () => {
    // Streams that make each bot draw often: the wanderer walking freely re-picks its heading
    // every 4 s; the camper hit at every decision picks a random other corner each time.
    const views = {
      wanderer: Array.from({ length: 50 }, (_, n) => obs({ pos: { x: 10 + ((2.5 * n) % 80), y: 50 } })),
      camper: Array.from({ length: 50 }, (_, n) => obs({ pos: { x: 6, y: 6 }, hp: 100 - 2 * n })),
    };
    for (const kind of KINDS) {
      const stream = (seed: number, slot: number) => decideAll(makeBot(kind, seed, slot), views[kind]);
      expect(await stream(5, 0), kind).not.toEqual(await stream(6, 0));
      expect(await stream(5, 0), kind).not.toEqual(await stream(5, 1));
    }
  });
});
