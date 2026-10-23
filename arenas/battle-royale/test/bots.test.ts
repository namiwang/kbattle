import { checkAnswers, QUESTION_TYPES, type AskRequest, type Model, type Reply } from "@decision-arena/core";
import { BOT_KINDS, makeBot, type Observation } from "@decision-arena/kit-shooter";
import { describe, expect, it } from "vitest";
import { battleRoyale } from "../src";
import { decisionTick, enemy, obs, syntheticViews } from "./helpers";

// The arena's bots (DESIGN.md §5.3 "dummy", §13; rulings R13, R24): `bot/wanderer`
// and `bot/camper`, each a dummy Model over the kit's bot mind, seeded from
// (seed, slot) as before. A bot is asked once per actor interval while its agent
// is active, so its n-th call is the decision of tick 1 + n × interval, the tick
// its mind is told. Its choices must not change: they are the version-1 bot's.

const memory = { plan: "", scratchpad: "" };

/** What the loop asks a bot for one observation: the arena's questions only (no escalate for bots, R22.d). */
const request = (observation: Observation): AskRequest => ({
  state: { observation, plan: "" },
  questions: battleRoyale.questions(observation, memory),
  signal: new AbortController().signal,
});

/** Asks `model` once per observation, in order, as the loop would; returns the replies. */
async function askAll(model: Model, views: readonly Observation[]): Promise<Reply[]> {
  const replies: Reply[] = [];
  for (const view of views) replies.push(await model.ask(request(view)));
  return replies;
}

const answersOf = (reply: Reply) => {
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.answers;
};

describe("battleRoyale.bots (R24)", () => {
  it("are the kit's bots, by name", () => {
    expect(Object.keys(battleRoyale.bots)).toEqual([...BOT_KINDS]);
  });

  it.each(BOT_KINDS)("bot/%s is a dummy Model named by its catalog id, answering every question type", async (kind) => {
    const model = battleRoyale.bots[kind]!(1, 0);
    expect(model.id).toBe(`bot/${kind}`);
    expect([...model.supports]).toEqual([...QUESTION_TYPES]);
    const reply = await model.ask(request(obs()));
    expect(reply).toMatchObject({ ok: true, model: `bot/${kind}` });
    if (reply.ok) expect(reply.usage.inputTokens).toBeGreaterThan(0); // estimated at 4 characters per token, logged like any call
  });

  it("choose what the version-1 bots chose, decision for decision, for the same (seed, slot) and observations", async () => {
    for (const kind of BOT_KINDS) {
      for (const [seed, slot] of [
        [1, 0],
        [7, 3],
        [42, 15],
      ] as const) {
        const views = syntheticViews(seed + slot);
        const v2 = await askAll(battleRoyale.bots[kind]!(seed, slot), views);
        const v1 = makeBot(kind, seed, slot);
        for (const [n, view] of views.entries()) {
          const { escalate, ...v1Answers } = (await v1.decide({ tick: decisionTick(n), agent: `a${slot}`, observation: view, plan: "", signal: new AbortController().signal })).answers;
          expect(escalate).toEqual({ type: "noul", noul: 0 }); // version 1 answered it; bots are no longer asked it
          expect(answersOf(v2[n]!), `${kind} ${seed}/${slot} decision ${n}`).toEqual(v1Answers);
        }
      }
    }
  });

  it("answer the arena's questions as the loop checks them: crisp choices, fire 0 or 1, target only when someone is visible", async () => {
    for (const kind of BOT_KINDS) {
      const views = syntheticViews(3);
      for (const [n, reply] of (await askAll(battleRoyale.bots[kind]!(3, 1), views)).entries()) {
        const view = views[n]!;
        const answers = answersOf(reply);
        expect(checkAnswers(request(view).questions, answers)).toEqual({ ok: true, answers });
        if (view.visible.length === 0) expect(answers).not.toHaveProperty("target");
        const fire = answers.fire;
        expect(fire?.type === "noul" && (fire.noul === 0 || fire.noul === 1)).toBe(true);
        for (const id of ["move", "turn", "target"]) {
          const answer = answers[id];
          if (answer?.type === "choice") expect([answer.probabilities, answer.confidence]).toEqual([{ [answer.choice]: 1 }, 1]);
        }
      }
    }
  });

  it("act as the version-1 bots: face and fire at the nearest enemy, through actionFrom", async () => {
    const engaged = obs({}, { visible: [enemy("a4", 3)] });
    const [alone, seen] = await askAll(battleRoyale.bots.wanderer!(1, 0), [obs(), engaged]);
    expect(battleRoyale.actionFrom(answersOf(alone!), obs(), undefined)).toEqual({ move: "forward", turn: "none", fire: false, target: null });
    expect(battleRoyale.actionFrom(answersOf(seen!), engaged, undefined)).toEqual({ move: "forward", turn: "face_target", fire: true, target: "a4" });
  });

  it("are deterministic per (seed, slot), fresh for each slot, and differ across seeds and slots", async () => {
    const views = {
      wanderer: Array.from({ length: 50 }, (_, n) => obs({ pos: { x: 10 + ((2.5 * n) % 80), y: 50 } })),
      camper: Array.from({ length: 50 }, (_, n) => obs({ pos: { x: 6, y: 6 }, hp: 100 - 2 * n })),
    };
    for (const kind of BOT_KINDS) {
      const stream = async (seed: number, slot: number) => (await askAll(battleRoyale.bots[kind]!(seed, slot), views[kind])).map(answersOf);
      expect(await stream(5, 0)).toEqual(await stream(5, 0));
      expect(await stream(5, 0), kind).not.toEqual(await stream(6, 0));
      expect(await stream(5, 0), kind).not.toEqual(await stream(5, 1));
    }
  });

  it("refuse a request without an observation (a loop that is not the platform's)", async () => {
    await expect(battleRoyale.bots.camper!(1, 0).ask({ state: { plan: "" }, questions: request(obs()).questions, signal: new AbortController().signal })).rejects.toThrow(
      /observation/,
    );
  });
});
