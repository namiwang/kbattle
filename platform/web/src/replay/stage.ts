// The Pixi canvas of the replay: one Application sized to its host element, and
// a `world` container in map meters that the meters-to-pixels transform places
// and scales (DESIGN.md §6.1: y down, so no flip). Resizing the window refits
// the transform; the aspect never changes. With a camera center set (follow,
// camera.ts) the world keeps the fitted zoom and puts that point mid-canvas.

import type { Vec2 } from "@decision-arena/kit-shooter";
import { Application, Container } from "pixi.js";
import { cameraTransform } from "./camera";
import { makeTransform, type Transform } from "./coords";
import { COLORS, STAGE_PAD_PX } from "./theme";

export interface Stage {
  readonly app: Application;
  /** Everything drawn in map meters goes in here. */
  readonly world: Container;
  /** The transform the world uses right now: the fitted arena, or that zoom centered on the camera center. */
  readonly transform: Transform;
  /** Puts map point `center` at the middle of the canvas at the fitted zoom; null shows the whole arena. */
  setCenter(center: Vec2 | null): void;
  /** Called after every resize with the new transform. */
  onResize(listener: (transform: Transform) => void): void;
  /** Stops watching the host, then destroys the Pixi app, its scene and its canvas. */
  destroy(): void;
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
  const observer = new ResizeObserver(() => app.queueResize());
  observer.observe(host);

  const world = new Container({ label: "world" });
  app.stage.addChild(world);

  let center: Vec2 | null = null;
  const place = (): Transform => {
    const { width, height } = app.screen;
    const t = cameraTransform(makeTransform(mapW, mapH, width, height, STAGE_PAD_PX), center, width, height);
    world.position.set(t.offsetX, t.offsetY);
    world.scale.set(t.scale);
    return t;
  };
  let transform = place();
  const listeners: ((t: Transform) => void)[] = [];
  app.renderer.on("resize", () => {
    transform = place();
    for (const listener of listeners) listener(transform);
  });

  return {
    app,
    world,
    get transform() {
      return transform;
    },
    setCenter(next) {
      if (next === null ? center === null : center !== null && next.x === center.x && next.y === center.y) return;
      center = next && { x: next.x, y: next.y };
      transform = place();
    },
    onResize(listener) {
      listeners.push(listener);
    },
    destroy() {
      observer.disconnect();
      listeners.length = 0;
      // Stops the ticker, removes Pixi's window and document listeners, loses the WebGL
      // context. releaseGlobalResources empties Pixi's global pools, which would otherwise
      // keep batches and textures of this dead renderer; fine while the page holds one app.
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    },
  };
}
