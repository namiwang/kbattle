// How a battle royale match ranks its agents (DESIGN.md §13; sim ruling R11;
// ISSUES I-023). A copy of the version-1 loop's rankAgents
// (kits/shooter/src/legacy/match.ts), which stays untouched until R0.5 deletes it.

import type { Agent, AgentId } from "@decision-arena/kit-shooter";

/**
 * The final ranking (R11), winner first: living agents by kills, then HP, then
 * slot; then the dead, latest death first, then by kills, then slot. Slot order
 * is id order a0, a1, …, a15.
 */
export function rankAgents(agents: readonly Pick<Agent, "id" | "slot" | "alive" | "hp" | "kills" | "deathTick">[]): AgentId[] {
  const alive = agents.filter((a) => a.alive).sort((a, b) => b.kills - a.kills || b.hp - a.hp || a.slot - b.slot);
  const dead = agents
    .filter((a) => !a.alive)
    .sort((a, b) => (b.deathTick ?? 0) - (a.deathTick ?? 0) || b.kills - a.kills || a.slot - b.slot);
  return [...alive, ...dead].map((a) => a.id);
}
