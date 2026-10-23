// The battle royale's bots as Models (DESIGN.md §5.3 "dummy", §13 Bots; rulings
// R13, R24): each is a dummy over the kit's bot mind, seeded from (seed, slot) as
// before, answering the arena's questions with crisp answers.
//
// A Model is not told the tick, but a bot's mind needs it (how far it should have
// walked since its last decision; when the wanderer picks a new heading). The
// platform asks every active agent on every actor-due tick, ticks 1, 1 + I,
// 1 + 2I, … for the arena's interval I (R22.c), and an agent stays active from
// tick 1 until it dies, so a bot's n-th call (from 0) is the decision of tick
// 1 + n × I: the tick the version-1 loop gave its mind (ISSUES I-034).

import { dummyModel, type Answers, type Model } from "@decision-arena/core";
import { makeBotMind, type BotIntent, type BotKind, type Observation } from "@decision-arena/kit-shooter";

/** A fresh `bot/<kind>` for one agent, deciding every `interval` ticks from tick 1. */
export function botModel(kind: BotKind, seed: number, slot: number, interval: number): Model {
  const mind = makeBotMind(kind, seed, slot);
  let decisions = 0;
  return dummyModel(`bot/${kind}`, (req) => {
    const tick = 1 + interval * decisions++;
    return botAnswers(mind.decide(tick, observationIn(req.state)));
  });
}

/**
 * The intent as answers to the arena's questions: each choice crisp
 * (probability 1, confidence 1), fire 0 or 1, and target only when there is one,
 * as the target question is asked only when someone is visible (ISSUES I-005).
 * The version-1 bots also answered escalate 0; bots are no longer asked it (R22.d).
 */
export function botAnswers(intent: BotIntent): Answers {
  const answers: Answers = { move: crisp(intent.move), turn: crisp(intent.turn), fire: { type: "noul", noul: intent.fire ? 1 : 0 } };
  if (intent.target !== null) answers.target = crisp(intent.target);
  return answers;
}

function crisp(choice: string) {
  return { type: "choice" as const, choice, probabilities: { [choice]: 1 }, confidence: 1 };
}

/** The observation in an actor's state ({ observation, plan }, R22.d); a bot answers nothing else. */
function observationIn(state: unknown): Observation {
  const observation = typeof state === "object" && state !== null ? (state as { observation?: unknown }).observation : undefined;
  if (typeof observation !== "object" || observation === null) throw new Error("a bot needs the actor's state: { observation, plan }");
  return observation as Observation;
}
