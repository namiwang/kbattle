// Playback controls under the canvas, bound to a Clock: play/pause button,
// speed select, timeline scrub, tick readout `N / M`. Keyboard: space toggles,
// ←/→ step one tick. Widgets only call the clock; sync() redraws them from it.

import { SPEEDS, type Clock } from "./clock";

export interface Controls {
  readonly element: HTMLElement;
  /** Brings the widgets in line with the clock. Cheap when nothing changed; call every frame. */
  sync(): void;
}

export function createControls(clock: Clock, keys: Document = document): Controls {
  const element = document.createElement("div");
  element.className = "replay-controls";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "replay-play";

  const speed = document.createElement("select");
  speed.className = "replay-speed";
  speed.setAttribute("aria-label", "Speed");
  for (const s of SPEEDS) speed.append(new Option(`${s}×`, String(s)));

  const timeline = document.createElement("input");
  timeline.type = "range";
  timeline.className = "replay-timeline";
  timeline.setAttribute("aria-label", "Timeline");
  timeline.min = "0";
  timeline.max = String(clock.lastTick);
  timeline.step = "1";

  const readout = document.createElement("span");
  readout.className = "replay-readout";

  element.append(play, speed, timeline, readout);

  play.addEventListener("click", () => clock.toggle());
  speed.addEventListener("change", () => clock.setSpeed(Number(speed.value)));
  timeline.addEventListener("input", () => clock.seek(Number(timeline.value)));
  keys.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    // Leave keys alone where they type or pick something.
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLInputElement && target.type !== "range") return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    if (event.key === " ") {
      // A focused button clicks itself on space. Chromium cancels that click when keydown is
      // prevented, other engines may not; leaving it to the button toggles once everywhere.
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault(); // no page scroll
      clock.toggle();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); // a focused timeline would move on its own as well
      clock.step(event.key === "ArrowRight" ? 1 : -1);
    }
  });

  let shownTick = -1;
  let shownPlaying: boolean | undefined;
  let shownSpeed: number | undefined;
  const sync = () => {
    if (clock.tick !== shownTick) {
      shownTick = clock.tick;
      readout.textContent = `${clock.tick} / ${clock.lastTick}`;
      // While the thumb is held, the pointer owns it; it is rewritten on the next tick after release.
      if (timeline.matches(":active")) shownTick = -1;
      else timeline.value = String(clock.tick);
    }
    if (clock.playing !== shownPlaying) {
      shownPlaying = clock.playing;
      play.textContent = clock.playing ? "Pause" : "Play";
    }
    if (clock.speed !== shownSpeed) {
      shownSpeed = clock.speed;
      speed.value = String(clock.speed);
    }
  };
  sync();

  return { element, sync };
}
