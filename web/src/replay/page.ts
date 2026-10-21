// The replay page (DESIGN.md §7 items 5 and 6): a file bar (Upload, Download,
// the open file), the replay viewer under it, a drop zone over the whole page,
// a loading state and an error box. Opening a file replaces the viewer
// (destroy, then mount) without a page reload, back at tick 0; a file that
// does not open leaves the replay on screen as it was.

import type { MatchLog } from "@kbattle/core";
import { createErrorBox, formatFileError } from "./errors";
import { downloadMatchLog, parseMatchLogText, pickJsonFile } from "./files";
import { mountReplay, type ReplayViewer } from "./viewer";
import "./replay.css";

export interface ReplayPage {
  /** The replay on screen; undefined before the first log opens. */
  readonly viewer: ReplayViewer | undefined;
  /** True once a log is open and its first frame drawn; false while a file loads. */
  readonly ready: boolean;
  /**
   * Opens `file` in place of the replay on screen. Resolves true once its first frame is
   * drawn, false when it did not open (the error box says why). Opens run one at a time.
   * Each open that succeeds records the performance measures `replay-parse` (read and
   * validate) and `replay-open` (file in hand to the first frame of the new log rendered).
   */
  open(file: File): Promise<boolean>;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function button(label: string, className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  return b;
}

export function createReplayPage(host: HTMLElement): ReplayPage {
  const element = document.createElement("div");
  element.className = "replay-page";

  const bar = document.createElement("div");
  bar.className = "replay-files";
  const upload = button("Upload", "replay-upload");
  const download = button("Download", "replay-download");
  download.disabled = true;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  const status = document.createElement("span");
  status.className = "replay-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "No replay open";
  bar.append(upload, download, input, status);

  const main = document.createElement("div");
  main.className = "replay-main";
  const viewerHost = document.createElement("div");
  viewerHost.className = "replay-host";
  const errorBox = createErrorBox();
  main.append(viewerHost, errorBox.element);

  const dropZone = document.createElement("div");
  dropZone.className = "replay-drop";
  dropZone.textContent = "Drop a replay .json file to open it";
  dropZone.hidden = true;

  element.append(bar, main, dropZone);
  host.append(element);

  let viewer: ReplayViewer | undefined;
  let log: MatchLog | undefined;
  let fileName = "";
  let ready = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(file: File): Promise<boolean> {
    const start = performance.now();
    ready = false;
    errorBox.hide();
    element.classList.add("is-loading");
    element.setAttribute("aria-busy", "true");
    status.textContent = `Loading ${file.name}…`;
    try {
      // Parsing blocks the thread (DESIGN.md §5.3: 3 to 5 MB per match). Waiting two frames
      // first lets the browser paint "Loading…" before it does.
      await nextFrame();
      await nextFrame();
      const parseStart = performance.now();
      const result = parseMatchLogText(await file.text());
      if (!result.ok) {
        errorBox.show(`Could not open ${file.name}`, formatFileError(result.error));
        return false;
      }
      performance.measure("replay-parse", { start: parseStart });
      const previous = viewer;
      viewer = undefined;
      log = undefined;
      previous?.destroy();
      viewer = await mountReplay(viewerHost, result.log);
      log = result.log;
      fileName = file.name;
      await viewer.firstFrame;
      performance.measure("replay-open", { start });
      // The next frame starts once the browser has drawn that one: tick 0 is on screen.
      await nextFrame();
      return true;
    } catch (error) {
      console.error(error);
      errorBox.show(`Could not show ${file.name}`, error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      element.classList.remove("is-loading");
      element.removeAttribute("aria-busy");
      status.textContent = log ? `${fileName} · ${log.config.mapId} · seed ${log.seed}` : "No replay open";
      download.disabled = log === undefined;
      ready = viewer !== undefined;
    }
  }

  const page: ReplayPage = {
    get viewer() {
      return viewer;
    },
    get ready() {
      return ready;
    },
    open(file) {
      const run = queue.then(() => load(file));
      queue = run;
      return run;
    },
  };

  const openPicked = (files: ArrayLike<File>) => {
    const picked = pickJsonFile(files);
    if (!picked.ok) {
      errorBox.show("Nothing opened", picked.message);
      return;
    }
    void page.open(picked.file).then((opened) => {
      // Focus left on Upload would make the next space press open the file picker again
      // instead of playing the new replay.
      const focused = document.activeElement;
      if (opened && focused instanceof HTMLElement && bar.contains(focused)) focused.blur();
    });
  };

  upload.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files && input.files.length > 0) openPicked(input.files);
    input.value = ""; // choosing the same file again still fires change
  });
  download.addEventListener("click", () => {
    if (log) downloadMatchLog(log);
  });

  // The drop zone is the whole page. dragenter and dragleave fire for every element the
  // pointer crosses, so a depth count tells when the drag has left the page.
  let dragDepth = 0;
  const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;
  window.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    dropZone.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); // accepts the drop; otherwise the browser opens the file in this tab
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropZone.hidden = true;
    openPicked(event.dataTransfer?.files ?? []);
  });

  return page;
}
