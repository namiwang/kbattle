// Headless browser smoke for the page. Not part of `pnpm test`; run
// `pnpm --filter web smoke`. Starts Vite on port 5174 (or opens DECISION_ARENA_URL),
// loads the page in Playwright's chromium, waits for window.__decisionArena.ready,
// checks canvas pixels against the sample log and the map, resizes the window,
// then drives the playback controls (keyboard, buttons, timeline drag, every
// speed) and checks the scene against the log at each stop. Then the UI shell
// (v4.1): key, prompts and match form survive a reload, Clear key and no-key
// mode, the form check through window.__decisionArena.validateForm(). Then the files
// (v2.5): uploads through the file input (good, schema-bad, not JSON), checks
// that each re-mount leaves no listener, observer or WebGL context behind,
// downloads and re-opens the log, drops a file, and times a 5 MB upload.
// Between playback and the UI shell, the v2.3 view row: bullet dots and trails
// against the Tick rows (trails gone within N ticks), the follow camera, the
// vision-cone overlay against core.perceive at every tick, and frame timing at
// 1x with trails and overlay on; at the end the same on a busy 16-agent log,
// then on a real 16-bot match (the one the kit's scripts/run-match.ts writes):
// incoming-fire ticks against the log's hits and near-miss rows, a death,
// resizing while following, and re-mounting with everything on.
// Before the files, the v2.4 mind panel: following a0 it shows the log's plan,
// doer answers and perception for the tick on screen (against mindView computed
// here), and beside the answers the perception they were decided on ("saw at
// tick T − 1, answered at tick T", R18), within one frame of every scrub and
// under 8 ms per update; the fault
// line at the thinker refusal and "kept from tick" at the doer timeout; markers
// under the timeline on the right ticks, linked requested/applied pairs, clicks
// that seek; beside the canvas on wide windows, below it on narrow ones.
// Screenshots and the downloaded file go to platform/web/.smoke/. Exits 1 if any check
// fails.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  eventsOfKind,
  MATCH_DURATION_TICKS,
  MatchConfigSchema,
  MatchLogSchema,
  type Event as LogEvent,
  type MatchLog,
  type Slot,
} from "@decision-arena/core/legacy";
import { botProviders, getMap, normalizeDeg, PERCEPTION_WINDOW_TICKS, perceive, runMatch, vec2, type Vec2 } from "@decision-arena/kit-shooter";
import { chromium, type Locator, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { TRAIL_TICKS, type DrawnBullets } from "../src/replay/bullets";
import { makeTransform } from "../src/replay/coords";
import type { DecisionArenaDebug, DrawnAgent } from "../src/replay/debug";
import { indexLog, type LogIndex } from "../src/replay/log-index";
import {
  answerSummary,
  formatProbability,
  markerShapes,
  markersFor,
  mindView,
  perceptionLines,
  type DrawnMind,
  type MarkerShape,
} from "../src/replay/mind-selectors";
import { overlayModel, type DrawnOverlay } from "../src/replay/overlay";
import { stateFromTick } from "../src/replay/state-from-tick";
import { BULLET, COLORS, KIND_COLORS, MARKER, OVERLAY, STAGE_PAD_PX } from "../src/replay/theme";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(webDir, ".smoke");
const samplePath = join(webDir, "../../kits/shooter/fixtures/sample-log.json");
const badPath = join(webDir, "../../kits/shooter/fixtures/bad/unknown-event-kind.json"); // one issue, at events[5].kind
const log = MatchLogSchema.parse(JSON.parse(readFileSync(samplePath, "utf8")));
const map = getMap(log.config.mapId);
const frames = new Map(eventsOfKind(log, "Tick").map((e) => [e.tick, e]));
const lastTick = Math.max(...frames.keys());

const TOLERANCE = 12; // per RGB channel, for antialiasing
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`);
}

type Rgb = [number, number, number];
const rgb = (c: number): Rgb => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const hex = (c: Rgb | undefined) => (c ? `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}` : "none");

/** Reads the hook's plain values; functions on it are called through page.evaluate. */
async function state(page: Page): Promise<Pick<DecisionArenaDebug, "ready" | "tick" | "lastTick" | "scale">> {
  return page.evaluate(() => {
    const k = window.__decisionArena;
    if (!k) throw new Error("window.__decisionArena missing");
    return { ready: k.ready, tick: k.tick, lastTick: k.lastTick, scale: k.scale };
  });
}

async function toPx(page: Page, points: Vec2[]): Promise<Vec2[]> {
  return page.evaluate((pts) => pts.map((p) => window.__decisionArena?.toPx(p) ?? { x: Number.NaN, y: Number.NaN }), points);
}

async function drawnAgents(page: Page): Promise<DrawnAgent[]> {
  return page.evaluate(() => window.__decisionArena?.drawnAgents() ?? []);
}

async function frames2(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

interface Probe {
  name: string;
  at: Vec2;
  want: number;
  absent?: boolean; // pass when the color is NOT found
}

/** Looks for `want` in the 3x3 pixels around each probe point of a canvas screenshot. */
async function probe(page: Page, png: Buffer, probes: Probe[]): Promise<void> {
  const samples = await page.evaluate(
    async ({ b64, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      return points.map(({ x, y }) => Array.from(ctx.getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data));
    },
    { b64: png.toString("base64"), points: probes.map((p) => p.at) },
  );
  probes.forEach((p, i) => {
    const data = samples[i] ?? [];
    const pixels: Rgb[] = [];
    for (let k = 0; k + 2 < data.length; k += 4) pixels.push([data[k] ?? 0, data[k + 1] ?? 0, data[k + 2] ?? 0]);
    const want = rgb(p.want);
    const found = pixels.some((px) => px.every((v, c) => Math.abs(v - (want[c] ?? 0)) <= TOLERANCE));
    const detail = `px ${Math.round(p.at.x)},${Math.round(p.at.y)} center ${hex(pixels[4])}, ${p.absent ? "must not be" : "want"} ${hex(want)}`;
    check(p.name, p.absent ? !found : found, detail);
  });
}

const kindOf = (id: string) => log.config.slots[Number(id.slice(1))]?.kind;

/** Checks that the canvas shows `tick`: agent bodies, facing lines, every obstacle, floor, letterbox. */
async function checkFrame(page: Page, label: string, tick: number, file: string): Promise<void> {
  const frame = frames.get(tick);
  if (!frame) throw new Error(`sample log has no Tick ${tick}`);

  const drawn = await drawnAgents(page);
  const want = frame.agents.map(([id, x, y, facing]) => ({ id, x, y, facing }));
  const same =
    drawn.length === want.length &&
    want.every((w) => {
      const d = drawn.find((a) => a.id === w.id);
      return d && Math.abs(d.x - w.x) < 1e-9 && Math.abs(d.y - w.y) < 1e-9 && Math.abs(d.facing - w.facing) < 1e-6;
    });
  check(`${label}: scene graph holds exactly the agents of Tick ${tick}`, same, JSON.stringify(drawn));

  // Facing convention (§6.1: 0° = +x, clockwise with y down), through Pixi's own transforms.
  const tipsWant = await toPx(page, frame.agents.map(([, x, y]) => ({ x, y })));
  frame.agents.forEach(([id, , , facing], i) => {
    const c = tipsWant[i] ?? { x: Number.NaN, y: Number.NaN };
    const rad = (facing * Math.PI) / 180;
    const want = { x: c.x + MARKER.facingLengthPx * Math.cos(rad), y: c.y + MARKER.facingLengthPx * Math.sin(rad) };
    const got = drawn.find((a) => a.id === id)?.tip;
    const ok = got !== undefined && Math.abs(got.x - want.x) < 0.05 && Math.abs(got.y - want.y) < 0.05;
    check(`${label}: ${id} facing line points at ${facing}°`, ok, `tip ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  });

  const png = await page.locator("canvas").screenshot();
  writeFileSync(join(outDir, file), png);
  const centers = await toPx(page, frame.agents.map(([, x, y]) => ({ x, y })));
  const probes: Probe[] = [];
  frame.agents.forEach(([id, , , facing], i) => {
    const c = centers[i] ?? { x: Number.NaN, y: Number.NaN };
    const rad = (facing * Math.PI) / 180; // 0° = +x, clockwise with y down (§6.1)
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const kind = kindOf(id);
    const body = { x: c.x - dir.y * 3.5, y: c.y + dir.x * 3.5 }; // beside the facing line, inside the dot
    probes.push(
      { name: `${label}: ${id} body in ${kind} color`, at: body, want: kind ? KIND_COLORS[kind] : COLORS.unknownKind },
      { name: `${label}: ${id} facing line ahead (${facing}°)`, at: { x: c.x + dir.x * 11, y: c.y + dir.y * 11 }, want: COLORS.facing },
      { name: `${label}: ${id} no facing line behind`, at: { x: c.x - dir.x * 11, y: c.y - dir.y * 11 }, want: COLORS.facing, absent: true },
    );
  });
  const centroids = map.obstacles.map((o) => ({
    x: o.vertices.reduce((s, v) => s + v.x, 0) / o.vertices.length,
    y: o.vertices.reduce((s, v) => s + v.y, 0) / o.vertices.length,
  }));
  const [floor, ...obstaclePx] = await toPx(page, [{ x: 10, y: 10 }, ...centroids]);
  obstaclePx.forEach((at, i) => probes.push({ name: `${label}: obstacle ${i} drawn`, at, want: COLORS.obstacle }));
  probes.push({ name: `${label}: floor at (10, 10) m`, at: floor ?? { x: 0, y: 0 }, want: COLORS.floor });
  probes.push({ name: `${label}: letterbox margin`, at: { x: 3, y: 3 }, want: COLORS.background });
  const gone = (frames.get(tick - 1)?.agents ?? []).filter(([id]) => !frame.agents.some(([alive]) => alive === id));
  const gonePx = await toPx(page, gone.map(([, x, y]) => ({ x, y })));
  gone.forEach(([id], i) => {
    const kind = kindOf(id);
    const at = gonePx[i] ?? { x: 0, y: 0 };
    probes.push({ name: `${label}: ${id} (dead) no longer drawn`, at, want: kind ? KIND_COLORS[kind] : COLORS.unknownKind, absent: true });
  });
  await probe(page, png, probes);
}

async function checkAspect(page: Page, label: string): Promise<void> {
  const [o, right, down] = await toPx(page, [
    { x: 0, y: 0 },
    { x: map.width, y: 0 },
    { x: 0, y: map.height },
  ]);
  const s = await state(page);
  const dx = (right?.x ?? 0) - (o?.x ?? 0);
  const dy = (down?.y ?? 0) - (o?.y ?? 0);
  check(`${label}: meters-to-pixels aspect kept`, Math.abs(dx / map.width - dy / map.height) < 1e-9 && s.scale > 0, `${dx} px wide, ${dy} px high, scale ${s.scale}`);
  const size = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { canvasW: c?.clientWidth, canvasH: c?.clientHeight, parentW: c?.parentElement?.clientWidth, parentH: c?.parentElement?.clientHeight };
  });
  check(`${label}: canvas fills its host`, size.canvasW === size.parentW && size.canvasH === size.parentH, JSON.stringify(size));
}

// ---- playback controls (v2.2) ----

const playButton = (page: Page) => page.getByRole("button", { name: /^(Play|Pause)$/ });
const timeline = (page: Page) => page.getByRole("slider", { name: "Timeline" });
const speedSelect = (page: Page) => page.getByRole("combobox", { name: "Speed" });

async function readout(page: Page): Promise<string> {
  return ((await page.locator(".replay-readout").textContent()) ?? "").trim();
}

/** Sets the timeline like a scrub (input event), then lets two frames render. */
async function scrubTo(page: Page, tick: number): Promise<void> {
  await timeline(page).evaluate((el, value) => {
    (el as HTMLInputElement).value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, tick);
  await frames2(page);
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Tick on screen, readout and timeline agree; the scene graph holds that Tick's agents. */
async function checkInSync(page: Page, label: string): Promise<number> {
  const { tick } = await state(page);
  const text = await readout(page);
  const slider = Number(await timeline(page).inputValue());
  check(`${label}: readout and timeline show the tick on screen`, text === `${tick} / ${lastTick}` && slider === tick, `tick ${tick}, readout "${text}", timeline ${slider}`);
  const frame = frames.get(tick);
  const drawn = await drawnAgents(page);
  const ok =
    frame !== undefined &&
    drawn.length === frame.agents.length &&
    frame.agents.every(([id, x, y, facing]) => {
      const d = drawn.find((a) => a.id === id);
      return d && Math.abs(d.x - x) < 1e-9 && Math.abs(d.y - y) < 1e-9 && Math.abs(d.facing - facing) < 1e-6;
    });
  check(`${label}: agents drawn at the positions of Tick ${tick}`, ok, JSON.stringify(drawn.map((a) => [a.id, a.x, a.y])));
  return tick;
}

async function checkPlayback(page: Page): Promise<void> {
  check("controls start paused at 0", (await readout(page)) === `0 / ${lastTick}` && (await playButton(page).textContent()) === "Play", await readout(page));

  // Space on the page plays; the button flips to Pause; ticks advance.
  await blur(page);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1000);
  const playingTick = (await state(page)).tick;
  check("space plays: the tick advances", playingTick > 0 && (await playButton(page).textContent()) === "Pause", `tick ${playingTick} after 1 s at 1x`);

  // Pause freezes the tick on the next frame and keeps it.
  await playButton(page).click();
  const pausedAt = (await state(page)).tick;
  await frames2(page);
  const afterTwoFrames = (await state(page)).tick;
  await page.waitForTimeout(400);
  const later = (await state(page)).tick;
  check("pause stops the renderer within one frame", afterTwoFrames === pausedAt && later === pausedAt, `${pausedAt} -> ${afterTwoFrames} -> ${later}`);
  await checkInSync(page, "paused");

  // Space with the play button focused toggles once (no double toggle).
  await playButton(page).click(); // plays, keeps focus
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  check("space on the focused play button toggles exactly once", (await playButton(page).textContent()) === "Play");

  // Drag the timeline thumb past its right end: jumps straight to the last tick.
  const box = await timeline(page).boundingBox();
  if (!box) throw new Error("timeline not visible");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width + 20, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await frames2(page);
  check("dragging the timeline to the end shows the last tick", (await state(page)).tick === lastTick, await readout(page));
  await checkInSync(page, "dragged to end");
  await checkFrame(page, `tick ${lastTick}`, lastTick, `tick${lastTick}.png`);

  // Scrub back to 140 (off-axis facings), then step with the arrow keys.
  await scrubTo(page, 140);
  await checkFrame(page, "tick 140", 140, "tick140.png");
  await blur(page);
  await page.keyboard.press("ArrowRight");
  await frames2(page);
  const right = (await state(page)).tick;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await frames2(page);
  const left = (await state(page)).tick;
  check("ArrowRight / ArrowLeft step one tick", right === 141 && left === 139, `140 -> ${right} -> ${left}`);
  await timeline(page).focus();
  await page.keyboard.press("ArrowRight");
  await frames2(page);
  check("ArrowRight on the focused timeline steps one tick, not two", (await state(page)).tick === 140, await readout(page));
  await checkInSync(page, "after stepping");

  // Every speed: play ~600 ms from 0, pause, positions match the tick on screen.
  const advanced = new Map<string, number>();
  for (const speed of ["0.25", "0.5", "1", "2", "4"]) {
    await speedSelect(page).selectOption(speed);
    await scrubTo(page, 0);
    await playButton(page).click();
    await page.waitForTimeout(600);
    await playButton(page).click();
    await frames2(page);
    const tick = await checkInSync(page, `${speed}x`);
    advanced.set(speed, tick);
  }
  const at = (s: string) => advanced.get(s) ?? 0;
  check("every speed plays; faster covers more ticks", at("0.25") > 0 && at("0.25") < at("1") && at("1") < at("4"), JSON.stringify(Object.fromEntries(advanced)));

  // Play through to the end at 2x: the tick never goes back, ends on the last tick, then pauses.
  await speedSelect(page).selectOption("2");
  await scrubTo(page, 100);
  // A string, not a callback: tsx (esbuild keepNames) would wrap a named inner function in a
  // __name() helper that does not exist in the page.
  await page.evaluate(`(() => {
    const seen = (window.__seen = []);
    const sample = () => {
      seen.push(window.__decisionArena ? window.__decisionArena.tick : -1);
      if (seen.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);
  await playButton(page).click();
  await page.waitForFunction((last) => document.querySelector(".replay-readout")?.textContent?.trim() === `${last} / ${last}`, lastTick, { timeout: 10_000 });
  await page.waitForTimeout(200);
  const seen = await page.evaluate(() => (window as unknown as { __seen: number[] }).__seen.slice());
  const forward = seen.every((t, i) => i === 0 || t >= (seen[i - 1] ?? 0));
  const distinct = new Set(seen).size;
  check("play runs to the last tick without going back", forward && seen.at(-1) === lastTick, `${distinct} distinct ticks over ${seen.length} frames, ${seen[0]}..${seen.at(-1)}`);
  check("playing stops at the last tick", (await playButton(page).textContent()) === "Play" && (await state(page)).tick === lastTick);
  await checkInSync(page, "end of play");

  // Play at the end starts over from tick 0.
  await blur(page);
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await frames2(page);
  const restarted = (await state(page)).tick;
  check("play at the last tick starts over from 0", restarted < 40, `tick ${restarted}`);
}

// ---- bullets, follow camera, vision-cone overlay (v2.3) ----

const followSelect = (page: Page) => page.getByRole("combobox", { name: "Follow" });
const trailsBox = (page: Page) => page.getByRole("checkbox", { name: "Trails" });
const coneBox = (page: Page) => page.getByRole("checkbox", { name: "Vision cone" });

async function drawnBullets(page: Page): Promise<DrawnBullets> {
  return page.evaluate(() => window.__decisionArena?.drawnBullets() ?? { dots: [], trails: [] });
}

async function drawnOverlay(page: Page): Promise<DrawnOverlay | null> {
  return page.evaluate(() => window.__decisionArena?.drawnOverlay() ?? null);
}

async function canvasCenter(page: Page): Promise<Vec2> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { x: (c?.clientWidth ?? Number.NaN) / 2, y: (c?.clientHeight ?? Number.NaN) / 2 };
  });
}

/** Where a marker's center is on the canvas, through Pixi's own transforms: its facing tip minus the facing line. */
function markerCenter(a: DrawnAgent): Vec2 {
  const rad = (a.facing * Math.PI) / 180;
  return { x: a.tip.x - MARKER.facingLengthPx * Math.cos(rad), y: a.tip.y - MARKER.facingLengthPx * Math.sin(rad) };
}

/** `over` drawn at `alpha` on top of `under`, as the canvas composites it. */
function blend(under: number, over: number, alpha: number): number {
  const [a, b] = [rgb(under), rgb(over)];
  const mix = (i: number) => Math.round((a[i] ?? 0) * (1 - alpha) + (b[i] ?? 0) * alpha);
  return (mix(0) << 16) | (mix(1) << 8) | mix(2);
}

/** The point `meters` away from `from` at absolute angle `deg` (§6.1). */
const along = (from: Vec2, deg: number, meters: number): Vec2 => vec2.add(from, vec2.scale(vec2.fromAngle(deg), meters));

/** What the overlay must show for `agent` at `tick` of `matchLog`, computed here in Node with core.perceive. */
function overlayOf(index: LogIndex, matchLog: MatchLog, tick: number, agent: string): DrawnOverlay {
  const m = overlayModel(stateFromTick(index, matchLog, tick), agent);
  return { tick, agent, cone: m.cone.length >= 3, visible: m.seen.map((x) => x.id), incoming: [...m.incoming] };
}

const sampleIndex = indexLog(log);
const expectedOverlay = (tick: number, agent: string) => overlayOf(sampleIndex, log, tick, agent);

/** True when bullet `id` is in a Tick row within the trail window ending at `tick` (the last TRAIL_TICKS ticks). */
function inTrailWindow(id: string, tick: number): boolean {
  for (let t = Math.max(0, tick - TRAIL_TICKS + 1); t <= tick; t++) if (frames.get(t)?.bullets.some(([b]) => b === id)) return true;
  return false;
}

interface FrameSample {
  tick: number;
  follow: string | null;
  bullets: DrawnBullets;
  overlay: DrawnOverlay | null;
  agents: DrawnAgent[];
  center: Vec2;
  /** The mind panel as drawn in that frame (v2.4). */
  mind: DrawnMind | null;
}

/** Records the debug hook's view in `count` consecutive animation frames (a string script: tsx/__name, see checkPlayback). */
async function sampleFrames(page: Page, count: number): Promise<FrameSample[]> {
  await page.evaluate(`(() => {
    const k = window.__decisionArena;
    const canvas = document.querySelector("canvas");
    const samples = (window.__samples = []);
    const sample = () => {
      samples.push({
        tick: k.tick,
        follow: k.follow,
        bullets: k.drawnBullets(),
        overlay: k.drawnOverlay(),
        agents: k.drawnAgents(),
        center: { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
        mind: k.drawnMind ? k.drawnMind() : null,
      });
      if (samples.length < ${count}) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);
  await page.waitForFunction((n) => ((window as unknown as { __samples?: unknown[] }).__samples?.length ?? 0) >= n, count, { timeout: 20_000 });
  return page.evaluate(() => (window as unknown as { __samples: FrameSample[] }).__samples);
}

interface FrameTiming {
  frames: number;
  fps: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over20Ms: number;
  /** Main-thread busy time per frame (CDP TaskDuration) and the script part of it. */
  taskMsPerFrame: number;
  scriptMsPerFrame: number;
}

/** Plays from `fromTick` at 1x for `ms` and measures the animation-frame intervals and main-thread time. */
async function timePlayback(page: Page, fromTick: number, ms: number): Promise<FrameTiming> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const value = (name: string) => metrics.find((m) => m.name === name)?.value ?? Number.NaN;
    return { task: value("TaskDuration"), script: value("ScriptDuration") };
  };
  await speedSelect(page).selectOption("1");
  await scrubTo(page, fromTick);
  await playButton(page).click();
  await page.waitForTimeout(250); // past the first frames after the click
  const before = await metric();
  await page.evaluate(`(() => {
    const stamps = (window.__stamps = []);
    const end = performance.now() + ${ms};
    const stamp = (t) => {
      stamps.push(t);
      if (t < end) requestAnimationFrame(stamp);
    };
    requestAnimationFrame(stamp);
  })()`);
  await page.waitForTimeout(ms + 100);
  const after = await metric();
  await playButton(page).click();
  await cdp.detach();
  const stamps = await page.evaluate(() => (window as unknown as { __stamps: number[] }).__stamps);
  const gaps = stamps.slice(1).map((t, i) => t - (stamps[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  return {
    frames: gaps.length,
    fps: 1000 / mean,
    meanMs: mean,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    maxMs: sorted.at(-1) ?? Number.NaN,
    over20Ms: gaps.filter((g) => g > 20).length,
    taskMsPerFrame: ((after.task - before.task) * 1000) / gaps.length,
    scriptMsPerFrame: ((after.script - before.script) * 1000) / gaps.length,
  };
}

const showTiming = (t: FrameTiming) =>
  `${t.fps.toFixed(1)} fps over ${t.frames} frames: mean ${t.meanMs.toFixed(2)} ms, p50 ${t.p50Ms.toFixed(2)}, p95 ${t.p95Ms.toFixed(2)}, max ${t.maxMs.toFixed(1)}, ${t.over20Ms} over 20 ms; main thread ${t.taskMsPerFrame.toFixed(2)} ms/frame (script ${t.scriptMsPerFrame.toFixed(2)})`;

/** Budget (plan v2.3): 60 fps at 1x, read as no dropped frames to speak of. */
const smooth = (t: FrameTiming) => t.meanMs < 18 && t.p95Ms < 22 && t.over20Ms <= Math.ceil(t.frames * 0.03);

async function checkOverlays(page: Page): Promise<void> {
  // The view row's defaults.
  const spawned = eventsOfKind(log, "Spawn").map((e) => e.agent);
  const choices = await followSelect(page).locator("option").allTextContents();
  check("Follow lists free and every spawned agent", isDeepStrictEqual(choices, ["free", ...spawned]), JSON.stringify(choices));
  const defaults = {
    follow: await followSelect(page).inputValue(),
    hook: (await page.evaluate(() => window.__decisionArena?.follow)) ?? null,
    trails: await trailsBox(page).isChecked(),
    cone: await coneBox(page).isChecked(),
    overlay: await drawnOverlay(page),
  };
  check("the view row starts on free, trails on, vision cone off", isDeepStrictEqual(defaults, { follow: "free", hook: null, trails: true, cone: false, overlay: null }), JSON.stringify(defaults));

  // Bullets: a dot for every bullet of the Tick on screen; trails run through at most N positions.
  const freeScale = (await state(page)).scale;
  for (const tick of [101, 113, 141]) {
    await scrubTo(page, tick);
    const drawn = await drawnBullets(page);
    const want = (frames.get(tick)?.bullets ?? []).map(([id, x, y]) => ({ id, x, y }));
    check(`tick ${tick}: a dot for every bullet of Tick ${tick}, where the row puts it`, isDeepStrictEqual(drawn.dots, want), JSON.stringify(drawn.dots));
    const lengths = drawn.trails.map(({ id, points }) => {
      let held = 0;
      for (let t = Math.max(0, tick - TRAIL_TICKS + 1); t <= tick; t++) if (frames.get(t)?.bullets.some(([b]) => b === id)) held++;
      return { id, points, held };
    });
    check(
      `tick ${tick}: each trail runs through its bullet's positions of the last ${TRAIL_TICKS} ticks`,
      lengths.length > 0 && lengths.every((l) => l.points === l.held && l.points <= TRAIL_TICKS),
      JSON.stringify(lengths),
    );
    const dotsPx = await toPx(page, want);
    await probe(
      page,
      await page.locator("canvas").screenshot(),
      want.map((b, i) => ({ name: `tick ${tick}: bullet ${b.id} drawn as a dot`, at: dotsPx[i] ?? { x: 0, y: 0 }, want: BULLET.color })),
    );
  }

  // Exit criterion: trails disappear within N ticks after the bullet is gone from Tick.
  // b3 is in the rows up to Tick 104 and hits a1 on tick 105. Step through with the arrow keys.
  await scrubTo(page, 104);
  await blur(page);
  const b3: Record<number, number | undefined> = {};
  let stray = "";
  for (let tick = 104; tick <= 112; tick++) {
    if (tick > 104) {
      await page.keyboard.press("ArrowRight");
      await frames2(page);
    }
    const drawn = await drawnBullets(page);
    b3[tick] = drawn.trails.find((t) => t.id === "b3")?.points;
    for (const { id } of drawn.trails) if (!inTrailWindow(id, tick)) stray += ` ${id}@${tick}`;
  }
  check(
    `b3 (last in Tick 104): its trail fades out after it hits and is gone by tick ${104 + TRAIL_TICKS}`,
    b3[104] === TRAIL_TICKS && b3[105] === TRAIL_TICKS - 1 && b3[109] === undefined && b3[110] === undefined && stray === "",
    `points by tick ${JSON.stringify(b3)}${stray ? `; drawn after their window:${stray}` : ""}`,
  );

  // Trails toggle: off drops the lines, keeps the dots; on brings them back.
  await scrubTo(page, 104);
  const b3x = (frames.get(103)?.bullets.find(([id]) => id === "b3") ?? ["", 0, 0]).slice(1) as [number, number];
  const b3w = (frames.get(102)?.bullets.find(([id]) => id === "b3") ?? ["", 0, 0]).slice(1) as [number, number];
  const [trailMid] = await toPx(page, [{ x: (b3x[0] + b3w[0]) / 2, y: (b3x[1] + b3w[1]) / 2 }]); // segment ending at age 1
  const trailColor = blend(COLORS.floor, BULLET.color, BULLET.trailAlpha * (1 - 1 / TRAIL_TICKS));
  await probe(page, await page.locator("canvas").screenshot(), [{ name: "trails on: the faded line behind b3 is drawn", at: trailMid ?? { x: 0, y: 0 }, want: trailColor }]);
  await trailsBox(page).uncheck();
  await frames2(page);
  const off = await drawnBullets(page);
  check("Trails off: no trail lines, the dots stay", off.trails.length === 0 && off.dots.length === (frames.get(104)?.bullets.length ?? -1), JSON.stringify(off));
  await probe(page, await page.locator("canvas").screenshot(), [
    { name: "trails off: no line behind b3", at: trailMid ?? { x: 0, y: 0 }, want: trailColor, absent: true },
    { name: "trails off: floor where the line was", at: trailMid ?? { x: 0, y: 0 }, want: COLORS.floor },
  ]);
  await trailsBox(page).check();
  await frames2(page);
  check("Trails on again: the lines come back", (await drawnBullets(page)).trails.length > 0);

  // Follow a0: the camera puts a0 mid-canvas at the fitted zoom.
  const freeOrigin = (await toPx(page, [{ x: 0, y: 0 }]))[0];
  await followSelect(page).selectOption("a0");
  await frames2(page);
  const center = await canvasCenter(page);
  const a0 = (await drawnAgents(page)).find((a) => a.id === "a0");
  const at = a0 ? markerCenter(a0) : { x: Number.NaN, y: Number.NaN };
  const s = await state(page);
  check(
    "following a0 puts its marker at the middle of the canvas (Pixi's own transforms) and keeps the zoom",
    (await page.evaluate(() => window.__decisionArena?.follow)) === "a0" && Math.hypot(at.x - center.x, at.y - center.y) < 0.5 && s.scale === freeScale,
    `marker ${at.x.toFixed(2)},${at.y.toFixed(2)} vs center ${center.x},${center.y}; scale ${s.scale} vs ${freeScale}`,
  );
  const a0Row = frames.get(104)?.agents.find(([id]) => id === "a0");
  const facing = ((a0Row?.[3] ?? 0) * Math.PI) / 180;
  await probe(page, await page.locator("canvas").screenshot(), [
    { name: "following a0: a0's body is drawn at the canvas center", at: { x: center.x - Math.sin(facing) * 3.5, y: center.y + Math.cos(facing) * 3.5 }, want: KIND_COLORS.prompted },
  ]);

  // Playing, the camera re-centers on a0 every tick.
  await scrubTo(page, 0);
  await speedSelect(page).selectOption("4");
  await playButton(page).click();
  const followed = await sampleFrames(page, 90);
  await playButton(page).click();
  const worst = followed.reduce((max, f) => {
    const a = f.agents.find((x) => x.id === "a0");
    const c = a ? markerCenter(a) : { x: Number.NaN, y: Number.NaN };
    return Math.max(max, Number.isNaN(c.x) ? Infinity : Math.hypot(c.x - f.center.x, c.y - f.center.y));
  }, 0);
  const span = `${followed[0]?.tick}..${followed.at(-1)?.tick}`;
  check("playing at 4x, a0 stays at the canvas center on every frame", worst < 0.5 && new Set(followed.map((f) => f.tick)).size > 20, `${followed.length} frames, ticks ${span}, worst ${worst.toFixed(3)} px`);

  // Vision cone on at tick 115: the cone around a0, a1 ringed, the hit by a1's b6 as a red tick.
  await speedSelect(page).selectOption("1");
  await scrubTo(page, 115);
  await coneBox(page).check();
  await frames2(page);
  const overlay = await drawnOverlay(page);
  const want115 = expectedOverlay(115, "a0");
  check(
    "vision cone on at tick 115: drawn for a0, a1 seen, one incoming tick toward a1 (as core.perceive says)",
    isDeepStrictEqual(overlay, want115) && isDeepStrictEqual(want115.visible, ["a1"]) && isDeepStrictEqual(want115.incoming, [0]),
    JSON.stringify(overlay),
  );
  const a0At = { x: 26.5, y: 50 }; // Tick 115, facing 0°
  const a1At = { x: 67.25, y: 50 };
  const [inCone, outCone, a1Px, a0Px] = await toPx(page, [along(a0At, 30, 20), along(a0At, -60, 20), a1At, a0At]);
  const tinted = blend(COLORS.floor, OVERLAY.cone, OVERLAY.coneFillAlpha);
  const conePng = await page.locator("canvas").screenshot();
  await probe(page, conePng, [
    { name: "cone on: floor inside the cone (20 m out, 30° right) is tinted", at: inCone ?? { x: 0, y: 0 }, want: tinted },
    { name: "cone on: floor outside the cone (20 m out, 60° left) is not", at: outCone ?? { x: 0, y: 0 }, want: COLORS.floor },
    { name: "cone on: a ring around a1, which a0 sees", at: { x: (a1Px?.x ?? 0), y: (a1Px?.y ?? 0) - OVERLAY.seenRingPx }, want: OVERLAY.seen },
    { name: "cone on: a red tick from a0 toward a1's fire", at: { x: (a0Px?.x ?? 0) + (OVERLAY.incomingFromPx + OVERLAY.incomingToPx) / 2, y: a0Px?.y ?? 0 }, want: OVERLAY.incoming },
  ]);
  await page.locator(".replay").screenshot({ path: join(outDir, "overlay.png") });
  writeFileSync(join(outDir, "overlay-canvas.png"), conePng);

  // Exit criterion: the overlay recomputes every tick. Playing, every frame shows the tick on
  // screen and what core.perceive says for it.
  await scrubTo(page, 95);
  await playButton(page).click();
  const played = await sampleFrames(page, 100);
  await playButton(page).click();
  const wrong = played.filter((f) => !isDeepStrictEqual(f.overlay, expectedOverlay(f.tick, "a0")));
  const ticks = new Set(played.map((f) => f.tick));
  const busy = played.filter((f) => (f.overlay?.visible.length ?? 0) > 0 || (f.overlay?.incoming.length ?? 0) > 0).length;
  check(
    "playing with the cone on, every frame's overlay is core.perceive's for the tick on screen",
    wrong.length === 0 && ticks.size > 20 && busy > 0,
    `${played.length} frames over ${ticks.size} ticks (${played[0]?.tick}..${played.at(-1)?.tick}), ${busy} with someone seen or fire incoming${wrong.length ? `; wrong at ${JSON.stringify(wrong.slice(0, 3))}` : ""}`,
  );
  const trailsOk = played.every((f) => f.bullets.trails.every(({ id }) => inTrailWindow(id, f.tick)) && isDeepStrictEqual(f.bullets.dots.map((d) => d.id), (frames.get(f.tick)?.bullets ?? []).map(([id]) => id)));
  check("playing, every frame's dots are the bullets of its Tick and no trail outlives its window", trailsOk);

  // Frame timing at 1x through the fight (ticks 60..120), everything on, then everything off.
  const on = await timePlayback(page, 60, 3000);
  await followSelect(page).selectOption("free");
  await coneBox(page).uncheck();
  await trailsBox(page).uncheck();
  const bare = await timePlayback(page, 60, 3000);
  console.log(`  timing, sample log at 1x, follow a0 + trails + vision cone: ${showTiming(on)}`);
  console.log(`  timing, sample log at 1x, free camera, no trails, no cone:   ${showTiming(bare)}`);
  check("budget: 60 fps at 1x with trails and the cone on (sample log)", smooth(on), showTiming(on));

  // Toggle the cone off: gone from the canvas; free camera: the fitted arena again.
  await trailsBox(page).check();
  await followSelect(page).selectOption("a0");
  await coneBox(page).check();
  await scrubTo(page, 115);
  await coneBox(page).uncheck();
  await frames2(page);
  const [inConeOff] = await toPx(page, [along(a0At, 30, 20)]);
  check("cone off: nothing in the overlay", (await drawnOverlay(page)) === null);
  await probe(page, await page.locator("canvas").screenshot(), [{ name: "cone off: the floor inside the old cone is plain again", at: inConeOff ?? { x: 0, y: 0 }, want: COLORS.floor }]);

  // A dead followed agent: centered where it was last seen, no cone, sees nothing.
  await followSelect(page).selectOption("a1");
  await coneBox(page).check();
  await scrubTo(page, lastTick);
  const deadAt = frames.get(lastTick - 1)?.agents.find(([id]) => id === "a1");
  const [deadPx] = await toPx(page, [{ x: deadAt?.[1] ?? 0, y: deadAt?.[2] ?? 0 }]);
  const mid = await canvasCenter(page);
  const deadOverlay = await drawnOverlay(page);
  check(
    `following a1 after its death (tick ${lastTick}): centered on its last position, no cone, nothing seen`,
    Math.hypot((deadPx?.x ?? 0) - mid.x, (deadPx?.y ?? 0) - mid.y) < 0.5 && isDeepStrictEqual(deadOverlay, expectedOverlay(lastTick, "a1")) && deadOverlay?.cone === false,
    JSON.stringify(deadOverlay),
  );

  await coneBox(page).uncheck();
  await followSelect(page).selectOption("free");
  await scrubTo(page, 0);
  const back = (await toPx(page, [{ x: 0, y: 0 }]))[0];
  check("free again: the arena is fitted as before following", back?.x === freeOrigin?.x && back?.y === freeOrigin?.y && (await state(page)).scale === freeScale, `${JSON.stringify(back)} vs ${JSON.stringify(freeOrigin)}`);
}

// ---- UI shell (v4.1): key, mind, match form, localStorage ----

const STORED = Object.freeze({ key: "decision-arena:v1:anthropic-key", prompts: "decision-arena:v1:prompts", config: "decision-arena:v1:config" });
const SMOKE_KEY = "sk-ant-smoke-not-a-real-key";

async function stored(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), Object.values(STORED));
}

/** Runs the check behind Run match through the debug hook; returns the text it shows. */
async function validateForm(page: Page): Promise<string> {
  return page.evaluate(() => window.__decisionArena?.validateForm() ?? "window.__decisionArena missing");
}

const parsed = (text: string | null | undefined): Record<string, unknown> => (text ? (JSON.parse(text) as Record<string, unknown>) : {});

async function checkUiShell(page: Page): Promise<void> {
  const key = page.getByLabel("Anthropic API key");
  const thinker = page.getByLabel("Thinker system prompt");
  const move = page.getByLabel("Move", { exact: true });
  const map = page.getByLabel("Map", { exact: true });
  const seed = page.getByLabel("Seed", { exact: true });
  const slots = page.getByLabel("Slots", { exact: true });
  const prompted = page.getByLabel("Prompted slots");
  const doerOnly = page.getByLabel("Doer-only slots");
  const duration = page.getByLabel("Duration");
  const bots = page.locator("#ui-bots");
  const run = page.getByRole("button", { name: "Run match" });
  const saveKey = page.getByRole("button", { name: "Save key" });
  const result = page.locator(".ui-result");
  const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim();

  // First visit: nothing stored, so the defaults; no key, so no prompted slots.
  const first = await stored(page);
  check("first visit: nothing in localStorage", Object.values(first).every((v) => v === null), JSON.stringify(first));
  check("the key field says where the key goes", await page.getByText("Stored in this browser only; sent only to api.anthropic.com.").isVisible());
  check("first visit: the default prompts are filled in", (await thinker.inputValue()).length > 0 && (await move.inputValue()).length > 0);
  const form = {
    map: await map.inputValue(),
    seed: await seed.inputValue(),
    slots: await slots.inputValue(),
    doerOnly: await doerOnly.inputValue(),
    duration: await duration.inputValue(),
    seconds: await text(page.locator(".ui-seconds")),
  };
  check(
    "first visit: the default form, map-1, seed 1, 8 slots, 0 doer-only, 6000 ticks shown as 300 s",
    isDeepStrictEqual(form, { map: "map-1", seed: "1", slots: "8", doerOnly: "0", duration: "6000", seconds: "= 300 s" }),
    JSON.stringify(form),
  );
  check(
    "no key: prompted slots disabled at 0, so 8 bots, and a hint offers doer-only slots",
    (await prompted.isDisabled()) && (await prompted.inputValue()) === "0" && (await text(bots)) === "4 wanderers, 4 campers" && (await page.locator(".ui-nokey").isVisible()),
    `bots "${await text(bots)}"`,
  );

  // Type a key and save it, edit the prompts, set 8 slots / 1 prompted.
  await key.fill(SMOKE_KEY);
  await saveKey.click();
  check("a saved key enables the prompted input and hides the hint", (await prompted.isEnabled()) && (await page.locator(".ui-nokey").isHidden()));
  const prompt = "Smoke test: hold the north wall and shoot first.";
  await thinker.fill(prompt);
  await move.fill("Smoke: strafe left and right.");
  await seed.fill("4242");
  await slots.fill("8");
  await prompted.fill("1");
  check("the prompt counter follows the text", (await text(page.locator("#ui-thinker-count"))) === `${prompt.length} / 8000`, await text(page.locator("#ui-thinker-count")));
  check("8 slots with 1 prompted leaves 7 bots", (await text(bots)) === "4 wanderers, 3 campers", await text(bots));
  const saved = await stored(page);
  check(
    "localStorage holds the key as text, the prompts and the form as JSON, under decision-arena:v1:*",
    saved[STORED.key] === SMOKE_KEY && parsed(saved[STORED.prompts]).thinkerSystem === prompt && parsed(saved[STORED.config]).seed === 4242,
    JSON.stringify(saved),
  );

  // Reload: everything comes back.
  await page.reload();
  await page.waitForFunction(() => window.__decisionArena?.ready === true, undefined, { timeout: 20_000 });
  check("reload keeps the key", (await key.inputValue()) === SMOKE_KEY);
  check("reload keeps the prompts", (await thinker.inputValue()) === prompt && (await move.inputValue()) === "Smoke: strafe left and right.");
  const after = { seed: await seed.inputValue(), slots: await slots.inputValue(), prompted: await prompted.inputValue(), enabled: await prompted.isEnabled() };
  check("reload keeps seed 4242, 8 slots, 1 prompted (enabled)", isDeepStrictEqual(after, { seed: "4242", slots: "8", prompted: "1", enabled: true }), JSON.stringify(after));

  // Clear key: gone from the field and from localStorage; prompted slots off.
  await page.getByRole("button", { name: "Clear key" }).click();
  check("Clear key empties the field and removes the key from localStorage", (await key.inputValue()) === "" && (await stored(page))[STORED.key] === null);
  check("without a key the prompted input is disabled and shows 0", (await prompted.isDisabled()) && (await prompted.inputValue()) === "0");

  // Run match waits for v4.2; the check it will run is reachable through the debug hook.
  check("Run match is disabled", (await run.getAttribute("disabled")) !== null);
  const ok = await validateForm(page);
  check('validateForm() says "Config OK" and shows it under Run match', ok === "Config OK" && (await text(result)) === "Config OK", JSON.stringify(ok));

  // The key back brings the prompted slot back; 9 prompted of 8 is a readable error.
  await key.fill(SMOKE_KEY);
  await saveKey.click();
  check("saving the key again brings back the 1 prompted slot", (await prompted.isEnabled()) && (await prompted.inputValue()) === "1");
  await page.screenshot({ path: join(outDir, "ui-shell.png"), fullPage: true });
  await prompted.fill("9");
  const error = await validateForm(page);
  const want = "1 problem:\nprompted: 9 prompted slots do not fit in 8 slots";
  check("9 prompted of 8 slots: a readable error under Run match", error === want && (await result.textContent()) === want, JSON.stringify(error));
  check("the prompted input is marked invalid", (await prompted.getAttribute("aria-invalid")) === "true");
  await page.locator(".ui-match").screenshot({ path: join(outDir, "ui-shell-error.png") });
  await prompted.fill("1");
  check("a fixed form is OK again", (await validateForm(page)) === "Config OK" && (await prompted.getAttribute("aria-invalid")) !== "true");

  // Reset to defaults: the default prompts again, in the fields and in storage.
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const reset = parsed((await stored(page))[STORED.prompts]);
  check(
    "Reset to defaults restores the default prompts",
    (await thinker.inputValue()) !== prompt && (await thinker.inputValue()).length > 0 && reset.thinkerSystem === (await thinker.inputValue()),
  );

  // Random picks another seed and saves it.
  await page.getByRole("button", { name: "Random" }).click();
  const randomSeed = Number(await seed.inputValue());
  check("Random sets a whole seed and saves it", Number.isInteger(randomSeed) && parsed((await stored(page))[STORED.config]).seed === randomSeed, String(randomSeed));
}

// ---- mind panel (v2.4): perception, plan, doer answers, timeline markers ----

const MIND_EMPTY = "Follow an agent to see its mind";
/** The timeline's accent-color (replay.css), which Chromium paints its thumb with. */
const TIMELINE_ACCENT = 0xf2b134;
/** Half of Chromium's 16 px range thumb: its center runs from 8 px to width − 8 px (measured; mind-panel.css insets markers the same). */
const THUMB_HALF_PX = 8;
const firstPlan = eventsOfKind(log, "Thinker").find((e) => e.ok)?.plan?.text ?? "";

async function drawnMind(page: Page): Promise<DrawnMind | null> {
  return page.evaluate(() => window.__decisionArena?.drawnMind?.() ?? null);
}

/** What the panel must show for `agent` at `tick` of the sample log, computed here in Node. */
function expectedMind(tick: number, agent: string): DrawnMind {
  return { ...mindView(sampleIndex, (t) => stateFromTick(sampleIndex, log, t), tick, agent), markers: markerShapes(markersFor(sampleIndex, agent)) };
}

/** The text of the first element matching `selector`, trimmed; null when there is none. Does not wait. */
async function textOf(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, selector);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, selector);
}

async function canvasSize(page: Page): Promise<{ w: number; h: number; scale: number }> {
  const box = await rectOf(page, ".replay-stage canvas");
  return { w: (box?.right ?? 0) - (box?.left ?? 0), h: (box?.bottom ?? 0) - (box?.top ?? 0), scale: (await state(page)).scale };
}

interface MarkEl {
  kind: string;
  tick: number | null;
  from: number | null;
  to: number | null;
  title: string;
  left: number;
  right: number;
  center: number;
}

/** The marks under the timeline in DOM (drawing) order, with where they are on the page in CSS px. */
async function markEls(page: Page): Promise<MarkEl[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".replay-mind-markers > *"), (el) => {
      const r = el.getBoundingClientRect();
      const d = el.dataset;
      return {
        kind: d.kind ?? "",
        tick: d.tick === undefined ? null : Number(d.tick),
        from: d.from === undefined ? null : Number(d.from),
        to: d.to === undefined ? null : Number(d.to),
        title: el.title,
        left: r.left,
        right: r.right,
        center: r.left + r.width / 2,
      };
    }),
  );
}

/** A shape as markEls reports its element. */
const markOf = (s: MarkerShape) =>
  s.kind === "link"
    ? { kind: "link", tick: null, from: s.from, to: s.to, title: "" }
    : { kind: s.kind, tick: s.tick, from: null, to: null, title: s.title };

/** Where the timeline thumb's center is at `tick`, from the timeline's box (the formula; thumbX measures it). */
async function timelineX(page: Page, tick: number): Promise<number> {
  const box = await rectOf(page, ".replay-timeline");
  if (!box) return Number.NaN;
  return box.left + THUMB_HALF_PX + (tick / lastTick) * (box.right - box.left - 2 * THUMB_HALF_PX);
}

/** The thumb's center in page CSS px, read off a screenshot of the timeline: the top row of its accent-colored disc. */
async function thumbX(page: Page): Promise<number> {
  await page.mouse.move(0, 0); // no hover tint on the thumb
  const png = await timeline(page).screenshot(); // scrolls it into view first
  const left = (await rectOf(page, ".replay-timeline"))?.left ?? Number.NaN;
  const span = await page.evaluate(
    async ({ b64, want }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      for (let y = 0; y < img.height; y++) {
        const row = ctx.getImageData(0, y, img.width, 1).data;
        const hits: number[] = [];
        for (let x = 0; x < img.width; x++) {
          const near = [0, 1, 2].every((c) => Math.abs((row[4 * x + c] ?? 0) - (want[c] ?? 0)) <= (c === 2 ? 60 : 40));
          if (near) hits.push(x);
        }
        if (hits.length >= 4) return [hits[0] ?? 0, (hits.at(-1) ?? 0) + 1];
      }
      return null;
    },
    { b64: png.toString("base64"), want: rgb(TIMELINE_ACCENT) },
  );
  return span ? left + ((span[0] ?? 0) + (span[1] ?? 0)) / 2 : Number.NaN;
}

/** Scrubs to `tick` and returns the tick the mind panel shows once the next animation frame has run, all its callbacks done. */
async function scrubNextFrame(page: Page, tick: number): Promise<number | null> {
  return page.evaluate(`new Promise((resolve) => {
    const input = document.querySelector(".replay-timeline");
    input.value = "${tick}";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => setTimeout(() => {
      const panel = document.querySelector(".replay-mind");
      resolve(panel && panel.dataset.tick ? Number(panel.dataset.tick) : null);
    }, 0));
  })`);
}

interface BarsQuestion {
  question: string;
  summary: string;
  /** threshold: where the threshold mark is along the bar, in percent; null for a choice's bars. */
  bars: { label: string; value: string; on: boolean; threshold: number | null }[];
}

/** The doer answers as the panel draws them: per question its summary line and its bars. */
async function drawnBars(page: Page): Promise<BarsQuestion[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".replay-mind-q"), (q) => ({
      question: q.dataset.question ?? "",
      summary: q.querySelector(".replay-mind-q-sum")?.textContent ?? "",
      bars: Array.from(q.querySelectorAll<HTMLElement>(".replay-mind-bar"), (b) => ({
        label: b.querySelector(".replay-mind-bar-label")?.textContent ?? "",
        value: b.querySelector(".replay-mind-bar-value")?.textContent ?? "",
        on: b.classList.contains("is-chosen") || b.classList.contains("is-crossed"),
        threshold: b.querySelector<HTMLElement>(".replay-mind-bar-threshold") ? parseFloat(b.querySelector<HTMLElement>(".replay-mind-bar-threshold")?.style.left ?? "") : null,
      })),
    })),
  );
}

/** The bars `rows` must draw: a bar per option (the pick on), or one P(yes) bar with its threshold mark (on when crossed). */
function barsOf(rows: DrawnMind["doer"]["rows"]): BarsQuestion[] {
  return rows.map((r) => ({
    question: r.question,
    summary: answerSummary(r),
    bars:
      r.type === "choice"
        ? r.options.map((o) => ({ label: o.option, value: formatProbability(o.probability), on: o.chosen, threshold: null }))
        : [{ label: "P(yes)", value: formatProbability(r.probability), on: r.crossed, threshold: r.threshold * 100 }],
  }));
}

async function drawnPerception(page: Page): Promise<{ self: string | null; visible: string[]; heard: string[]; incoming: string[] }> {
  return page.evaluate(() => ({
    self: document.querySelector(".replay-mind-self")?.textContent ?? null,
    visible: Array.from(document.querySelectorAll(".replay-mind-visible .replay-mind-entry"), (e) => e.textContent ?? ""),
    heard: Array.from(document.querySelectorAll(".replay-mind-heard .replay-mind-entry"), (e) => e.textContent ?? ""),
    incoming: Array.from(document.querySelectorAll(".replay-mind-incoming .replay-mind-entry"), (e) => e.textContent ?? ""),
  }));
}

/** The Doer section's perception block as drawn (R18): its caption, whether it shows, and its lines. */
async function drawnSaw(page: Page): Promise<{ caption: string | null; shown: boolean; self: string | null; visible: string[]; heard: string[]; incoming: string[] }> {
  return page.evaluate(() => ({
    caption: document.querySelector(".replay-mind-saw-caption")?.textContent ?? null,
    shown: document.querySelector<HTMLElement>(".replay-mind-saw-facts")?.hidden === false,
    self: document.querySelector(".replay-mind-saw-self")?.textContent ?? null,
    visible: Array.from(document.querySelectorAll(".replay-mind-saw-visible .replay-mind-entry"), (e) => e.textContent ?? ""),
    heard: Array.from(document.querySelectorAll(".replay-mind-saw-heard .replay-mind-entry"), (e) => e.textContent ?? ""),
    incoming: Array.from(document.querySelectorAll(".replay-mind-saw-incoming .replay-mind-entry"), (e) => e.textContent ?? ""),
  }));
}

/** Pauses the replay if it plays. */
async function pause(page: Page): Promise<void> {
  if ((await playButton(page).textContent()) === "Pause") await playButton(page).click();
  await frames2(page);
}

async function checkMindPanel(page: Page): Promise<void> {
  const markers = page.locator(".replay-mind-markers > *");

  // Follow free: the panel asks for an agent, the timeline has no markers.
  await followSelect(page).selectOption("free");
  await scrubTo(page, 0);
  const free = {
    panels: await page.locator(".replay-mind").count(),
    empty: await textOf(page, ".replay-mind-empty"),
    emptyShown: await page.locator(".replay-mind-empty").isVisible(),
    marks: await markers.count(),
    drawn: await drawnMind(page),
  };
  check(
    `follow free: one mind panel saying "${MIND_EMPTY}", no markers under the timeline`,
    isDeepStrictEqual(free, { panels: 1, empty: MIND_EMPTY, emptyShown: true, marks: 0, drawn: null }),
    JSON.stringify(free),
  );
  const wideCanvas = await rectOf(page, ".replay-stage canvas");
  const widePanel = await rectOf(page, ".replay-mind");
  check(
    "1000x700: the mind panel sits right of the canvas, beside it",
    wideCanvas !== null && widePanel !== null && widePanel.left >= wideCanvas.right - 0.5 && widePanel.top < wideCanvas.bottom && widePanel.bottom > wideCanvas.top,
    `canvas ${JSON.stringify(wideCanvas)}, panel ${JSON.stringify(widePanel)}`,
  );

  // Follow a0: its mind, the canvas keeps its size and zoom.
  const freeSize = await canvasSize(page);
  await followSelect(page).selectOption("a0");
  await frames2(page);
  const followSize = await canvasSize(page);
  check("following a0 shows its mind without resizing the canvas or changing the zoom", isDeepStrictEqual(followSize, freeSize), `${JSON.stringify(freeSize)} -> ${JSON.stringify(followSize)}`);
  const at0 = await drawnMind(page);
  const saw0 = await drawnSaw(page);
  check(
    "following a0 at tick 0: the panel is mindView's for a0 at tick 0 (no plan yet, no answers yet, so no 'saw at' block)",
    isDeepStrictEqual(at0, expectedMind(0, "a0")) && at0?.doer.perception === null && !saw0.shown,
    `${JSON.stringify(at0)?.slice(0, 300)}; saw ${JSON.stringify(saw0)}`,
  );

  // Markers: markerShapes for a0, positioned where the timeline puts their ticks.
  const marks = await markEls(page);
  const wantShapes = markerShapes(markersFor(sampleIndex, "a0"));
  check(
    "markers under the timeline are markerShapes' for a0: links 1→7 and 71→78, hollow dots at 1 and 71, filled dots at 7 and 78, red ticks at 41 and 78, each with its hover text",
    wantShapes.length === 8 && isDeepStrictEqual(marks.map(({ kind, tick, from, to, title }) => ({ kind, tick, from, to, title })), wantShapes.map(markOf)),
    JSON.stringify(marks.map((m) => `${m.kind}@${m.tick ?? `${m.from}-${m.to}`}`)),
  );
  const offsets = await Promise.all(marks.filter((m) => m.tick !== null).map(async (m) => +(m.center - (await timelineX(page, m.tick ?? 0))).toFixed(2)));
  check("every marker is centered where the timeline puts its tick (within 1 px)", offsets.length === 6 && offsets.every((d) => Math.abs(d) <= 1), `offsets ${JSON.stringify(offsets)} px`);
  const failed = log.events.filter((e) => (e.kind === "Doer" || e.kind === "Thinker") && e.agent === "a0" && !e.ok).map((e) => e.tick);
  const faultTicks = marks.filter((m) => m.kind === "fault").map((m) => m.tick);
  check("exit: fault markers appear exactly on the faulted ticks (41: doer timeout, 78: thinker refusal), one per ok:false event", isDeepStrictEqual(failed, [41, 78]) && isDeepStrictEqual(faultTicks, failed), JSON.stringify(faultTicks));
  const pairs = eventsOfKind(log, "Thinker").filter((e) => e.agent === "a0" && e.requestedTick !== e.tick);
  const linked = pairs.map((e) => {
    const requested = marks.find((m) => m.kind === "requested" && m.tick === e.requestedTick);
    const applied = marks.find((m) => m.kind === "applied" && m.tick === e.tick);
    const link = marks.find((m) => m.kind === "link" && m.from === e.requestedTick && m.to === e.tick);
    const ok = requested && applied && link && Math.abs(link.left - requested.center) <= 1 && Math.abs(link.right - applied.center) <= 1 && applied.center > requested.center;
    return `${e.requestedTick}→${e.tick}: ${ok ? "linked" : "NOT linked"}`;
  });
  check("exit: each Thinker event with requestedTick ≠ tick draws a requested and an applied marker, a line running from one to the other", pairs.length === 2 && linked.every((l) => l.endsWith(": linked")), linked.join(", "));
  for (const tick of failed) {
    await scrubTo(page, tick);
    const thumb = await thumbX(page);
    const mark = (await markEls(page)).find((m) => m.kind === "fault" && m.tick === tick);
    check(`the fault marker at tick ${tick} sits under the timeline thumb scrubbed to ${tick} (pixels)`, mark !== undefined && Math.abs(mark.center - thumb) <= 1.5, `marker ${mark?.center.toFixed(2)} px, thumb ${thumb.toFixed(2)} px`);
  }

  // The thinker refusal (tick 78): the fault line, the plan of tick 7 still in view.
  await scrubTo(page, 0);
  const shown78 = await scrubNextFrame(page, 78);
  const at78 = await drawnMind(page);
  check(
    "scrubbed to tick 78 (thinker refusal): within one frame the panel is mindView's, with the fault line and the plan of tick 7",
    shown78 === 78 && isDeepStrictEqual(at78, expectedMind(78, "a0")) && at78?.plan.fault === "Thinker fault at tick 78: refusal (stop_reason: refusal) — kept the plan from tick 7",
    `panel at ${shown78}; plan ${JSON.stringify(at78?.plan)}`,
  );
  const dom78 = {
    plan: await textOf(page, ".replay-mind-plan-text"),
    caption: await textOf(page, ".replay-mind-plan-caption"),
    fault: await textOf(page, ".replay-mind-plan-fault"),
    faultShown: await page.locator(".replay-mind-plan-fault").isVisible(),
    head: await textOf(page, ".replay-mind-head"),
  };
  check(
    "tick 78 on screen: the plan text, 'applied at tick 7 (requested at 1)', the refusal on a visible fault line, a0 and the tick in the heading",
    dom78.plan === firstPlan && dom78.caption === "applied at tick 7 (requested at 1)" && dom78.fault === at78?.plan.fault && dom78.faultShown && (dom78.head ?? "").includes("a0") && (dom78.head ?? "").includes("tick 78"),
    JSON.stringify(dom78),
  );
  await page.locator(".replay").screenshot({ path: join(outDir, "mind-panel.png") });

  // The doer timeout (tick 41): the answers of tick 31, "kept from tick 31", the fault text.
  const shown41 = await scrubNextFrame(page, 41);
  const at41 = await drawnMind(page);
  const dom41 = {
    caption: await textOf(page, ".replay-mind-doer-caption"),
    fault: await textOf(page, ".replay-mind-doer-fault"),
    faultShown: await page.locator(".replay-mind-doer-fault").isVisible(),
  };
  check(
    "scrubbed to tick 41 (doer timeout): within one frame, 'kept from tick 31' and the timeout on a visible fault line",
    shown41 === 41 && isDeepStrictEqual(at41, expectedMind(41, "a0")) &&
      isDeepStrictEqual(dom41, { caption: "kept from tick 31", fault: "Doer fault at tick 41: timeout: no answer within 2000 ms", faultShown: true }),
    `panel at ${shown41}; ${JSON.stringify(dom41)}`,
  );
  const bars41 = await drawnBars(page);
  check(
    "tick 41: the bars are the kept answers of tick 31: every option most likely first, the pick lit; fire and escalate against 50% and 70%",
    isDeepStrictEqual(bars41, barsOf(expectedMind(41, "a0").doer.rows)) && bars41.length === 4,
    JSON.stringify(bars41.map((q) => `${q.question}: ${q.summary}`)),
  );

  // Tick 77: the plan of tick 7 and no fault line; the answers of tick 71, with a target.
  await scrubTo(page, 77);
  const at77 = await drawnMind(page);
  const bars77 = await drawnBars(page);
  check(
    "tick 77: no fault lines, the answers of tick 71 (move, turn, fire, target, escalate) drawn as bars",
    isDeepStrictEqual(at77, expectedMind(77, "a0")) && !(await page.locator(".replay-mind-plan-fault").isVisible()) && !(await page.locator(".replay-mind-doer-fault").isVisible()) &&
      isDeepStrictEqual(bars77, barsOf(at77?.doer.rows ?? [])) && isDeepStrictEqual(bars77.map((q) => q.question), ["move", "turn", "fire", "target", "escalate"]),
    `${JSON.stringify(at77?.doer.caption)}; ${JSON.stringify(bars77.map((q) => q.summary))}`,
  );

  // Perception as lines: tick 115 (a1 ahead, the hit's source), tick 141 (a shot heard).
  for (const tick of [115, 141]) {
    await scrubTo(page, tick);
    const lines = await drawnPerception(page);
    const want = expectedMind(tick, "a0").perception.lines;
    check(`tick ${tick}: the perception section shows core.perceive's view of a0, line by line`, isDeepStrictEqual(lines, { ...want }), JSON.stringify(lines));
  }

  // R18: the Doer section shows what the answers in force were decided on, the world before the
  // call's tick: at the doer tick 111 the world of tick 110, and still at 115, while the Perception
  // block above follows the tick on screen (at 115 a0 has been hit since: HP 80, incoming fire).
  // At 41 (timeout) the kept answers of 31 saw tick 30.
  const decided110 = perceptionLines(perceive(stateFromTick(sampleIndex, log, 110), "a0"), true);
  for (const tick of [111, 115]) {
    await scrubTo(page, tick);
    const sawDom = await drawnSaw(page);
    const top = await drawnPerception(page);
    const topWant = expectedMind(tick, "a0").perception.lines;
    check(
      `tick ${tick}: the Doer section says "saw at tick 110, answered at tick 111" over core.perceive's view of a0 at tick 110, line by line; the Perception block shows tick ${tick}`,
      isDeepStrictEqual(sawDom, { caption: "saw at tick 110, answered at tick 111", shown: true, ...decided110 }) &&
        isDeepStrictEqual(top, { ...topWant }) &&
        (tick !== 115 || (top.self?.includes("HP 80") === true && top.incoming.length === 1 && sawDom.incoming.length === 0)),
      `${JSON.stringify(sawDom)} | top ${JSON.stringify(top)}`,
    );
  }
  await scrubTo(page, 41);
  const saw41 = await drawnSaw(page);
  const decided30 = perceptionLines(perceive(stateFromTick(sampleIndex, log, 30), "a0"), true);
  check("tick 41 (doer timeout): the Doer section shows the kept answers' input, 'saw at tick 30, answered at tick 31'", isDeepStrictEqual(saw41, { caption: "saw at tick 30, answered at tick 31", shown: true, ...decided30 }), JSON.stringify(saw41));

  // Re-rendered only when the tick or the agent changes: toggling the cone or trails redraws the scene, not the panel.
  const lastRender = () => page.evaluate(() => performance.getEntriesByName("mind-render", "measure").at(-1)?.startTime ?? -1);
  const rendered = await lastRender();
  await coneBox(page).check();
  await frames2(page);
  await trailsBox(page).uncheck();
  await frames2(page);
  check("toggling the cone and trails leaves the panel alone (same tick, same agent: no mind-render)", rendered >= 0 && (await lastRender()) === rendered, `last mind-render at ${rendered}`);
  await coneBox(page).uncheck();
  await trailsBox(page).check();

  // Clicking a marker seeks the clock to its tick (focus starts on the page, so space plays afterwards only if no marker took it).
  await blur(page);
  for (const [kind, tick] of [["applied", 7], ["fault", 41], ["requested", 71], ["fault", 78]] as const) {
    const mark = page.locator(`.replay-mind-markers [data-kind="${kind}"][data-tick="${tick}"]`);
    if ((await mark.count()) !== 1) {
      check(`clicking the ${kind} marker at tick ${tick} seeks there`, false, "no such marker");
      continue;
    }
    await mark.click();
    await frames2(page);
    const shown = { readout: await readout(page), panel: (await drawnMind(page))?.tick };
    check(`clicking the ${kind} marker at tick ${tick} seeks there: readout "${tick} / ${lastTick}", the panel at ${tick}`, isDeepStrictEqual(shown, { readout: `${tick} / ${lastTick}`, panel: tick }), JSON.stringify(shown));
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  const played = await playButton(page).textContent();
  await page.keyboard.press("Space");
  await frames2(page);
  check("after clicking a marker, space still plays and pauses: the marker keeps no focus", played === "Pause" && (await playButton(page).textContent()) === "Play", `"${played}" after the first space`);

  // Every tick: shown within one frame of its scrub, mind-render under 8 ms.
  await pause(page);
  await scrubTo(page, lastTick);
  const scrubs = (await page.evaluate(`(async () => {
    const input = document.querySelector(".replay-timeline");
    const panel = document.querySelector(".replay-mind");
    const out = [];
    for (let t = 0; t <= ${lastTick}; t++) {
      const before = performance.now();
      input.value = String(t);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const m = performance.getEntriesByName("mind-render", "measure").at(-1);
      out.push({ tick: t, shown: panel && panel.dataset.tick ? Number(panel.dataset.tick) : null, ms: m && m.startTime >= before ? m.duration : null });
    }
    return out;
  })()`)) as { tick: number; shown: number | null; ms: number | null }[];
  const late = scrubs.filter((s) => s.shown !== s.tick).map((s) => `${s.tick}->${s.shown}`);
  check(`exit: scrubbing to every tick 0..${lastTick} in turn, the panel shows that tick within one frame`, scrubs.length === lastTick + 1 && late.length === 0, late.slice(0, 8).join(", "));
  const ms = scrubs.map((s) => s.ms ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
  const mean = ms.reduce((sum, v) => sum + v, 0) / ms.length;
  const p95 = ms[Math.min(ms.length - 1, Math.floor(0.95 * ms.length))] ?? Number.NaN;
  const renderTiming = `${ms.length} scrubs: mean ${mean.toFixed(3)} ms, p95 ${p95.toFixed(3)}, max ${(ms.at(-1) ?? Number.NaN).toFixed(3)}`;
  console.log(`  timing, mind panel update per scrub (User Timing mind-render): ${renderTiming}`);
  check("budget: the mind panel updates in under 8 ms per scrub (User Timing mind-render)", (ms.at(-1) ?? Number.POSITIVE_INFINITY) < 8, renderTiming);

  // Playing at 1x through the refusal: every frame's panel is mindView's for the tick on screen.
  await speedSelect(page).selectOption("1");
  await pause(page);
  await scrubTo(page, 60);
  await playButton(page).click();
  const frames = await sampleFrames(page, 90);
  await playButton(page).click();
  const wrong = frames.filter((f) => !isDeepStrictEqual(f.mind, expectedMind(f.tick, "a0"))).map((f) => f.tick);
  const ticks = new Set(frames.map((f) => f.tick));
  check(
    "playing at 1x following a0, every frame's mind panel is mindView's for the tick on screen",
    wrong.length === 0 && ticks.size > 20 && ticks.has(78),
    `${frames.length} frames, ticks ${frames[0]?.tick}..${frames.at(-1)?.tick}${wrong.length ? `; wrong at ${wrong.slice(0, 8).join(", ")}` : ""}`,
  );

  // Narrow window: the panel goes below the canvas; markers follow the narrower timeline.
  const wideScale = (await state(page)).scale;
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForFunction((before) => window.__decisionArena?.scale !== before, wideScale);
  await frames2(page);
  const narrowCanvas = await rectOf(page, ".replay-stage canvas");
  const narrowPanel = await rectOf(page, ".replay-mind");
  check("600x900: the mind panel sits below the canvas", narrowCanvas !== null && narrowPanel !== null && narrowPanel.top >= narrowCanvas.bottom - 0.5, `canvas ${JSON.stringify(narrowCanvas)}, panel ${JSON.stringify(narrowPanel)}`);
  await followSelect(page).selectOption("free");
  await frames2(page);
  const narrowFree = await canvasSize(page);
  await followSelect(page).selectOption("a0");
  await frames2(page);
  check("600x900: following a0 does not resize the canvas either", isDeepStrictEqual(await canvasSize(page), narrowFree), JSON.stringify(narrowFree));
  const narrowMarks = await markEls(page);
  const narrowOffsets = await Promise.all(narrowMarks.filter((m) => m.tick !== null).map(async (m) => +(m.center - (await timelineX(page, m.tick ?? 0))).toFixed(2)));
  check("600x900: every marker re-laid to where the narrower timeline puts its tick", narrowMarks.length === 8 && narrowOffsets.every((d) => Math.abs(d) <= 1), `offsets ${JSON.stringify(narrowOffsets)} px`);
  await scrubTo(page, 78);
  const thumb78 = await thumbX(page);
  const fault78 = (await markEls(page)).find((m) => m.kind === "fault" && m.tick === 78);
  check("600x900: the fault marker at 78 sits under the thumb scrubbed to 78 (pixels)", fault78 !== undefined && Math.abs(fault78.center - thumb78) <= 1.5, `marker ${fault78?.center.toFixed(2)} px, thumb ${thumb78.toFixed(2)} px`);
  await page.locator(".replay").screenshot({ path: join(outDir, "mind-panel-narrow.png") });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction((before) => window.__decisionArena?.scale === before, wideScale);
  await frames2(page);

  // Re-mount while the panel shows a0 at the refusal: nothing left behind, the new panel starts empty.
  await scrubTo(page, 78);
  const before = await leaks(page);
  await upload(page, samplePath);
  const after = await leaks(page);
  const fresh = { follow: await followSelect(page).inputValue(), drawn: await drawnMind(page), empty: await textOf(page, ".replay-mind-empty"), marks: await markers.count() };
  check(
    "re-mounting while the panel shows a0 leaves nothing behind (one mind panel, listeners, observers, contexts), and the new panel starts on free, empty",
    before.minds === 1 && isDeepStrictEqual(after, before) && isDeepStrictEqual(fresh, { follow: "free", drawn: null, empty: MIND_EMPTY, marks: 0 }),
    `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}, fresh ${JSON.stringify(fresh)}`,
  );
}

// ---- files (v2.5) ----

// Installed before the page's own scripts. Counts what a mounted viewer holds on to:
// listeners on window and document, live ResizeObservers, live WebGL contexts, its
// elements (canvas, .replay root, the .replay-view row of v2.3, the .replay-mind
// panel of v2.4). After a
// re-mount the counts must be what they were after the first mount. A string, not a
// callback, for the tsx/__name reason given in checkPlayback.
const LEAK_PROBE = `(() => {
  const listeners = new Map();
  const where = (t) => (t === window ? "window" : t === document ? "document" : null);
  const keyOf = (at, type, options) =>
    at + ":" + type + ((typeof options === "boolean" ? options : !!(options && options.capture)) ? ":capture" : "");
  const forget = (listener, key) => {
    const keys = listeners.get(listener);
    if (keys) keys.delete(key);
  };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const at = where(this);
    const signal = options && typeof options === "object" ? options.signal : undefined;
    const once = options && typeof options === "object" && options.once;
    if (at && listener && !once && !(signal && signal.aborted)) {
      const key = keyOf(at, type, options);
      if (!listeners.has(listener)) listeners.set(listener, new Set());
      listeners.get(listener).add(key);
      if (signal) signal.addEventListener("abort", () => forget(listener, key));
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const at = where(this);
    if (at && listener) forget(listener, keyOf(at, type, options));
    return remove.call(this, type, listener, options);
  };
  const observers = new Set();
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    observe(target, options) {
      observers.add(this);
      return super.observe(target, options);
    }
    disconnect() {
      observers.delete(this);
      return super.disconnect();
    }
  };
  const contexts = new Set();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (context && /webgl/.test(type)) contexts.add(context);
    return context;
  };
  window.__leaks = () => {
    const counts = {};
    for (const keys of listeners.values()) for (const key of keys) counts[key] = (counts[key] || 0) + 1;
    return {
      listeners: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))),
      resizeObservers: observers.size,
      webglContexts: [...contexts].filter((c) => !c.isContextLost()).length,
      canvases: document.querySelectorAll("canvas").length,
      viewers: document.querySelectorAll(".replay").length,
      viewRows: document.querySelectorAll(".replay-view").length,
      minds: document.querySelectorAll(".replay-mind").length,
    };
  };
})()`;

interface Leaks {
  listeners: Record<string, number>;
  resizeObservers: number;
  webglContexts: number;
  canvases: number;
  viewers: number;
  viewRows: number;
  minds: number;
}

async function leaks(page: Page): Promise<Leaks> {
  return page.evaluate("window.__leaks()");
}

const fileInput = (page: Page) => page.locator('input[type="file"]');
const errorBox = (page: Page) => page.locator(".replay-error");
const statusText = async (page: Page) => ((await page.locator(".replay-status").textContent()) ?? "").trim();

/** Logs opened so far: each open records a `replay-open` measure, from file in hand to first frame. */
async function openCount(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByName("replay-open", "measure").length);
}

async function waitOpened(page: Page, before: number): Promise<void> {
  await page.waitForFunction(
    (n) => performance.getEntriesByName("replay-open", "measure").length > n && window.__decisionArena?.ready === true,
    before,
  );
}

type InputFiles = Parameters<Locator["setInputFiles"]>[0];

/** Feeds `files` to the file input, waits until the log is on screen. */
async function upload(page: Page, files: InputFiles): Promise<void> {
  const before = await openCount(page);
  await fileInput(page).setInputFiles(files);
  await waitOpened(page, before);
  await frames2(page);
}

/** Feeds a file that must not open; returns the error box text. */
async function uploadBad(page: Page, files: InputFiles): Promise<string> {
  await fileInput(page).setInputFiles(files);
  await errorBox(page).waitFor({ state: "visible" });
  return (await errorBox(page).innerText()).trim();
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A 16-agent log of at least `bytes` as compact JSON: Spawns, one Tick per tick, a Doer call every 10 ticks. */
function syntheticLog(bytes: number): MatchLog {
  const n = 16;
  const doer = eventsOfKind(log, "Doer")[0];
  if (!doer) throw new Error("sample log has no Doer event");
  const events: LogEvent[] = [];
  for (let i = 0; i < n; i++) events.push({ kind: "Spawn", tick: 0, agent: `a${i}`, pos: { x: 5 + 5 * i, y: 50 }, facing: 0 });
  let size = 0;
  let tick = 0;
  while (size < bytes) {
    const tickEvent: LogEvent = {
      kind: "Tick",
      tick,
      agents: Array.from({ length: n }, (_, i): [string, number, number, number, number] => [
        `a${i}`,
        round(50 + 40 * Math.sin((tick + 37 * i) / 97), 2),
        round(50 + 40 * Math.cos((tick + 53 * i) / 89), 2),
        round((tick * 3 + i * 22.5) % 360, 1),
        100,
      ]),
      bullets: [[`b${tick}`, round(50 + 30 * Math.sin(tick / 7), 2), 50]],
    };
    events.push(tickEvent);
    size += JSON.stringify(tickEvent).length + 1;
    if (tick % 10 === 1) {
      const call: LogEvent = { ...doer, tick, agent: "a0" };
      events.push(call);
      size += JSON.stringify(call).length + 1;
    }
    tick++;
  }
  events.push({ kind: "MatchEnd", tick: tick - 1, ranking: ["a0"] });
  const slots: MatchLog["config"]["slots"] = [{ kind: "prompted" }, ...Array.from({ length: n - 1 }, () => ({ kind: "bot" as const, bot: "wanderer" as const }))];
  return { version: 1, config: { mapId: "map-1", seed: 7, durationTicks: tick, slots }, seed: 7, prompts: log.prompts, events };
}

/** Returns the leak counts of one mounted viewer, the baseline later re-mounts are held to. */
async function checkFiles(page: Page): Promise<Leaks> {
  // Per mounted viewer Pixi adds a ResizeObserver of its own (accessibility CanvasObserver) and keeps
  // one global test WebGL context, so these counts are compared with the baseline, not with 1.
  const baseline = await leaks(page);
  check(
    "one viewer mounted: one .replay, one view row, one mind panel, one canvas, one keydown listener on document",
    baseline.viewers === 1 && baseline.viewRows === 1 && baseline.minds === 1 && baseline.canvases === 1 && baseline.listeners["document:keydown"] === 1,
    `${baseline.resizeObservers} ResizeObservers, ${baseline.webglContexts} live WebGL contexts`,
  );

  // Upload while playing from tick 100: the new replay replaces the old one, paused at tick 0.
  await scrubTo(page, 100);
  await playButton(page).click();
  await page.waitForTimeout(150);
  await upload(page, samplePath);
  const s = await state(page);
  check(
    "upload replaces the replay: paused at tick 0, readout 0 / 142, timeline at 0",
    s.tick === 0 && (await readout(page)) === `0 / ${lastTick}` && (await playButton(page).textContent()) === "Play" && Number(await timeline(page).inputValue()) === 0,
    `tick ${s.tick}, readout "${await readout(page)}"`,
  );
  check("upload did not reload the page", (await page.evaluate("window.__smokeMarker")) === true);
  check("the file bar names the open file", (await statusText(page)).includes("sample-log.json"), await statusText(page));
  await checkFrame(page, "after upload", 0, "upload-tick0.png");

  // Upload again; space must then toggle the new replay exactly once.
  await upload(page, samplePath);
  await blur(page);
  await page.keyboard.press("Space");
  await frames2(page);
  const label = await playButton(page).textContent();
  await page.waitForTimeout(300);
  const playedTo = (await state(page)).tick;
  await page.keyboard.press("Space");
  await frames2(page);
  check(
    "after two uploads, space toggles the replay exactly once",
    label === "Pause" && playedTo > 0 && (await playButton(page).textContent()) === "Play",
    `button "${label}" after space, tick ${playedTo} 300 ms later`,
  );
  const after = await leaks(page);
  check("re-mounting twice leaves nothing behind (listeners, observers, WebGL contexts, canvases)", isDeepStrictEqual(after, baseline), `after ${JSON.stringify(after)}`);

  // JSON that is not a MatchLog: the error box names the file and the issue path; the replay stays.
  const opens = await openCount(page);
  const shown = await readout(page);
  const schemaError = await uploadBad(page, badPath);
  check(
    "a schema failure shows the error box with the file and the issue path events[5].kind",
    schemaError.includes("unknown-event-kind.json") && schemaError.includes("events[5].kind:"),
    JSON.stringify(schemaError),
  );
  check("a schema failure leaves the replay on screen", (await openCount(page)) === opens && (await readout(page)) === shown && (await leaks(page)).viewers === 1);
  await page.screenshot({ path: join(outDir, "upload-error.png") });
  await page.getByRole("button", { name: "Dismiss" }).click();
  check("the error box dismisses", await errorBox(page).isHidden());

  // Not JSON at all.
  const jsonError = await uploadBad(page, { name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{ "version": 1, ') });
  check(
    "invalid JSON shows a readable error: the file, 'not valid JSON', the parser's position",
    jsonError.includes("broken.json") && jsonError.includes("not valid JSON") && /position \d+/.test(jsonError),
    JSON.stringify(jsonError),
  );
  await page.getByRole("button", { name: "Dismiss" }).click();

  // Download the log on screen; the file is the same MatchLog and opens again.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const savedPath = join(outDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const savedText = readFileSync(savedPath, "utf8");
  check("download is named decision-arena-<mapId>-<seed>.json", download.suggestedFilename() === `decision-arena-${log.config.mapId}-${log.seed}.json`, download.suggestedFilename());
  check(
    "the downloaded file is compact JSON of the same MatchLog",
    !savedText.includes("\n") && isDeepStrictEqual(MatchLogSchema.parse(JSON.parse(savedText)), log),
    `${savedText.length} bytes`,
  );
  await upload(page, savedPath);
  check("the downloaded file uploads again", (await readout(page)) === `0 / ${lastTick}` && (await statusText(page)).includes(download.suggestedFilename()), await statusText(page));

  // Drop a file on the replay: the drop zone shows while dragging, the file opens.
  const dataTransfer = await page.evaluateHandle(
    ({ text, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type: "application/json" }));
      return transfer;
    },
    { text: savedText, name: "dropped.json" },
  );
  const canvas = page.locator("canvas");
  await canvas.dispatchEvent("dragenter", { dataTransfer });
  await canvas.dispatchEvent("dragover", { dataTransfer });
  check("dragging a file over the page shows the drop zone", await page.locator(".replay-drop").isVisible());
  await page.screenshot({ path: join(outDir, "drop.png") });
  const beforeDrop = await openCount(page);
  await canvas.dispatchEvent("drop", { dataTransfer });
  await waitOpened(page, beforeDrop);
  await frames2(page);
  check(
    "dropping a .json file opens it",
    (await statusText(page)).includes("dropped.json") && (await readout(page)) === `0 / ${lastTick}` && (await page.locator(".replay-drop").isHidden()),
    await statusText(page),
  );
  await page.screenshot({ path: join(outDir, "upload.png") });

  // Budget (plan v2.5): upload to first frame under 300 ms for a 5 MB log; "Loading…" shows meanwhile.
  // replay-open ends when the first frame of the new log is rendered. Under SwiftShader the browser
  // then stalls ~0.4 s compiling the new WebGL context's shaders in software; a GPU does not.
  const big = syntheticLog(5 * 1024 * 1024);
  const bigText = JSON.stringify(big);
  const bigPath = join(outDir, "synthetic-5mb.json");
  writeFileSync(bigPath, bigText);
  await page.evaluate(`(() => {
    const status = document.querySelector(".replay-status");
    window.__statuses = [];
    new MutationObserver(() => window.__statuses.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
  })()`);
  await upload(page, bigPath);
  const statuses = (await page.evaluate("window.__statuses")) as string[];
  const timing = await page.evaluate(() => ({
    open: performance.getEntriesByName("replay-open", "measure").at(-1)?.duration ?? Number.NaN,
    parse: performance.getEntriesByName("replay-parse", "measure").at(-1)?.duration ?? Number.NaN,
  }));
  const bigLast = big.events.at(-1)?.tick ?? 0;
  check("the 5 MB log opens", (await state(page)).lastTick === bigLast && (await readout(page)) === `0 / ${bigLast}`, await readout(page));
  check("a loading state shows while the log parses", statuses.some((t) => t.startsWith("Loading")), JSON.stringify(statuses));
  check(
    "budget: upload to first frame under 300 ms for a 5 MB log",
    timing.open < 300,
    `${(bigText.length / 1024 / 1024).toFixed(2)} MiB, ${bigLast} ticks: ${timing.open.toFixed(0)} ms to first frame, ${timing.parse.toFixed(0)} ms read+parse`,
  );
  check("after every upload, still nothing left behind", isDeepStrictEqual(await leaks(page), baseline), JSON.stringify(await leaks(page)));
  return baseline;
}

// ---- a busy 16-agent log with trails and the cone on (v2.3) ----

/**
 * `ticks` ticks of 16 agents circling the arena, facing roughly inward, each firing every
 * 10 ticks; bullets fly 3 m per tick with their own ids until they leave the arena, so
 * about 35 are in flight at once, each with a full trail. Nobody is hit: a drawing load.
 */
function busyLog(ticks: number): MatchLog {
  const n = 16;
  const place = (i: number, t: number) => {
    const a = t / 90 + (2 * Math.PI * i) / n;
    const pos = { x: round(50 + 38 * Math.cos(a), 2), y: round(50 + 38 * Math.sin(a), 2) };
    const inward = vec2.angleOf({ x: 50 - pos.x, y: 50 - pos.y });
    return { pos, facing: round(normalizeDeg(inward + 25 * Math.sin(t / 13 + i)), 1) };
  };
  const events: LogEvent[] = [];
  for (let i = 0; i < n; i++) events.push({ kind: "Spawn", tick: 0, agent: `a${i}`, ...place(i, 0) });
  const flying: { id: string; x: number; y: number; vx: number; vy: number }[] = [];
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, ...place(i, t) }));
    if (t > 0) {
      for (const b of flying) {
        b.x += b.vx;
        b.y += b.vy;
      }
      for (let k = flying.length - 1; k >= 0; k--) {
        const b = flying[k];
        if (b && (b.x < 0 || b.x > 100 || b.y < 0 || b.y > 100)) flying.splice(k, 1);
      }
      rows.forEach(({ id, pos, facing }, i) => {
        if ((t + i) % 10 !== 0) return;
        const dir = vec2.fromAngle(facing);
        const bullet = `b${next++}`;
        flying.push({ id: bullet, x: pos.x + dir.x * 3.6, y: pos.y + dir.y * 3.6, vx: dir.x * 3, vy: dir.y * 3 });
        events.push({ kind: "Shot", tick: t, agent: id, bullet });
      });
    }
    events.push({
      kind: "Tick",
      tick: t,
      agents: rows.map(({ id, pos, facing }): [string, number, number, number, number] => [id, pos.x, pos.y, facing, 100]),
      bullets: flying.map((b): [string, number, number] => [b.id, round(b.x, 2), round(b.y, 2)]),
    });
  }
  events.push({ kind: "MatchEnd", tick: ticks - 1, ranking: [] });
  const slots = Array.from({ length: n }, (_, i) => ({ kind: "bot" as const, bot: i % 2 === 0 ? ("wanderer" as const) : ("camper" as const) }));
  return { version: 1, config: { mapId: "map-1", seed: 16, durationTicks: ticks, slots }, seed: 16, prompts: log.prompts, events };
}

async function checkBusyLog(page: Page): Promise<void> {
  const busy = busyLog(1200);
  const busyIndex = indexLog(busy);
  const busyPath = join(outDir, "busy-16.json");
  writeFileSync(busyPath, JSON.stringify(busy));
  await upload(page, busyPath);

  const ids = Array.from({ length: 16 }, (_, i) => `a${i}`);
  check("16-agent log: Follow lists free and all sixteen agents", isDeepStrictEqual(await followSelect(page).locator("option").allTextContents(), ["free", ...ids]));
  check(
    "a newly opened log starts the view row over: free, trails on, cone off",
    (await followSelect(page).inputValue()) === "free" && (await trailsBox(page).isChecked()) && !(await coneBox(page).isChecked()) && (await drawnOverlay(page)) === null,
  );

  await followSelect(page).selectOption("a5");
  await coneBox(page).check();
  await scrubTo(page, 600);
  const inFlight = busyIndex.byTick(600).bullets.length;
  const drawn600 = await drawnBullets(page);
  check(
    "16-agent log at tick 600: every bullet in flight drawn, each with a full trail behind it",
    drawn600.dots.length === inFlight && drawn600.trails.filter((t) => t.points === TRAIL_TICKS).length > inFlight / 2,
    `${inFlight} bullets in flight, ${drawn600.dots.length} dots, ${drawn600.trails.length} trails`,
  );
  await page.locator(".replay").screenshot({ path: join(outDir, "overlay-busy.png") });

  // Playing at 1x: every frame's overlay is perceive's for its tick, a5 stays centered.
  await speedSelect(page).selectOption("1");
  await playButton(page).click();
  const played = await sampleFrames(page, 90);
  await playButton(page).click();
  const wrong = played.filter((f) => !isDeepStrictEqual(f.overlay, overlayOf(busyIndex, busy, f.tick, "a5")));
  const worst = played.reduce((max, f) => {
    const a = f.agents.find((x) => x.id === "a5");
    const c = a ? markerCenter(a) : { x: Number.NaN, y: Number.NaN };
    return Math.max(max, Number.isNaN(c.x) ? Infinity : Math.hypot(c.x - f.center.x, c.y - f.center.y));
  }, 0);
  const seen = Math.max(...played.map((f) => f.overlay?.visible.length ?? 0));
  check(
    "16 agents at 1x: every frame shows perceive's overlay for a5 at the tick on screen, a5 centered",
    wrong.length === 0 && worst < 0.5 && seen > 0,
    `${played.length} frames, ticks ${played[0]?.tick}..${played.at(-1)?.tick}, up to ${seen} enemies seen, worst centering ${worst.toFixed(3)} px`,
  );

  const on = await timePlayback(page, 300, 3000);
  await followSelect(page).selectOption("free");
  await coneBox(page).uncheck();
  await trailsBox(page).uncheck();
  const bare = await timePlayback(page, 300, 3000);
  console.log(`  timing, 16 agents, ~${inFlight} bullets at 1x, follow a5 + trails + vision cone: ${showTiming(on)}`);
  console.log(`  timing, 16 agents, ~${inFlight} bullets at 1x, free camera, no trails, no cone:   ${showTiming(bare)}`);
  check("budget: 60 fps at 1x with trails and the cone on (16 agents)", smooth(on), showTiming(on));
}

// ---- a real 16-bot match: incoming fire, a death, re-mounting while following (v2.3) ----

/**
 * The match the kit's scripts/run-match.ts writes by default (16 bots on map-1, seed 7, wanderers
 * and campers alternating), run here in-process: same config, same log, byte for byte.
 * DECISION_ARENA_MATCH_LOG=<file> opens a log that script wrote instead (any map or seed).
 */
async function realMatchLog(): Promise<MatchLog> {
  const file = process.env.DECISION_ARENA_MATCH_LOG;
  if (file) return MatchLogSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const config = MatchConfigSchema.parse({
    mapId: "map-1",
    seed: 7,
    durationTicks: MATCH_DURATION_TICKS,
    slots: Array.from({ length: 16 }, (_, i): Slot => ({ kind: "bot", bot: i % 2 === 0 ? "wanderer" : "camper" })),
  });
  const prompts = { thinkerSystem: "", doerInstructions: { move: "", turn: "", fire: "", target: "" } };
  return runMatch(config, { providers: botProviders(config.seed), prompts });
}

/**
 * Where the fire on `agent` that perceive reports at `tick` came from, read straight off the log,
 * not through stateFromTick. Perception holds the last PERCEPTION_WINDOW_TICKS steps (R15), so: for
 * each tick of that window, oldest first, the owner of each bullet that hit it where that tick's
 * row puts the owner; then, again oldest first, the rows' `near` entries for it. Null when an
 * owner is gone from its row (the log has no position for it then).
 */
function fireFrom(index: LogIndex, tick: number, agent: string): Vec2[] | null {
  const hits: Vec2[] = [];
  const near: Vec2[] = [];
  for (let s = Math.max(1, tick - PERCEPTION_WINDOW_TICKS + 1); s <= tick; s++) {
    const row = index.byTick(s);
    for (const event of index.eventsAt(s)) {
      if (event.kind !== "Hit" || event.target !== agent) continue;
      const owner = index.shots.get(event.bullet)?.agent;
      const at = row.agents.find(([id]) => id === owner);
      if (!at) return null;
      hits.push({ x: at[1], y: at[2] });
    }
    for (const [target, x, y] of row.tick === s ? (row.near ?? []) : []) if (target === agent) near.push({ x, y });
  }
  return [...hits, ...near];
}

async function checkRealMatch(page: Page, baseline: Leaks): Promise<void> {
  const real = await realMatchLog();
  const realPath = join(outDir, "match16.json");
  writeFileSync(realPath, JSON.stringify(real));
  const index = indexLog(real);
  const rowOf = (tick: number, id: string) => index.byTick(tick).agents.find(([a]) => a === id);
  const posOf = (tick: number, id: string): Vec2 => {
    const row = rowOf(tick, id);
    return row ? { x: row[1], y: row[2] } : { x: Number.NaN, y: Number.NaN };
  };
  const ticks = eventsOfKind(real, "Tick");
  const nearRows = ticks.reduce((n, t) => n + (t.near?.length ?? 0), 0);
  console.log(
    `  real match: ${real.config.mapId} seed ${real.seed}, ${index.agents.length} agents, ${index.lastTick} ticks, ` +
      `${eventsOfKind(real, "Hit").length} hits, ${nearRows} near-miss rows, ${index.deaths.size} deaths`,
  );
  await upload(page, realPath);
  check(
    "real match: Follow lists free and every spawned agent",
    isDeepStrictEqual(await followSelect(page).locator("option").allTextContents(), ["free", ...index.agents]) && index.agents.length === 16,
    `${index.agents.length} agents`,
  );

  // Follow the agent under the most fire (near misses and hits) through its fights.
  const fire = new Map<string, number>();
  for (const t of ticks) for (const [target] of t.near ?? []) fire.set(target, (fire.get(target) ?? 0) + 1);
  for (const hit of eventsOfKind(real, "Hit")) fire.set(hit.target, (fire.get(hit.target) ?? 0) + 1);
  const agent = [...fire].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "a0";
  const alive = (t: number) => rowOf(t, agent) !== undefined;
  const lastAlive = (index.deaths.get(agent)?.tick ?? index.lastTick + 1) - 1;
  const scale = (await state(page)).scale;
  const midPx = (OVERLAY.incomingFromPx + OVERLAY.incomingToPx) / 2;
  // A tick where a probe at the middle of the first red tick can only see the tick: no other
  // agent's marker or label within 25 px of it, no bullet dot within 6 px (markers and dots are
  // drawn over the overlay).
  const clearProbe = (t: number, source: Vec2): boolean => {
    const at = posOf(t, agent);
    const probeAt = along(at, vec2.angleOf(vec2.sub(source, at)), midPx / scale);
    const row = index.byTick(t);
    const px = (x: number, y: number) => vec2.dist(probeAt, { x, y }) * scale;
    return row.agents.every(([id, x, y]) => id === agent || px(x, y) >= 25) && row.bullets.every(([, x, y]) => px(x, y) >= 6);
  };
  const underFire = (t: number, kind: "near" | "hit"): boolean => {
    if (!alive(t)) return false;
    const sources = fireFrom(index, t, agent);
    const near = (index.byTick(t).near ?? []).filter(([target]) => target === agent).length;
    const hits = index.eventsAt(t).filter((e) => e.kind === "Hit" && e.target === agent).length;
    return sources !== null && sources.length > 0 && (kind === "near" ? near > 0 : hits > 0) && clearProbe(t, sources[0] ?? { x: 0, y: 0 });
  };
  const tickWith = (kind: "near" | "hit") => {
    for (let t = 1; t <= lastAlive; t++) if (underFire(t, kind)) return t;
    return undefined;
  };
  const nearTick = tickWith("near");
  const hitTick = tickWith("hit");

  await followSelect(page).selectOption(agent);
  await coneBox(page).check();
  for (const [kind, t] of [
    ["near-miss row", nearTick],
    ["hit", hitTick],
  ] as const) {
    if (t === undefined) {
      check(`real match: ${agent} takes a ${kind} somewhere the probe can see it`, false);
      continue;
    }
    await scrubTo(page, t);
    const drawn = await drawnOverlay(page);
    const at = posOf(t, agent);
    const want = (fireFrom(index, t, agent) ?? []).map((s) => vec2.angleOf(vec2.sub(s, at)));
    check(
      `real match, tick ${t} (${kind}): following ${agent}, the overlay has a red tick toward each source of fire the log names`,
      drawn !== null && drawn.tick === t && drawn.incoming.length === want.length && drawn.incoming.every((a, i) => Math.abs(normalizeDeg(a - (want[i] ?? Number.NaN))) <= 1),
      `ticks at ${JSON.stringify(drawn?.incoming)}, fire from ${JSON.stringify(want.map((a) => +a.toFixed(1)))}`,
    );
    const center = await canvasCenter(page);
    const angle = drawn?.incoming[0] ?? 0;
    const png = await page.locator("canvas").screenshot();
    await probe(page, png, [
      { name: `real match, tick ${t} (${kind}): the red tick is on the canvas`, at: vec2.add(center, vec2.scale(vec2.fromAngle(angle), midPx)), want: OVERLAY.incoming },
    ]);
    if (kind === "near-miss row") await page.locator(".replay").screenshot({ path: join(outDir, "overlay-16.png") });
  }

  // Playing at 1x through a fight: every frame's overlay is perceive's for its tick, the agent stays
  // centered, the dots are the Tick's bullets and no trail outlives its window. 120 frames cover
  // about 40 ticks: start at the first tick s with the agent alive through s + 45 and both fire
  // coming in and someone in sight within s + 2 .. s + 30.
  const model = new Map<number, DrawnOverlay>();
  for (let t = 0; t <= lastAlive; t++) model.set(t, overlayOf(index, real, t, agent));
  const busyFrom = (s: number) => {
    const span = Array.from({ length: 46 }, (_, k) => model.get(s + k));
    const middle = span.slice(2, 31);
    return span.every((m) => m?.cone === true) && middle.some((m) => (m?.incoming.length ?? 0) > 0) && middle.some((m) => (m?.visible.length ?? 0) > 0);
  };
  let from = 0;
  while (from + 45 <= lastAlive && !busyFrom(from)) from++;
  await speedSelect(page).selectOption("1");
  await scrubTo(page, from);
  await playButton(page).click();
  const played = await sampleFrames(page, 120);
  await playButton(page).click();
  const wrong = played.filter((f) => !isDeepStrictEqual(f.overlay, overlayOf(index, real, f.tick, agent)));
  const worst = played.reduce((max, f) => {
    const a = f.agents.find((x) => x.id === agent);
    const c = a ? markerCenter(a) : { x: Number.NaN, y: Number.NaN };
    return Math.max(max, Number.isNaN(c.x) ? Infinity : Math.hypot(c.x - f.center.x, c.y - f.center.y));
  }, 0);
  const inWindow = (id: string, t: number) => {
    for (let k = Math.max(0, t - TRAIL_TICKS + 1); k <= t; k++) if (index.byTick(k).bullets.some(([b]) => b === id)) return true;
    return false;
  };
  const bulletsOk = played.every(
    (f) =>
      f.bullets.trails.every(({ id }) => inWindow(id, f.tick)) &&
      isDeepStrictEqual(
        f.bullets.dots.map((d) => d.id),
        index.byTick(f.tick).bullets.map(([id]) => id),
      ),
  );
  const withFire = played.filter((f) => (f.overlay?.incoming.length ?? 0) > 0).length;
  const withSight = played.filter((f) => (f.overlay?.visible.length ?? 0) > 0).length;
  check(
    `real match at 1x, following ${agent}: every frame shows perceive's overlay for the tick on screen, ${agent} centered`,
    wrong.length === 0 && worst < 0.5 && withFire > 0 && withSight > 0 && new Set(played.map((f) => f.tick)).size > 20,
    `${played.length} frames, ticks ${played[0]?.tick}..${played.at(-1)?.tick}, ${withFire} with incoming fire, ${withSight} with someone seen, worst centering ${worst.toFixed(3)} px${wrong.length ? `; wrong at ${JSON.stringify(wrong.slice(0, 2))}` : ""}`,
  );
  check("real match at 1x: every frame's dots are the bullets of its Tick and no trail outlives its window", bulletsOk);

  // Resizing while following: still centered, at the new fitted zoom.
  await scrubTo(page, from);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForFunction((before) => window.__decisionArena?.scale !== before, scale);
  await frames2(page);
  const resized = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { w: c?.clientWidth ?? 0, h: c?.clientHeight ?? 0 };
  });
  const followed = (await drawnAgents(page)).find((a) => a.id === agent);
  const c700 = await canvasCenter(page);
  const at700 = followed ? markerCenter(followed) : { x: Number.NaN, y: Number.NaN };
  const realMap = getMap(real.config.mapId);
  const fitted = makeTransform(realMap.width, realMap.height, resized.w, resized.h, STAGE_PAD_PX).scale;
  check(
    `real match: after a resize while following ${agent}, it is still at the canvas center, at the new fitted zoom`,
    Math.hypot(at700.x - c700.x, at700.y - c700.y) < 0.5 && Math.abs((await state(page)).scale - fitted) < 1e-9,
    `marker ${at700.x.toFixed(2)},${at700.y.toFixed(2)} vs center ${c700.x},${c700.y}; scale ${(await state(page)).scale} vs fit ${fitted}`,
  );
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction((before) => window.__decisionArena?.scale === before, scale);
  await frames2(page);

  // A death: the followed agent's cone goes, the camera stays where its last row put it.
  const death = index.deaths.get(agent) ?? eventsOfKind(real, "Death")[0];
  if (death) {
    await followSelect(page).selectOption(death.agent);
    await scrubTo(page, death.tick - 1);
    const before = await drawnOverlay(page);
    await scrubTo(page, death.tick);
    const after = await drawnOverlay(page);
    const [lastPx] = await toPx(page, [posOf(death.tick - 1, death.agent)]);
    const mid = await canvasCenter(page);
    check(
      `real match: following ${death.agent} through its death at tick ${death.tick}: cone up to tick ${death.tick - 1}, then none, centered on its last row`,
      before?.cone === true &&
        isDeepStrictEqual(after, { tick: death.tick, agent: death.agent, cone: false, visible: [], incoming: [] }) &&
        Math.hypot((lastPx?.x ?? 0) - mid.x, (lastPx?.y ?? 0) - mid.y) < 0.5,
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
  } else check("real match: someone dies", false);

  // Frame timing at 1x through the same fight, everything on, then everything off.
  await followSelect(page).selectOption(agent);
  const on = await timePlayback(page, from, 3000);
  await followSelect(page).selectOption("free");
  await coneBox(page).uncheck();
  await trailsBox(page).uncheck();
  const bare = await timePlayback(page, from, 3000);
  console.log(`  timing, real match at 1x, follow ${agent} + trails + vision cone: ${showTiming(on)}`);
  console.log(`  timing, real match at 1x, free camera, no trails, no cone:   ${showTiming(bare)}`);
  check("budget: 60 fps at 1x with trails and the cone on (real 16-bot match)", smooth(on), showTiming(on));

  // Re-open the log while playing with follow, trails and the cone on: the new viewer starts the
  // view row over and the old one leaves nothing behind.
  await trailsBox(page).check();
  await followSelect(page).selectOption(agent);
  await coneBox(page).check();
  await scrubTo(page, from);
  await playButton(page).click();
  await page.waitForTimeout(300);
  await upload(page, realPath);
  const fresh = {
    follow: await followSelect(page).inputValue(),
    trails: await trailsBox(page).isChecked(),
    cone: await coneBox(page).isChecked(),
    overlay: await drawnOverlay(page),
    tick: (await state(page)).tick,
  };
  check(
    "re-opened while following with trails and the cone on: the new replay starts at tick 0 on free, trails on, cone off",
    isDeepStrictEqual(fresh, { follow: "free", trails: true, cone: false, overlay: null, tick: 0 }),
    JSON.stringify(fresh),
  );
  const left = await leaks(page);
  check(
    "re-mounting with follow, trails and the cone on leaves nothing behind (listeners, observers, WebGL contexts, canvases, view rows, mind panels)",
    isDeepStrictEqual(left, baseline),
    JSON.stringify(left),
  );
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  let server: ViteDevServer | undefined;
  let url = process.env.DECISION_ARENA_URL;
  if (!url) {
    server = await createServer({ root: webDir, logLevel: "warn", server: { port: 5174 } });
    await server.listen();
    url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("vite did not report a local URL");
  }
  console.log(`smoke: ${url}`);

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
      else if (msg.type() === "warning") console.log(`  console.warn: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.addInitScript(LEAK_PROBE);
    await page.goto(url);
    await page.waitForFunction(() => window.__decisionArena?.ready === true, undefined, { timeout: 20_000 });
    // Timings below depend on it: headless Chromium usually renders WebGL in software (SwiftShader).
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      const name = info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return name;
    });
    console.log(`smoke: WebGL renderer ${renderer}`);
    await page.evaluate("window.__smokeMarker = true"); // gone if the page ever reloads
    await frames2(page);
    const s = await state(page);
    check("ready at tick 0", s.ready && s.tick === 0, JSON.stringify(s));
    check("lastTick matches the sample log", s.lastTick === lastTick, `${s.lastTick} vs ${lastTick}`);

    await checkAspect(page, "1000x700");
    await checkFrame(page, "1000x700", 0, "tick0.png");

    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForFunction((before) => window.__decisionArena?.scale !== before, s.scale);
    await frames2(page);
    await checkAspect(page, "600x900");
    await checkFrame(page, "600x900", 0, "tick0-600x900.png");

    await page.setViewportSize({ width: 1000, height: 700 });
    await frames2(page);
    await checkPlayback(page);
    await page.screenshot({ path: join(outDir, "page.png") });
    await checkOverlays(page);
    // The UI shell reloads the page, so it runs before the files, which check that an upload
    // does not; the marker goes back after it.
    await checkUiShell(page);
    await page.evaluate("window.__smokeMarker = true");
    await checkMindPanel(page);
    const baseline = await checkFiles(page);
    await checkBusyLog(page);
    await checkRealMatch(page, baseline);

    check("zero console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
    await server?.close();
  }
  console.log(failures === 0 ? "smoke: all checks passed" : `smoke: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
