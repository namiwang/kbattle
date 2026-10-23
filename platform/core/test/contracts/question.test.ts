import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AnswerSchema,
  AnswersSchema,
  checkAnswers,
  ChoiceAnswerSchema,
  ChoiceQuestionSchema,
  NoulAnswerSchema,
  NoulQuestionSchema,
  QUESTION_TYPES,
  QuestionIdSchema,
  QuestionSchema,
  QuestionsSchema,
  TextAnswerSchema,
  TextQuestionSchema,
  type Answer,
  type Answers,
  type Question,
  type QuestionType,
  type Questions,
} from "../../src/contracts";
import { issuePaths, roundTrip, without } from "./helpers";

// Questions and answers (DESIGN.md §5.3; ruling R21.a): the one shape every model
// is asked in, and the loop's check of what comes back (R16 generalized).

const step = { type: "choice", instructions: "Pick a direction.", criteria: { up: "Add one.", down: "Take one." } } as const;
const ready = { type: "noul", instructions: "Are you ready?", criteria: { true: "Ready.", false: "Not yet." } } as const;
const note = { type: "text", instructions: "Write a short note.", maxChars: 20 } as const;
const questions: Questions = { step, ready, note };

const stepAnswer = { type: "choice", choice: "up", probabilities: { up: 0.75, down: 0.25 }, confidence: 0.75 } as const;
const readyAnswer = { type: "noul", noul: 0.9 } as const;
const noteAnswer = { type: "text", text: "Climb." } as const;
const answers: Answers = { step: stepAnswer, ready: readyAnswer, note: noteAnswer };

/** n options named o0, o1, … */
const options = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, "An option."]));

describe("QuestionId: a question's key", () => {
  it.each(["step", "turn_to", "a1", "x".repeat(64)])("accepts %j", (id) => {
    expect(issuePaths(QuestionIdSchema, id)).toEqual([]);
  });

  it.each([
    ["an empty id", ""],
    ["65 characters", "x".repeat(65)],
    ["an upper-case letter", "Step"],
    ["a leading digit", "1st"],
    ["a leading underscore", "_step"],
    ["a hyphen", "turn-to"],
  ])("rejects %s", (_name, id) => {
    expect(issuePaths(QuestionIdSchema, id)).toContainEqual([]);
  });
});

describe("ChoiceQuestion: pick one of 2 to 255 options (ISSUES I-005)", () => {
  it("parses and round-trips", () => {
    expect(roundTrip(ChoiceQuestionSchema, step)).toEqual(step);
  });

  it("accepts 2 and 255 options and 500-character instructions", () => {
    expect(issuePaths(ChoiceQuestionSchema, { ...step, criteria: options(2) })).toEqual([]);
    expect(issuePaths(ChoiceQuestionSchema, { ...step, criteria: options(255) })).toEqual([]);
    expect(issuePaths(ChoiceQuestionSchema, { ...step, instructions: "x".repeat(500) })).toEqual([]);
  });

  it.each([
    ["one option", { ...step, criteria: options(1) }, ["criteria"]],
    ["256 options", { ...step, criteria: options(256) }, ["criteria"]],
    ["empty instructions", { ...step, instructions: "" }, ["instructions"]],
    ["instructions over 500 characters", { ...step, instructions: "x".repeat(501) }, ["instructions"]],
    ["missing criteria", without(step, "criteria"), ["criteria"]],
    ["an option without a text description", { ...step, criteria: { up: "Add one.", down: 1 } }, ["criteria", "down"]],
    ["another type", { ...step, type: "noul" }, ["type"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(ChoiceQuestionSchema, value)).toContainEqual(path);
  });

  it("drops an unknown key instead of rejecting it", () => {
    expect(ChoiceQuestionSchema.parse({ ...step, hint: "x" })).toEqual(step);
  });
});

describe("NoulQuestion: a yes/no question answered with P(yes)", () => {
  it("parses with criteria, with only one side of them, and without", () => {
    expect(roundTrip(NoulQuestionSchema, ready)).toEqual(ready);
    expect(issuePaths(NoulQuestionSchema, { ...ready, criteria: { true: "Ready." } })).toEqual([]);
    expect(issuePaths(NoulQuestionSchema, without(ready, "criteria"))).toEqual([]);
  });

  it.each([
    ["a criteria side that is not text", { ...ready, criteria: { true: 1 } }, ["criteria", "true"]],
    ["missing instructions", without(ready, "instructions"), ["instructions"]],
    ["empty instructions", { ...ready, instructions: "" }, ["instructions"]],
    ["another type", { ...ready, type: "text" }, ["type"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(NoulQuestionSchema, value)).toContainEqual(path);
  });
});

describe("TextQuestion: free text up to maxChars", () => {
  it("parses and round-trips; maxChars runs from 1 to 8000", () => {
    expect(roundTrip(TextQuestionSchema, note)).toEqual(note);
    expect(issuePaths(TextQuestionSchema, { ...note, maxChars: 1 })).toEqual([]);
    expect(issuePaths(TextQuestionSchema, { ...note, maxChars: 8000 })).toEqual([]);
  });

  it.each([
    ["maxChars 0", { ...note, maxChars: 0 }, ["maxChars"]],
    ["maxChars 8001", { ...note, maxChars: 8001 }, ["maxChars"]],
    ["a fractional maxChars", { ...note, maxChars: 1.5 }, ["maxChars"]],
    ["missing maxChars", without(note, "maxChars"), ["maxChars"]],
    ["instructions over 500 characters", { ...note, instructions: "x".repeat(501) }, ["instructions"]],
    ["another type", { ...note, type: "choice" }, ["type"]],
  ])("rejects %s", (_name, value, path) => {
    expect(issuePaths(TextQuestionSchema, value)).toContainEqual(path);
  });
});

describe("Question and Questions", () => {
  it("Question reads each type by its `type`", () => {
    for (const question of [step, ready, note]) expect(QuestionSchema.parse(question)).toEqual(question);
  });

  it("Question rejects a type it does not model (Clef's score)", () => {
    expect(issuePaths(QuestionSchema, { type: "score", instructions: "?" })).toEqual([["type"]]);
  });

  it("Questions parses a question set and round-trips", () => {
    expect(roundTrip(QuestionsSchema, questions)).toEqual(questions);
  });

  it.each([
    ["no questions", {}, []],
    ["a key that is not a QuestionId", { Step: step }, ["Step"]],
    ["a bad question", { step: { ...step, criteria: options(1) } }, ["step", "criteria"]],
  ])("Questions rejects %s", (_name, value, path) => {
    expect(issuePaths(QuestionsSchema, value)).toContainEqual(path);
  });

  it("QUESTION_TYPES lists exactly the Question types", () => {
    expectTypeOf<QuestionType>().toEqualTypeOf<Question["type"]>();
    expect([...QUESTION_TYPES].sort()).toEqual(["choice", "noul", "text"]);
  });
});

describe("Answer and Answers: what a model gives back (Clef's shapes, ISSUES I-004)", () => {
  it("parses one answer of each type and round-trips", () => {
    expect(roundTrip(AnswersSchema, answers)).toEqual(answers);
    for (const answer of [stepAnswer, readyAnswer, noteAnswer]) expect(AnswerSchema.parse(answer)).toEqual(answer);
  });

  it("accepts probabilities and P(yes) at 0 and 1, empty probabilities and empty text", () => {
    expect(issuePaths(ChoiceAnswerSchema, { ...stepAnswer, probabilities: { up: 1, down: 0 }, confidence: 0 })).toEqual([]);
    expect(issuePaths(ChoiceAnswerSchema, { ...stepAnswer, probabilities: {} })).toEqual([]);
    expect(issuePaths(NoulAnswerSchema, { type: "noul", noul: 0 })).toEqual([]);
    expect(issuePaths(NoulAnswerSchema, { type: "noul", noul: 1 })).toEqual([]);
    expect(issuePaths(TextAnswerSchema, { type: "text", text: "" })).toEqual([]);
  });

  it.each([
    ["a probability above 1", ChoiceAnswerSchema, { ...stepAnswer, probabilities: { up: 1.2 } }, ["probabilities", "up"]],
    ["a negative probability", ChoiceAnswerSchema, { ...stepAnswer, probabilities: { up: -0.1 } }, ["probabilities", "up"]],
    ["a confidence above 1", ChoiceAnswerSchema, { ...stepAnswer, confidence: 1.5 }, ["confidence"]],
    ["a choice answer without its pick", ChoiceAnswerSchema, without(stepAnswer, "choice"), ["choice"]],
    ["a pick that is not text", ChoiceAnswerSchema, { ...stepAnswer, choice: 1 }, ["choice"]],
    ["P(yes) above 1", NoulAnswerSchema, { type: "noul", noul: 1.2 }, ["noul"]],
    ["a negative P(yes)", NoulAnswerSchema, { type: "noul", noul: -0.1 }, ["noul"]],
    ["a noul answer without P(yes)", NoulAnswerSchema, { type: "noul" }, ["noul"]],
    ["text that is not a string", TextAnswerSchema, { type: "text", text: 3 }, ["text"]],
    ["an answer type it does not model (Clef's score)", AnswerSchema, { type: "score", score: 2 }, ["type"]],
    ["an answer under a key that is not a QuestionId", AnswersSchema, { Step: stepAnswer }, ["Step"]],
  ])("rejects %s", (_name, schema, value, path) => {
    expect(issuePaths(schema, value)).toContainEqual(path);
  });

  it("drops an unknown key inside an answer instead of rejecting it (a third-party response, ISSUES I-009)", () => {
    expect(AnswersSchema.parse({ step: { ...stepAnswer, reasoning: "because" } })).toEqual({ step: stepAnswer });
  });

  it("infers the union of the three answer shapes", () => {
    expectTypeOf<Answer["type"]>().toEqualTypeOf<"choice" | "noul" | "text">();
    expectTypeOf<Answers>().toEqualTypeOf<Record<string, Answer>>();
  });
});

describe("checkAnswers: the loop's check of a model's answers (R21.a)", () => {
  it("accepts answers that fit their questions and returns them in the questions' order", () => {
    const result = checkAnswers(questions, { note: noteAnswer, ready: readyAnswer, step: stepAnswer });
    expect(result).toEqual({ ok: true, answers });
    expect(result.ok && Object.keys(result.answers)).toEqual(["step", "ready", "note"]);
  });

  it("rounds probabilities, confidence and P(yes) to 4 decimals before checking (ISSUES I-018)", () => {
    const raw = {
      step: { type: "choice", choice: "down", probabilities: { up: 0.123449, down: 0.876551 }, confidence: 0.876551 },
      ready: { type: "noul", noul: 1.00004 },
    };
    expect(checkAnswers(questions, raw)).toEqual({
      ok: true,
      answers: {
        step: { type: "choice", choice: "down", probabilities: { up: 0.1234, down: 0.8766 }, confidence: 0.8766 },
        ready: { type: "noul", noul: 1 },
      },
    });
  });

  it("leaves the answers it was given unchanged", () => {
    const raw = { step: { ...stepAnswer, probabilities: { up: 0.123456, down: 0.876544 } } };
    const copy = structuredClone(raw);
    checkAnswers(questions, raw);
    expect(raw).toEqual(copy);
  });

  it("drops answers to questions that were not asked and allows a missing answer (actionFrom decides, R9)", () => {
    const result = checkAnswers({ step, ready }, { step: stepAnswer, note: noteAnswer, jump: { type: "noul", noul: 7 } });
    expect(result).toEqual({ ok: true, answers: { step: stepAnswer } });
  });

  it("drops an unknown key inside an answer", () => {
    expect(checkAnswers({ ready }, { ready: { ...readyAnswer, why: "x" } })).toEqual({ ok: true, answers: { ready: readyAnswer } });
  });

  it("accepts a choice whose probabilities cover only some options, and text of exactly maxChars", () => {
    const raw = { step: { ...stepAnswer, probabilities: { up: 1 } }, note: { type: "text", text: "x".repeat(20) } };
    expect(checkAnswers(questions, raw).ok).toBe(true);
  });

  it.each([
    ["no answers object", null, "invalid answer: answers: Invalid input: expected record, received null"],
    ["an array of answers", [stepAnswer], "invalid answer: answers: Invalid input: expected record, received array"],
    ["an answer of another type than its question", { step: readyAnswer }, 'invalid answer: step.type: Invalid input: expected "choice"'],
    [
      "a pick that is not one of the options",
      { step: { ...stepAnswer, choice: "left" } },
      'invalid answer: step.choice: Invalid option: "left" is not one of the question\'s criteria',
    ],
    [
      "a probability for an option the question does not have",
      { step: { ...stepAnswer, probabilities: { up: 0.5, left: 0.5 } } },
      'invalid answer: step.probabilities.left: Invalid option: "left" is not one of the question\'s criteria',
    ],
    [
      "text longer than maxChars",
      { note: { type: "text", text: "x".repeat(21) } },
      "invalid answer: note.text: Too big: expected string to have <=20 characters",
    ],
    ["P(yes) still above 1 after rounding", { ready: { type: "noul", noul: 1.0001 } }, "invalid answer: ready.noul: Too big: expected number to be <=1"],
    [
      "a choice answer without its confidence",
      { step: without(stepAnswer, "confidence") },
      "invalid answer: step.confidence: Invalid input: expected number, received undefined",
    ],
  ])("refuses %s with 'invalid answer: <path>: <message>'", (_name, raw, error) => {
    expect(checkAnswers(questions, raw)).toEqual({ ok: false, error });
  });

  it("reports only the first problem, in the questions' order", () => {
    const raw = { note: { type: "text", text: "x".repeat(21) }, step: { ...stepAnswer, choice: "left" } };
    expect(checkAnswers(questions, raw)).toEqual({
      ok: false,
      error: 'invalid answer: step.choice: Invalid option: "left" is not one of the question\'s criteria',
    });
  });

  it("does not take a criteria key from the object prototype for an option", () => {
    expect(checkAnswers({ step }, { step: { ...stepAnswer, choice: "toString" } })).toEqual({
      ok: false,
      error: 'invalid answer: step.choice: Invalid option: "toString" is not one of the question\'s criteria',
    });
  });
});
