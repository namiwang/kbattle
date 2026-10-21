// The scenarios behind core/fixtures/golden/*.json. Tests regenerate each trace
// and compare it with the committed file; scripts/make-goldens.ts writes the
// files. Tests never write goldens: change one on purpose by rerunning the
// script and reviewing the diff.

import { step } from "../../src/sim/step";
import type { WorldState } from "../../src/types";
import { makeAgent, makeBullet, makeWorld } from "./helpers";

export const GOLDEN_DIR = new URL("../../fixtures/golden/", import.meta.url);

/** Rounds to 6 decimals (µm), turning -0 into 0: goldens stay readable and ignore last-bit float noise. */
export function round6(value: number): number {
  const r = Math.round(value * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

// ---- v1.1: one bullet in a straight line ----

/**
 * a0 at (10, 50) facing 0° on arena-1, holding still; b0 pre-placed at its
 * muzzle moving (1.5, -0.05) m per tick. The middle lane is open, so the bullet
 * stays in the arena and clear of obstacles for all 50 ticks.
 */
export function singleBulletWorld(seed = 1): WorldState {
  return makeWorld({
    seed,
    agents: [makeAgent(0, { x: 10, y: 50 }, 0)],
    bullets: [makeBullet(0, "a0", { x: 10.6, y: 50 }, { x: 1.5, y: -0.05 })],
  });
}

export function singleBulletGolden() {
  let state = singleBulletWorld();
  const trace: [number, number, number][] = [];
  for (let i = 0; i < 50; i++) {
    state = step(state, {}).state;
    const bullet = state.bullets.find((b) => b.id === "b0");
    if (!bullet) throw new Error(`b0 disappeared at tick ${state.tick}`);
    trace.push([state.tick, round6(bullet.pos.x), round6(bullet.pos.y)]);
  }
  return {
    scenario:
      "arena-1; a0 at (10, 50) facing 0, stopped; b0 (owner a0) at (10.6, 50) moving (1.5, -0.05) m/tick; 50 ticks",
    trace, // [tick, b0 x, b0 y] after each step
  };
}

/** Golden file name → the function that regenerates its content. */
export const GOLDENS: Readonly<Record<string, () => Record<string, unknown>>> = {
  "v1.1-single-bullet.json": singleBulletGolden,
};

/** Top-level fields pretty, each row of an array field on one line: readable, diffable. */
export function formatGolden(golden: Record<string, unknown>): string {
  const fields = Object.entries(golden).map(([key, value]) => {
    const body =
      Array.isArray(value) && value.length > 0
        ? `[\n${value.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`
        : JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
    return `  ${JSON.stringify(key)}: ${body}`;
  });
  return `{\n${fields.join(",\n")}\n}\n`;
}
