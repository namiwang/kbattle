// Doer answers → the Action the sim applies until the next answer
// (DESIGN.md §5.4, row 25; sim ruling R9). The doer only picks; the sim clamps
// (principle 1): anything missing or unknown falls back to doing nothing, never
// to the previous answer. Escalation is not core's business: brain reads it.

import { FIRE_THRESHOLD } from "../constants";
import type { DoerAnswers } from "../schemas";
import { MOVE_CHOICES, TURN_CHOICES, type Action, type AgentId, type MoveChoice, type TurnChoice } from "../types";

const isMove = (choice: string | undefined): choice is MoveChoice =>
  (MOVE_CHOICES as readonly string[]).includes(choice ?? "");
const isTurn = (choice: string | undefined): choice is TurnChoice =>
  (TURN_CHOICES as readonly string[]).includes(choice ?? "");

/**
 * move and turn from their choices (missing or unknown: stop, none); fire when
 * the fire noul is at least FIRE_THRESHOLD; target only when the choice names a
 * visible id; face_target without a target is none (§5.4).
 */
export function actionFromAnswers(answers: DoerAnswers, visibleIds: readonly AgentId[]): Action {
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
