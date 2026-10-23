// Questions and answers (DESIGN.md §5.3; ruling R21.a): the one shape every
// model is asked in, whatever the arena, and the check the match loop runs on
// what comes back (v1's ruling R16, generalized from the doer's fixed questions).
//
// Strictness: unknown keys are dropped on parse, never rejected. Questions are
// logged and answers come from third parties (Clef, a chat model), so a harmless
// extra key must not fault a call or make an older viewer refuse a newer log
// (ISSUES I-009). Each type is z.infer of its schema and declared nowhere else.

// Namespace import on purpose: `import { z }` keeps every zod locale in a bundle
// (measured for v1: a Worker importing the schemas, 464 KiB minified vs 110 KiB).
import * as z from "zod";
import { roundTo } from "../sim/round";

/** A question's key in a question set: lower snake case, 1 to 64 characters ("step", "turn_to"). */
export const QuestionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
export type QuestionId = z.infer<typeof QuestionIdSchema>;

/** What the model is told about one question: never empty (Clef), at most 500 characters. */
const Instructions = z.string().min(1).max(500);
const Probability = z.number().min(0).max(1);

/** Pick one option: option id → what it means. Clef takes 2 to 255 options (ISSUES I-005). */
export const ChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: Instructions,
  criteria: z.record(z.string(), z.string()).refine(
    (criteria) => {
      const n = Object.keys(criteria).length;
      return n >= 2 && n <= 255;
    },
    { message: "a choice question needs 2 to 255 options" },
  ),
});
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;

/** A yes/no question; the answer is P(yes). `criteria` says what yes and no mean. */
export const NoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: Instructions,
  criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
});
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;

/** Free text of at most `maxChars` characters (the planner's plan and scratchpad). Decision models answer no text. */
export const TextQuestionSchema = z.object({
  type: z.literal("text"),
  instructions: Instructions,
  maxChars: z.number().int().min(1).max(8000),
});
export type TextQuestion = z.infer<typeof TextQuestionSchema>;

export const QuestionSchema = z.discriminatedUnion("type", [ChoiceQuestionSchema, NoulQuestionSchema, TextQuestionSchema]);
export type Question = z.infer<typeof QuestionSchema>;

/** The question types, for a model's `supports` (DESIGN.md row 39). */
export const QUESTION_TYPES = Object.freeze(["choice", "noul", "text"] as const);
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** One call's questions by id; at least one. */
export const QuestionsSchema = z
  .record(QuestionIdSchema, QuestionSchema)
  .refine((questions) => Object.keys(questions).length > 0, { message: "ask at least one question" });
export type Questions = z.infer<typeof QuestionsSchema>;

/** The pick, a probability per option (all of them from Clef, the pick alone from a chat model) and a confidence. */
export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), Probability),
  confidence: Probability,
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

/** P(yes). */
export const NoulAnswerSchema = z.object({ type: z.literal("noul"), noul: Probability });
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;

export const TextAnswerSchema = z.object({ type: z.literal("text"), text: z.string() });
export type TextAnswer = z.infer<typeof TextAnswerSchema>;

export const AnswerSchema = z.discriminatedUnion("type", [ChoiceAnswerSchema, NoulAnswerSchema, TextAnswerSchema]);
export type Answer = z.infer<typeof AnswerSchema>;

/** Answers by question id. Any may be missing: what a missing answer means is the arena's call (v1 ruling R9). */
export const AnswersSchema = z.record(QuestionIdSchema, AnswerSchema);
export type Answers = z.infer<typeof AnswersSchema>;

export type CheckedAnswers = { ok: true; answers: Answers } | { ok: false; error: string };

const ANSWER_SCHEMAS = { choice: ChoiceAnswerSchema, noul: NoulAnswerSchema, text: TextAnswerSchema } as const;
const AnyRecord = z.record(z.string(), z.unknown());

/**
 * A model's answers checked against the questions it was asked, as the match loop
 * logs and acts on them. Numbers in probabilities, confidence and P(yes) are
 * rounded to 4 decimals first, so the log, the action and a replay all read the
 * same numbers (ISSUES I-018). Each answer must have its question's type; a pick
 * and every option it gives a probability for must be among the question's
 * criteria; text must fit maxChars. Answers to questions not asked are dropped and
 * a missing answer is fine. The answers come back in the questions' order, with
 * unknown keys dropped; `raw` is not changed. A failure is the first problem as
 * `invalid answer: <path>: <message>`.
 */
export function checkAnswers(questions: Questions, raw: unknown): CheckedAnswers {
  const given = AnyRecord.safeParse(raw);
  if (!given.success) return invalid([], given.error);
  const answers: Answers = {};
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(given.data, id)) continue;
    const parsed = ANSWER_SCHEMAS[question.type].safeParse(rounded(given.data[id]));
    if (!parsed.success) return invalid([id], parsed.error);
    const answer: Answer = parsed.data;
    const problem = misfit(question, answer);
    if (problem) return { ok: false, error: `invalid answer: ${[id, ...problem.path].join(".")}: ${problem.message}` };
    answers[id] = answer;
  }
  return { ok: true, answers };
}

/** Where an answer that parses does not fit its question, or null when it fits. */
function misfit(question: Question, answer: Answer): { path: string[]; message: string } | null {
  if (question.type === "choice" && answer.type === "choice") {
    const isOption = (option: string) => Object.hasOwn(question.criteria, option);
    const notAnOption = (option: string) => `Invalid option: ${JSON.stringify(option)} is not one of the question's criteria`;
    if (!isOption(answer.choice)) return { path: ["choice"], message: notAnOption(answer.choice) };
    for (const option of Object.keys(answer.probabilities)) {
      if (!isOption(option)) return { path: ["probabilities", option], message: notAnOption(option) };
    }
  }
  if (question.type === "text" && answer.type === "text" && answer.text.length > question.maxChars) {
    return { path: ["text"], message: `Too big: expected string to have <=${question.maxChars} characters` };
  }
  return null;
}

/** A copy of one answer with its probabilities, confidence and P(yes) rounded to 4 decimals; anything else as it was, for the schema to judge. */
function rounded(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null) return answer;
  const round = (value: unknown) => (typeof value === "number" ? roundTo(value, 4) : value);
  const copy: Record<string, unknown> = { ...answer };
  if ("confidence" in copy) copy.confidence = round(copy.confidence);
  if ("noul" in copy) copy.noul = round(copy.noul);
  const { probabilities } = copy;
  if (typeof probabilities === "object" && probabilities !== null) {
    copy.probabilities = Object.fromEntries(Array.from(Object.entries(probabilities), ([option, p]: [string, unknown]) => [option, round(p)]));
  }
  return copy;
}

/** A failed check: the zod error's first issue, its path under `prefix` dotted ("answers" for the whole value). */
function invalid(prefix: string[], error: z.ZodError): CheckedAnswers {
  const issue = error.issues[0];
  const path = [...prefix, ...Array.from(issue?.path ?? [], (key) => String(key))];
  return { ok: false, error: `invalid answer: ${path.length > 0 ? path.join(".") : "answers"}: ${issue?.message ?? "rejected"}` };
}
