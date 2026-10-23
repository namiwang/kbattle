// Answers → the Action the sim applies until the next answer (DESIGN.md §5.4,
// row 25; sim ruling R9). The model only picks; the sim clamps (principle 1):
// anything missing or unknown falls back to doing nothing, never to the
// previous answer. Escalation is not the sim's business: the platform reads it.

import { FIRE_THRESHOLD } from "../constants";
import { MOVE_CHOICES, TURN_CHOICES, type Action, type AgentId, type MoveChoice, type TurnChoice } from "../types";

/** A choice answer as actionFromAnswers reads it: the pick; its other fields (type, probabilities) are not read. */
type Pick = { choice: string; [field: string]: unknown };
/** A yes/no answer as actionFromAnswers reads it: P(yes). */
type Chance = { noul: number; [field: string]: unknown };

/**
 * What actionFromAnswers reads of an agent's answers: the picks of move, turn and
 * target and the P(yes) of fire, each optional. The version-1 DoerAnswers fit it;
 * the battle royale arena narrows the platform's checked answers to it. Answers to
 * other questions (escalate) are not read.
 */
export interface ActionAnswers {
  move?: Pick;
  turn?: Pick;
  fire?: Chance;
  target?: Pick;
  [question: string]: unknown;
}

const isMove = (choice: string | undefined): choice is MoveChoice =>
  (MOVE_CHOICES as readonly string[]).includes(choice ?? "");
const isTurn = (choice: string | undefined): choice is TurnChoice =>
  (TURN_CHOICES as readonly string[]).includes(choice ?? "");

/**
 * move and turn from their choices (missing or unknown: stop, none); fire when
 * the fire noul is at least FIRE_THRESHOLD; target only when the choice names a
 * visible id; face_target without a target is none (§5.4).
 */
export function actionFromAnswers(answers: ActionAnswers, visibleIds: readonly AgentId[]): Action {
  const move = answers.move?.choice;
  const turn = answers.turn?.choice;
  const pick = answers.target?.choice;
  const target = pick !== undefined && pick !== "none" && visibleIds.includes(pick) ? pick : null;
  return {
    move: isMove(move) ? move : "stop",
    turn: isTurn(turn) && !(turn === "face_target" && target === null) ? turn : "none",
    fire: (answers.fire?.noul ?? 0) >= FIRE_THRESHOLD,
    target,
  };
}
