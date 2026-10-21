// The replay viewer: a MatchLog in, a Pixi scene of the clock's tick out, with
// playback controls under it. It reads Tick events only (DESIGN.md §5.3);
// nothing here runs the sim.

import { getMap, type MatchLog } from "@kbattle/core";
import { UPDATE_PRIORITY } from "pixi.js";
import { createAgentLayer } from "./agents";
import { createClock, type Clock } from "./clock";
import { createControls } from "./controls";
import type { Transform } from "./coords";
import type { DrawnAgent } from "./debug";
import { indexLog, type LogIndex } from "./log-index";
import { drawMap } from "./map";
import { createStage, type Stage } from "./stage";
import "./replay.css";

export interface ReplayViewer {
  readonly index: LogIndex;
  /** Playback state; seek/play/pause here and the scene follows on the next frame. */
  readonly clock: Clock;
  /** The tick on screen. */
  readonly tick: number;
  /** The meters-to-pixels transform right now. */
  readonly transform: Transform;
  drawnAgents(): DrawnAgent[];
  /** Settles once the scene has been rendered for the first time (tick 0), or on destroy. */
  readonly firstFrame: Promise<void>;
  /**
   * Releases everything mountReplay took: the document keydown listener, the
   * ResizeObserver, the Pixi app (ticker, scene, WebGL context, canvas), and the
   * elements it added to the host. mountReplay can then run again on the same host.
   * Calling it twice is harmless; the viewer is unusable afterwards.
   */
  destroy(): void;
}

/** Builds the replay of `log` inside `host` (any sized element), paused at tick 0. */
export async function mountReplay(host: HTMLElement, log: MatchLog): Promise<ReplayViewer> {
  const map = getMap(log.config.mapId);
  const index = indexLog(log);
  const clock = createClock(index.lastTick);
  const controls = createControls(clock);

  const root = document.createElement("div");
  root.className = "replay";
  const stageHost = document.createElement("div");
  stageHost.className = "replay-stage";
  root.append(stageHost, controls.element);
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
  stage.world.addChild(drawMap(map), agents.view);
  agents.setPixelsPerMeter(stage.transform.scale);
  stage.onResize((t) => agents.setPixelsPerMeter(t.scale));

  let tick = clock.tick;
  agents.render(index.byTick(tick));
  // Runs before Pixi draws the frame (the render callback has a lower priority).
  stage.app.ticker.add((ticker) => {
    clock.advance(ticker.deltaMS);
    if (clock.tick !== tick) {
      tick = clock.tick;
      agents.render(index.byTick(tick)); // O(1): scrubbing never replays from zero
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
    drawnAgents: () => agents.drawn(),
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
