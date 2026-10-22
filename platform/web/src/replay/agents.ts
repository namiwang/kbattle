// Agent markers: a dot in the slot kind's color with a facing line, labelled by
// id. Markers live in the world container at their position in meters and are
// counter-scaled, so they keep one size on screen whatever the zoom. Only the
// agents of the current Tick are shown; a dead agent is absent from every Tick
// after its death (DESIGN.md §5.3), so it disappears.

import { Container, Graphics, Text } from "pixi.js";
import type { DrawnAgent } from "./debug";
import type { SlotKind, TickEvent } from "./log-index";
import { COLORS, kindColor, MARKER } from "./theme";

export interface AgentLayer {
  readonly view: Container;
  /** Shows the agents of `frame` at their recorded position and facing, hides the others. */
  render(frame: TickEvent): void;
  /** Tells the layer how many pixels a meter is, so markers stay MARKER-sized. */
  setPixelsPerMeter(scale: number): void;
  /** The agents on screen, read back from the scene graph. */
  drawn(): DrawnAgent[];
}

interface Marker {
  root: Container;
  body: Graphics;
}

export function createAgentLayer(kindOf: (agentId: string) => SlotKind | undefined): AgentLayer {
  const view = new Container({ label: "agents" });
  const markers = new Map<string, Marker>();
  let markerScale = 1;

  const markerFor = (id: string): Marker => {
    const existing = markers.get(id);
    if (existing) return existing;
    const body = new Graphics()
      .circle(0, 0, MARKER.bodyRadiusPx)
      .fill(kindColor(kindOf(id)))
      .stroke({ width: 1.5, color: COLORS.background })
      .moveTo(0, 0)
      .lineTo(MARKER.facingLengthPx, 0)
      .stroke({ width: MARKER.facingWidthPx, color: COLORS.facing, cap: "round" });
    const label = new Text({
      text: id,
      anchor: { x: 0.5, y: 0 },
      position: { x: 0, y: MARKER.bodyRadiusPx + 3 },
      style: { fontFamily: "system-ui, sans-serif", fontSize: MARKER.labelSizePx, fill: COLORS.label },
    });
    const root = new Container({ label: `agent ${id}` });
    root.addChild(body, label);
    root.scale.set(markerScale);
    view.addChild(root);
    const marker = { root, body };
    markers.set(id, marker);
    return marker;
  };

  return {
    view,
    render(frame) {
      for (const marker of markers.values()) marker.root.visible = false;
      for (const [id, x, y, facing] of frame.agents) {
        const { root, body } = markerFor(id);
        root.visible = true;
        root.position.set(x, y);
        body.angle = facing; // Pixi angles are degrees, clockwise with y down: same as §6.1
      }
    },
    setPixelsPerMeter(scale) {
      markerScale = scale > 0 ? 1 / scale : 1;
      for (const marker of markers.values()) marker.root.scale.set(markerScale);
    },
    drawn() {
      return [...markers.entries()]
        .filter(([, m]) => m.root.visible)
        .map(([id, m]) => ({
          id,
          x: m.root.x,
          y: m.root.y,
          facing: m.body.angle,
          tip: m.body.toGlobal({ x: MARKER.facingLengthPx, y: 0 }),
        }));
    },
  };
}
