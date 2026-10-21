// The replay viewer: a MatchLog in, a Pixi scene of any tick out. It reads Tick
// events only (DESIGN.md §5.3); nothing here runs the sim.

import { getMap, type MatchLog } from "@kbattle/core";
import { createAgentLayer } from "./agents";
import type { Transform } from "./coords";
import type { DrawnAgent } from "./debug";
import { indexLog, type LogIndex } from "./log-index";
import { drawMap } from "./map";
import { createStage } from "./stage";
import "./replay.css";

export interface ReplayViewer {
  readonly index: LogIndex;
  /** The tick on screen, as last passed to render. */
  readonly tick: number;
  /** The meters-to-pixels transform right now. */
  readonly transform: Transform;
  /** Shows the frame of `tick` (O(1), see LogIndex.byTick). */
  render(tick: number): void;
  drawnAgents(): DrawnAgent[];
}

/** Builds the replay of `log` inside `host` (any sized element) and shows tick 0. */
export async function mountReplay(host: HTMLElement, log: MatchLog): Promise<ReplayViewer> {
  const map = getMap(log.config.mapId);
  const index = indexLog(log);

  const root = document.createElement("div");
  root.className = "replay";
  const stageHost = document.createElement("div");
  stageHost.className = "replay-stage";
  root.append(stageHost);
  host.append(root);

  const stage = await createStage(stageHost, map.width, map.height);
  const agents = createAgentLayer((id) => index.kindOf(id));
  stage.world.addChild(drawMap(map), agents.view);
  agents.setPixelsPerMeter(stage.transform.scale);
  stage.onResize((t) => agents.setPixelsPerMeter(t.scale));

  let tick = 0;
  const render = (t: number) => {
    agents.render(index.byTick(t));
    tick = t;
  };
  render(0);

  return {
    index,
    get tick() {
      return tick;
    },
    get transform() {
      return stage.transform;
    },
    render,
    drawnAgents: () => agents.drawn(),
  };
}
