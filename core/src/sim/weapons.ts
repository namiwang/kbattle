// The one weapon every agent carries (DESIGN.md §6.2; sim ruling R4 step 4).
// Stats are in constants.ts; per-tick values are converted once here (§6.1).

import { AGENT_RADIUS_M, BULLET_SPEED_MPS, SPREAD_DEG } from "../constants";
import type { Agent, Bullet } from "../types";
import { mpsToMetersPerTick } from "../units";
import { add, fromAngle, scale } from "../vec2";

/** Bullets leave this far from the shooter's center: 0.1 m outside its body. */
export const MUZZLE_OFFSET_M = AGENT_RADIUS_M + 0.1;

/** Bullet travel per tick, in meters. */
export const BULLET_STEP_M = mpsToMetersPerTick(BULLET_SPEED_MPS);

/** A spread angle from a uniform draw `u` in [0, 1): uniform over [−SPREAD_DEG, +SPREAD_DEG). */
export function spreadDeg(u: number): number {
  return (2 * u - 1) * SPREAD_DEG;
}

/** A bullet at the shooter's muzzle (along its facing) heading `facing + spread`, at BULLET_STEP_M per tick. */
export function spawnBullet(shooter: Agent, id: string, tick: number, spread: number): Bullet {
  return {
    id,
    owner: shooter.id,
    pos: add(shooter.pos, scale(fromAngle(shooter.facing), MUZZLE_OFFSET_M)),
    vel: scale(fromAngle(shooter.facing + spread), BULLET_STEP_M),
    spawnTick: tick,
  };
}
