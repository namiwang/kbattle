import { BotKindSchema, DoerAnswerSchema } from "@decision-arena/core/legacy";
import { describe, expect, it } from "vitest";
import { BOT_KINDS, makeBot, makeBotMind } from "../../src/bots";
import { actionFromAnswers } from "../../src/sim/actions";
import { decideAll, decisionTick, enemy, obs, picks, syntheticViews } from "./helpers";

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

// R0.4: one implementation behind the version-1 DecisionProvider (the kit's legacy
// loop, until R0.5) and the battle royale arena's bot Models: the mind decides,
// each adapter only words the intent.
describe("makeBotMind", () => {
  it("BOT_KINDS name the bots, as the version-1 BotKind does", () => {
    expect(BOT_KINDS).toEqual(["wanderer", "camper"]);
    expect(BOT_KINDS).toEqual(KINDS);
    expect(Object.isFrozen(BOT_KINDS)).toBe(true);
  });

  it("decides what makeBot answers, decision for decision, given the same (seed, slot) and observations", async () => {
    for (const kind of BOT_KINDS) {
      for (const seed of [1, 2, 7]) {
        const views = syntheticViews(seed);
        const mind = makeBotMind(kind, seed, 4);
        const intents = views.map((view, n) => mind.decide(decisionTick(n), view));
        const answers = await decideAll(makeBot(kind, seed, 4), views);
        expect(intents.map((i) => ({ move: i.move, turn: i.turn, fire: i.fire ? 1 : 0, target: i.target ?? undefined }))).toEqual(answers.map(picks));
      }
    }
  });

  it("a fresh mind per slot: two minds of the same (kind, seed, slot) decide alike, whatever the other was asked", () => {
    const views = syntheticViews(9);
    const first = makeBotMind("wanderer", 9, 2);
    first.decide(decisionTick(0), views[0]!);
    const a = makeBotMind("wanderer", 9, 2);
    const b = makeBotMind("wanderer", 9, 2);
    expect(views.map((view, n) => a.decide(decisionTick(n), view))).toEqual(views.map((view, n) => b.decide(decisionTick(n), view)));
  });
});
