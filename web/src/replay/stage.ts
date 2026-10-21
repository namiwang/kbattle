// The Pixi canvas of the replay: one Application sized to its host element, and
// a `world` container in map meters that the meters-to-pixels transform places
// and scales (DESIGN.md §6.1: y down, so no flip). Resizing the window refits
// the transform; the aspect never changes.

import { Application, Container } from "pixi.js";
import { makeTransform, type Transform } from "./coords";
import { COLORS, STAGE_PAD_PX } from "./theme";

export interface Stage {
  readonly app: Application;
  /** Everything drawn in map meters goes in here. */
  readonly world: Container;
  /** The transform the world uses right now. */
  readonly transform: Transform;
  /** Called after every resize with the new transform. */
  onResize(listener: (transform: Transform) => void): void;
}

export async function createStage(host: HTMLElement, mapW: number, mapH: number): Promise<Stage> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: COLORS.background,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: "webgl",
  });
  host.append(app.canvas);
  // resizeTo only listens to the window; this also catches layout changes around the host.
  new ResizeObserver(() => app.queueResize()).observe(host);

  const world = new Container({ label: "world" });
  app.stage.addChild(world);

  const fit = (): Transform => {
    const t = makeTransform(mapW, mapH, app.screen.width, app.screen.height, STAGE_PAD_PX);
    world.position.set(t.offsetX, t.offsetY);
    world.scale.set(t.scale);
    return t;
  };
  let transform = fit();
  const listeners: ((t: Transform) => void)[] = [];
  app.renderer.on("resize", () => {
    transform = fit();
    for (const listener of listeners) listener(transform);
  });

  return {
    app,
    world,
    get transform() {
      return transform;
    },
    onResize(listener) {
      listeners.push(listener);
    },
  };
}
