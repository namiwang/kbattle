// Version-1 copies of AgentId and the four choice lists (ruling R20): the version-1
// schemas build their enums from these. The shooter kit keeps its own in
// kits/shooter/src/types.ts; core imports nothing from the kit.

/** `a0`…`a15` in slot order (§6.1). */
export type AgentId = string;

// Each string union below is derived from a frozen list, so zod enums
// (schemas.ts) are built from the same list instead of repeating it.

/** Doer `move` choices (§5.4), relative to facing; also the `move` criteria keys. */
export const MOVE_CHOICES = Object.freeze(["forward", "back", "left", "right", "stop"] as const);
export type MoveChoice = (typeof MOVE_CHOICES)[number];

/** Doer `turn` choices (§5.4). `face_target` with no target means `none`. */
export const TURN_CHOICES = Object.freeze(["left", "right", "none", "face_target"] as const);
export type TurnChoice = (typeof TURN_CHOICES)[number];

/** What was heard (§6.2). */
export const SOUND_KINDS = Object.freeze(["shot", "steps"] as const);
export type SoundKind = (typeof SOUND_KINDS)[number];

/** Coarse hearing distance (§6.2), nearest first; band edges are HEARING_BANDS_M. */
export const HEARING_BANDS = Object.freeze(["near", "mid", "far"] as const);
export type HearingBand = (typeof HEARING_BANDS)[number];
