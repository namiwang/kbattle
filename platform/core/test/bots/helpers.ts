// Injected perception for bot tests: hand-built Observations and a driver that
// feeds a bot one decision at a time, as the match loop would (ticks 1, 11, …).

import type { DoerAnswer } from "../../src/schemas";
import type { DecisionProvider } from "../../src/sim/providers";
import { createRng, nextFloat, type RngState } from "../../src/sim/rng";
import type { AgentId, Observation } from "../../src/types";

type Self = Observation["self"];

/** An observation: alone at the arena center facing 0 with full HP, unless overridden. */
export function obs(self: Partial<Self> = {}, rest: Partial<Omit<Observation, "self">> = {}): Observation {
  return {
    self: { pos: { x: 50, y: 50 }, facing: 0, hp: 100, kills: 0, secondsLeft: 300, ...self },
    visible: [],
    heard: [],
    incoming: [],
    ...rest,
  };
}

/** An enemy in view. */
export function enemy(id: AgentId, bearing: number, dist = 30, moving = false): Observation["visible"][number] {
  return { id, bearing, dist, moving };
}

/** The tick of decision n (0-based) on the doer cadence: 1, 11, 21, … (R1). */
export const decisionTick = (n: number) => 1 + 10 * n;

/** Asks `bot` once per observation, on consecutive decision ticks; returns the answers. */
export async function decideAll(bot: DecisionProvider, views: Observation[], agent = "a0"): Promise<DoerAnswer[]> {
  const answers: DoerAnswer[] = [];
  for (const [n, observation] of views.entries()) {
    answers.push(await bot.decide({ tick: decisionTick(n), agent, observation, plan: "", signal: new AbortController().signal }));
  }
  return answers;
}

/** The picks of an answer in one line, for compact expectations. */
export function picks(answer: DoerAnswer) {
  const a = answer.answers;
  return { move: a.move?.choice, turn: a.turn?.choice, fire: a.fire?.noul, target: a.target?.choice };
}

/**
 * 50 synthetic observations from a seed: a random walk around the arena with
 * occasional standstills, hits and enemies in view, so every bot branch runs.
 */
export function syntheticViews(seed: number, count = 50): Observation[] {
  let rng: RngState = createRng(seed);
  const float = () => {
    const d = nextFloat(rng);
    rng = d.rng;
    return d.value;
  };
  let pos = { x: 10 + 80 * float(), y: 10 + 80 * float() };
  let facing = Math.round(360 * float()) - 179;
  let hp = 100;
  return Array.from({ length: count }, () => {
    if (float() < 0.7) {
      const step = 2.5 * float();
      pos = { x: Math.min(99, Math.max(1, pos.x + step * (float() - 0.5) * 2)), y: Math.min(99, Math.max(1, pos.y + step)) };
      if (pos.y >= 99) pos = { x: pos.x, y: 5 };
    }
    if (float() < 0.3) facing = Math.round(360 * float()) - 179;
    if (float() < 0.1 && hp > 20) hp -= 20;
    const visible = float() < 0.35 ? [enemy("a3", Math.round(90 * float()) - 45, Math.round(5 + 50 * float()))] : [];
    return obs({ pos: { ...pos }, facing, hp }, { visible });
  });
}
