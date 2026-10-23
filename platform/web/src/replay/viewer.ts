// The replay viewer: a MatchLog in, a Pixi scene of the clock's tick out, with
// playback controls under it, a view row (follow camera, bullet trails, vision
// cone), and the mind panel of the followed agent (v2.4) beside the canvas,
// its markers under the timeline. The scene reads Tick events only (DESIGN.md
// §5.3); nothing here runs the sim. The overlay's and the panel's perception
// is recomputed from the log with core.perceive.

import type { MatchLog } from "@decision-arena/core/legacy";
import { getMap } from "@decision-arena/kit-shooter";
import { UPDATE_PRIORITY } from "pixi.js";
import { createAgentLayer } from "./agents";
import { createBulletLayer, createTrailBuffer, type DrawnBullets } from "./bullets";
import { createFollowSelect, followChoices, FREE } from "./camera";
import { createClock, type Clock } from "./clock";
import { createControls } from "./controls";
import type { Transform } from "./coords";
import type { DrawnAgent } from "./debug";
import { indexLog, type LogIndex } from "./log-index";
import { drawMap } from "./map";
import { createMindPanel } from "./mind-panel";
import type { DrawnMind } from "./mind-selectors";
import { createOverlayLayer, overlayModel, type DrawnOverlay } from "./overlay";
import { createStage, type Stage } from "./stage";
import { createStateAt } from "./state-from-tick";
import "./replay.css";

export interface ReplayViewer {
  readonly index: LogIndex;
  /** Playback state; seek/play/pause here and the scene follows on the next frame. */
  readonly clock: Clock;
  /** The tick on screen. */
  readonly tick: number;
  /** The meters-to-pixels transform right now (the follow camera's while it follows). */
  readonly transform: Transform;
  /** The agent the camera follows, or null when it is free. */
  readonly follow: string | null;
  drawnAgents(): DrawnAgent[];
  drawnBullets(): DrawnBullets;
  /** What the perception overlay shows, or null while it is off or nobody is followed. */
  drawnOverlay(): DrawnOverlay | null;
  /** What the mind panel shows for the followed agent, or null while nobody is followed. */
  drawnMind(): DrawnMind | null;
  /** Settles once the scene has been rendered for the first time (tick 0), or on destroy. */
  readonly firstFrame: Promise<void>;
  /**
   * Releases everything mountReplay took: the document keydown listener, the
   * ResizeObserver, the Pixi app (ticker, scene, WebGL context, canvas), and the
   * elements it added to the host (the mind panel and its markers among them).
   * mountReplay can then run again on the same host.
   * Calling it twice is harmless; the viewer is unusable afterwards.
   */
  destroy(): void;
}

/** A checkbox with its label text after it. */
function toggle(text: string, checked: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const label = document.createElement("label");
  label.append(input, text);
  return { label, input };
}

/** Builds the replay of `log` inside `host` (any sized element), paused at tick 0. */
export async function mountReplay(host: HTMLElement, log: MatchLog): Promise<ReplayViewer> {
  const map = getMap(log.config.mapId);
  const index = indexLog(log);
  const clock = createClock(index.lastTick);
  const controls = createControls(clock);

  // View row: follow camera, trails, vision cone. Element listeners only: nothing on document.
  const follow = createFollowSelect(followChoices(index));
  const followLabel = document.createElement("label");
  followLabel.append("Follow", follow);
  const trailsToggle = toggle("Trails", true);
  const coneToggle = toggle("Vision cone", false);
  coneToggle.label.title = "The followed agent's vision cone, the enemies it sees, and where incoming fire comes from";
  const view = document.createElement("div");
  view.className = "replay-view";
  view.append(followLabel, trailsToggle.label, coneToggle.label);

  const stateAt = createStateAt(index, log); // one rebuilt world per tick, shared by camera, overlay and mind panel
  const mind = createMindPanel({ index, stateAt, seek: (t) => clock.seek(t) });
  controls.element.append(mind.markers); // the controls grid puts them under the timeline

  const root = document.createElement("div");
  root.className = "replay";
  const stageHost = document.createElement("div");
  stageHost.className = "replay-stage";
  root.append(stageHost, controls.element, view, mind.element);
  host.append(root);

  let stage: Stage;
  try {
    stage = await createStage(stageHost, map.width, map.height);
  } catch (error) {
    controls.destroy();
    root.remove();
    throw error;
  }
  const agents = createAgentLayer((id) => index.kindOf(id));
  const bullets = createBulletLayer();
  const overlay = createOverlayLayer();
  // Bottom to top: arena, cone, trails, rings and incoming ticks, agents, bullets.
  stage.world.addChild(drawMap(map), overlay.under, bullets.trails, overlay.over, agents.view, bullets.dots);
  const setScale = (scale: number) => {
    agents.setPixelsPerMeter(scale);
    bullets.setPixelsPerMeter(scale);
    overlay.setPixelsPerMeter(scale);
  };
  setScale(stage.transform.scale);
  stage.onResize((t) => setScale(t.scale));

  const trails = createTrailBuffer();
  const bulletsAt = (t: number) => index.byTick(t).bullets;
  const followed = () => (follow.value === FREE ? null : follow.value);

  let tick = clock.tick;
  const draw = () => {
    agents.render(index.byTick(tick)); // O(1): scrubbing never replays from zero
    trails.seek(tick, bulletsAt);
    bullets.render(trails.trails(), trailsToggle.input.checked);
    const id = followed();
    const state = id === null ? undefined : stateAt(tick);
    const agent = state?.agents.find((a) => a.id === id);
    stage.setCenter(agent ? agent.pos : null); // a dead agent stays centered where it was last seen
    overlay.render(state && agent && coneToggle.input.checked ? overlayModel(state, agent.id) : null);
    mind.render(tick, id); // a no-op unless the tick or the followed agent changed
  };
  draw();

  let dirty = false;
  const redraw = () => (dirty = true);
  for (const widget of [follow, trailsToggle.input, coneToggle.input]) widget.addEventListener("change", redraw);
  // Runs before Pixi draws the frame (the render callback has a lower priority).
  stage.app.ticker.add((ticker) => {
    clock.advance(ticker.deltaMS);
    if (clock.tick !== tick || dirty) {
      tick = clock.tick;
      dirty = false;
      draw();
    }
    controls.sync();
  });
  let firstFrameDone = () => {};
  const firstFrame = new Promise<void>((resolve) => (firstFrameDone = resolve));
  // UTILITY runs after Pixi's render callback (LOW) in the same tick.
  stage.app.ticker.addOnce(() => firstFrameDone(), undefined, UPDATE_PRIORITY.UTILITY);

  let destroyed = false;
  return {
    index,
    clock,
    get tick() {
      return tick;
    },
    get transform() {
      return stage.transform;
    },
    get follow() {
      return followed();
    },
    drawnAgents: () => agents.drawn(),
    drawnBullets: () => bullets.drawn(),
    drawnOverlay: () => overlay.drawn(),
    drawnMind: () => mind.drawn(),
    firstFrame,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controls.destroy();
      stage.destroy();
      root.remove();
      firstFrameDone(); // its ticker is gone; nobody waits forever
    },
  };
}
