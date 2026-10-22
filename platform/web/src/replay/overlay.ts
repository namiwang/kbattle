// Perception overlay of the replay (DESIGN.md §6.2 Perception, §7 item 5), for
// the followed agent at the tick on screen: its vision cone (VISION_CONE_DEG
// wide, VISION_RANGE_M deep, in world meters, clipped to the arena), a ring
// around each enemy core.perceive reports visible, and a short red tick toward
// each source of incoming fire. The model is rebuilt from the log for every
// tick (stateFromTick, then perceive: microseconds). Two layers: the cone goes
// under bullet trails and agents, the rings and ticks over trails, under agents.

import { normalizeDeg, perceive, VISION_CONE_DEG, VISION_RANGE_M, vec2, type PerceptionState, type Vec2 } from "@kbattle/core";
import { Graphics } from "pixi.js";
import { OVERLAY } from "./theme";

/** Segments of the cone's arc: 3.75° each, within 0.04 m of the true circle at 60 m. */
const CONE_STEPS = 24;

/** The vision cone of an agent at `pos` facing `facing`: the apex, then the arc from −half to +half the cone, clockwise. */
export function visionCone(pos: Vec2, facing: number, steps = CONE_STEPS): Vec2[] {
  const cone = [{ ...pos }];
  for (let i = 0; i <= steps; i++) {
    const angle = facing - VISION_CONE_DEG / 2 + (VISION_CONE_DEG * i) / steps;
    cone.push(vec2.add(pos, vec2.scale(vec2.fromAngle(angle), VISION_RANGE_M)));
  }
  return cone;
}

/** The part of `polygon` inside 0..width × 0..height (Sutherland–Hodgman); empty when none is. */
export function clipToRect(polygon: readonly Vec2[], width: number, height: number): Vec2[] {
  const insides: ((p: Vec2) => number)[] = [(p) => p.x, (p) => width - p.x, (p) => p.y, (p) => height - p.y];
  let out = [...polygon];
  for (const inside of insides) {
    const input = out;
    out = [];
    input.forEach((a, i) => {
      const b = input[(i + 1) % input.length] ?? a;
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    });
  }
  return out;
}

/** The segment from `from` to `to` meters away from `pos` at absolute angle `angle` (degrees, §6.1). */
export function tickSegment(pos: Vec2, angle: number, from: number, to: number): [Vec2, Vec2] {
  const dir = vec2.fromAngle(angle);
  return [vec2.add(pos, vec2.scale(dir, from)), vec2.add(pos, vec2.scale(dir, to))];
}

/** What the overlay shows for one agent at one tick. */
export interface OverlayModel {
  readonly tick: number;
  readonly agent: string;
  readonly alive: boolean;
  readonly pos: Vec2;
  readonly facing: number;
  /** The vision cone clipped to the arena, apex first; empty for a dead agent, which sees nothing. */
  readonly cone: readonly Vec2[];
  /** The enemies perceive reports visible, where they stand. */
  readonly seen: readonly { id: string; pos: Vec2 }[];
  /** Absolute angles (degrees) toward each source of incoming fire: facing plus the bearing perceive reports. */
  readonly incoming: readonly number[];
}

/** The overlay of `agentId` in `state`. Throws if no agent has that id. */
export function overlayModel(state: PerceptionState, agentId: string): OverlayModel {
  const me = state.agents.find((a) => a.id === agentId);
  if (!me) throw new Error(`overlay: no agent "${agentId}" in this world`);
  const observation = perceive(state, agentId);
  const posOf = new Map(state.agents.map((a) => [a.id, a.pos]));
  return {
    tick: state.tick,
    agent: agentId,
    alive: me.alive,
    pos: me.pos,
    facing: me.facing,
    cone: me.alive ? clipToRect(visionCone(me.pos, me.facing), state.map.width, state.map.height) : [],
    seen: observation.visible.flatMap(({ id }) => {
      const pos = posOf.get(id);
      return pos ? [{ id, pos }] : [];
    }),
    incoming: observation.incoming.map(({ bearing }) => normalizeDeg(me.facing + bearing)),
  };
}

/** What the overlay drew last, for the smoke and devtools. */
export interface DrawnOverlay {
  tick: number;
  agent: string;
  /** Whether a cone was drawn (not for a dead agent). */
  cone: boolean;
  /** Ids of the enemies ringed as visible. */
  visible: string[];
  /** Absolute angles of the incoming-fire ticks. */
  incoming: number[];
}

export interface OverlayLayer {
  /** The cone: add it under bullet trails and agents. */
  readonly under: Graphics;
  /** Rings around the seen and incoming-fire ticks: add it over bullet trails, under agents. */
  readonly over: Graphics;
  /** Draws `model`; null clears the overlay. */
  render(model: OverlayModel | null): void;
  /** Tells the layer how many pixels a meter is, so rings, ticks and lines keep their size on screen. */
  setPixelsPerMeter(scale: number): void;
  drawn(): DrawnOverlay | null;
}

export function createOverlayLayer(): OverlayLayer {
  const under = new Graphics({ label: "vision cone" });
  const over = new Graphics({ label: "perception marks" });
  let metersPerPx = 1;
  let model: OverlayModel | null = null;

  const draw = () => {
    under.clear();
    over.clear();
    if (!model) return;
    const m = metersPerPx;
    if (model.cone.length >= 3) {
      under
        .poly(model.cone.flatMap((p) => [p.x, p.y]), true)
        .fill({ color: OVERLAY.cone, alpha: OVERLAY.coneFillAlpha })
        .stroke({ width: OVERLAY.coneEdgePx * m, color: OVERLAY.cone, alpha: OVERLAY.coneEdgeAlpha, join: "round" });
    }
    for (const { pos } of model.seen) over.circle(pos.x, pos.y, OVERLAY.seenRingPx * m);
    if (model.seen.length > 0) over.stroke({ width: OVERLAY.seenWidthPx * m, color: OVERLAY.seen });
    for (const angle of model.incoming) {
      const [from, to] = tickSegment(model.pos, angle, OVERLAY.incomingFromPx * m, OVERLAY.incomingToPx * m);
      over.moveTo(from.x, from.y).lineTo(to.x, to.y);
    }
    if (model.incoming.length > 0) over.stroke({ width: OVERLAY.incomingWidthPx * m, color: OVERLAY.incoming, cap: "round" });
  };

  return {
    under,
    over,
    render(next) {
      model = next;
      draw();
    },
    setPixelsPerMeter(scale) {
      metersPerPx = scale > 0 ? 1 / scale : 1;
      draw();
    },
    drawn: () =>
      model && {
        tick: model.tick,
        agent: model.agent,
        cone: model.cone.length >= 3,
        visible: model.seen.map((s) => s.id),
        incoming: [...model.incoming],
      },
  };
}
