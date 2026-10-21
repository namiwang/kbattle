// Headless browser smoke for the replay viewer. Not part of `pnpm test`; run
// `pnpm --filter web smoke`. Starts Vite on port 5174 (or opens KBATTLE_URL),
// loads the page in Playwright's chromium, waits for window.__kbattle.ready,
// checks canvas pixels against the sample log and the map, resizes the window,
// then drives the playback controls (keyboard, buttons, timeline drag, every
// speed) and checks the scene against the log at each stop. Screenshots go to
// web/.smoke/. Exits 1 if any check fails.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eventsOfKind, getMap, MatchLogSchema, type Vec2 } from "@kbattle/core";
import { chromium, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { DrawnAgent, KbattleDebug } from "../src/replay/debug";
import { COLORS, KIND_COLORS, MARKER } from "../src/replay/theme";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(webDir, ".smoke");
const log = MatchLogSchema.parse(JSON.parse(readFileSync(join(webDir, "../core/fixtures/sample-log.json"), "utf8")));
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
async function state(page: Page): Promise<Pick<KbattleDebug, "ready" | "tick" | "lastTick" | "scale">> {
  return page.evaluate(() => {
    const k = window.__kbattle;
    if (!k) throw new Error("window.__kbattle missing");
    return { ready: k.ready, tick: k.tick, lastTick: k.lastTick, scale: k.scale };
  });
}

async function toPx(page: Page, points: Vec2[]): Promise<Vec2[]> {
  return page.evaluate((pts) => pts.map((p) => window.__kbattle?.toPx(p) ?? { x: Number.NaN, y: Number.NaN }), points);
}

async function drawnAgents(page: Page): Promise<DrawnAgent[]> {
  return page.evaluate(() => window.__kbattle?.drawnAgents() ?? []);
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
      seen.push(window.__kbattle ? window.__kbattle.tick : -1);
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

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  let server: ViteDevServer | undefined;
  let url = process.env.KBATTLE_URL;
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

    await page.goto(url);
    await page.waitForFunction(() => window.__kbattle?.ready === true, undefined, { timeout: 20_000 });
    await frames2(page);
    const s = await state(page);
    check("ready at tick 0", s.ready && s.tick === 0, JSON.stringify(s));
    check("lastTick matches the sample log", s.lastTick === lastTick, `${s.lastTick} vs ${lastTick}`);

    await checkAspect(page, "1000x700");
    await checkFrame(page, "1000x700", 0, "tick0.png");

    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForFunction((before) => window.__kbattle?.scale !== before, s.scale);
    await frames2(page);
    await checkAspect(page, "600x900");
    await checkFrame(page, "600x900", 0, "tick0-600x900.png");

    await page.setViewportSize({ width: 1000, height: 700 });
    await frames2(page);
    await checkPlayback(page);
    await page.screenshot({ path: join(outDir, "page.png") });

    check("zero console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
    await server?.close();
  }
  console.log(failures === 0 ? "smoke: all checks passed" : `smoke: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
