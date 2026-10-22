import { DoerAnswerSchema, type DecideRequest, type DoerAnswer } from "@decision-arena/core";

/**
 * The doer's stand-in until Clef is wired in (v0.5): one answer per question
 * asked. A choice picks its first option with probability 1 (the rest 0,
 * confidence 1); a noul answers 0, so it never fires and never escalates.
 * Built from the questions' types and parsed by DoerAnswerSchema, so the shape
 * is the schema's, the one Clef's response must also pass.
 */
export function mockAnswer(request: DecideRequest): DoerAnswer {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question === undefined) continue;
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: 0 };
    } else {
      const options = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(options.map((option, i) => [option, i === 0 ? 1 : 0]));
      answers[id] = { type: "choice", choice: options[0], probabilities, confidence: 1 };
    }
  }
  return DoerAnswerSchema.parse({ model: "mock", answers, usage: { input_tokens: 0, output_tokens: 0 } });
}
