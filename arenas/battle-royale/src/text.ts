// What the planner reads (DESIGN.md row 48, §5.3; ruling R24): the static text
// every agent knows before the match, and one observation as text.

import { TICK_MS } from "@decision-arena/core";
import {
  AGENT_HP,
  BULLET_DAMAGE,
  BULLET_SPEED_MPS,
  FIRE_INTERVAL_TICKS,
  HEAR_SHOT_RANGE_M,
  HEAR_STEPS_RANGE_M,
  MOVE_SPEED_MPS,
  normalizeDeg,
  SPREAD_DEG,
  TURN_RATE_DPS,
  VISION_CONE_DEG,
  VISION_RANGE_M,
  type MapSpec,
  type Observation,
  type Vec2,
} from "@decision-arena/kit-shooter";

const point = ({ x, y }: Vec2) => `(${x},${y})`;
const seconds = (ticks: number) => (ticks * TICK_MS) / 1000;

/**
 * The map (its size, every obstacle's corners, the spawns) and the rules in a few
 * lines, from the kit's constants so the text follows a retune. Under 1,200
 * characters on the bundled maps (a test keeps it there).
 */
export function staticText(map: MapSpec, durationTicks: number): string {
  return [
    `Map ${map.id}: ${map.width} × ${map.height} m, x to the right, y down; facing and bearings in degrees, 0° is +x, clockwise.`,
    `Obstacles block movement, bullets and sight; their corners in m: ${map.obstacles.map((o) => o.vertices.map(point).join(" ")).join("; ")}.`,
    `Spawns, taken in a shuffled order: ${map.spawns.map(point).join(" ")}.`,
    `Rules: the last agent alive wins; the match ends after ${seconds(durationTicks)} s at the latest; ranking is survival, then kills, then hp. ` +
      `Everyone starts with ${AGENT_HP} hp and a hit costs ${BULLET_DAMAGE}. You walk ${MOVE_SPEED_MPS} m/s and turn ${TURN_RATE_DPS}°/s; ` +
      `you fire up to ${1000 / (FIRE_INTERVAL_TICKS * TICK_MS)} shots a second, bullets fly ${BULLET_SPEED_MPS} m/s with up to ${SPREAD_DEG}° of spread. ` +
      `You see enemies within ${VISION_CONE_DEG / 2}° of your facing and ${VISION_RANGE_M} m in line of sight, ` +
      `and hear shots within ${HEAR_SHOT_RANGE_M} m and footsteps within ${HEAR_STEPS_RANGE_M} m, through walls.`,
  ].join("\n");
}

/**
 * The observation as four text lines: self, visible, heard, incoming. Lists keep
 * perception's order (nearest first, most important first); fields are written in
 * a fixed order, so the text depends only on the values. Positions and distances
 * are rounded to whole meters and angles to whole degrees in (-180, 180]. The
 * models package's formatObservation, moved here (its copy stays for the version-1
 * thinker prompt until R2.3 rewrites it).
 */
export function observationText({ self, visible, heard, incoming }: Observation): string {
  return [
    `self: at (${meters(self.pos.x)}, ${meters(self.pos.y)}), facing ${degrees(self.facing)}, hp ${self.hp}, kills ${self.kills}`,
    `visible: ${list(visible.map((v) => `${v.id} at ${degrees(v.bearing)} ${meters(v.dist)} m${v.moving ? " moving" : ""}`))}`,
    `heard: ${list(heard.map((h) => `${h.kind} at ${degrees(h.bearing)} ${h.dist}`))}`,
    `incoming: ${list(incoming.map((i) => `from ${degrees(i.bearing)}`))}`,
  ].join("\n");
}

function meters(value: number): number {
  return Math.round(value); // a template literal writes -0 as "0"
}

function degrees(angle: number): string {
  return `${normalizeDeg(Math.round(angle))}°`;
}

function list(items: string[]): string {
  return items.length === 0 ? "none" : items.join("; ");
}
