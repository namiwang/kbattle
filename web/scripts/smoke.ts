// Headless browser smoke for the page. Not part of `pnpm test`; run
// `pnpm --filter web smoke`. Starts Vite on port 5174 (or opens KBATTLE_URL),
// loads the page in Playwright's chromium, waits for window.__kbattle.ready,
// checks canvas pixels against the sample log and the map, resizes the window,
// then drives the playback controls (keyboard, buttons, timeline drag, every
// speed) and checks the scene against the log at each stop. Then the UI shell
// (v4.1): key, prompts and match form survive a reload, Clear key and no-key
// mode, the form check through window.__kbattle.validateForm(). Then the files
// (v2.5): uploads through the file input (good, schema-bad, not JSON), checks
// that each re-mount leaves no listener, observer or WebGL context behind,
// downloads and re-opens the log, drops a file, and times a 5 MB upload.
// Screenshots and the downloaded file go to web/.smoke/. Exits 1 if any check
// fails.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { eventsOfKind, getMap, MatchLogSchema, type Event as LogEvent, type MatchLog, type Vec2 } from "@kbattle/core";
import { chromium, type Locator, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { DrawnAgent, KbattleDebug } from "../src/replay/debug";
import { COLORS, KIND_COLORS, MARKER } from "../src/replay/theme";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(webDir, ".smoke");
const samplePath = join(webDir, "../core/fixtures/sample-log.json");
const badPath = join(webDir, "../core/fixtures/bad/unknown-event-kind.json"); // one issue, at events[5].kind
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

// ---- UI shell (v4.1): key, mind, match form, localStorage ----

const STORED = Object.freeze({ key: "kbattle:v1:anthropic-key", prompts: "kbattle:v1:prompts", config: "kbattle:v1:config" });
const SMOKE_KEY = "sk-ant-smoke-not-a-real-key";

async function stored(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), Object.values(STORED));
}

/** Runs the check behind Run match through the debug hook; returns the text it shows. */
async function validateForm(page: Page): Promise<string> {
  return page.evaluate(() => window.__kbattle?.validateForm() ?? "window.__kbattle missing");
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
    "first visit: the default form, arena-1, seed 1, 8 slots, 0 doer-only, 6000 ticks shown as 300 s",
    isDeepStrictEqual(form, { map: "arena-1", seed: "1", slots: "8", doerOnly: "0", duration: "6000", seconds: "= 300 s" }),
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
    "localStorage holds the key as text, the prompts and the form as JSON, under kbattle:v1:*",
    saved[STORED.key] === SMOKE_KEY && parsed(saved[STORED.prompts]).thinkerSystem === prompt && parsed(saved[STORED.config]).seed === 4242,
    JSON.stringify(saved),
  );

  // Reload: everything comes back.
  await page.reload();
  await page.waitForFunction(() => window.__kbattle?.ready === true, undefined, { timeout: 20_000 });
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

// ---- files (v2.5) ----

// Installed before the page's own scripts. Counts what a mounted viewer holds on to:
// listeners on window and document, live ResizeObservers, live WebGL contexts. After a
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
    };
  };
})()`;

interface Leaks {
  listeners: Record<string, number>;
  resizeObservers: number;
  webglContexts: number;
  canvases: number;
  viewers: number;
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
    (n) => performance.getEntriesByName("replay-open", "measure").length > n && window.__kbattle?.ready === true,
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
  return { version: 1, config: { mapId: "arena-1", seed: 7, durationTicks: tick, slots }, seed: 7, prompts: log.prompts, events };
}

async function checkFiles(page: Page): Promise<void> {
  // Per mounted viewer Pixi adds a ResizeObserver of its own (accessibility CanvasObserver) and keeps
  // one global test WebGL context, so these counts are compared with the baseline, not with 1.
  const baseline = await leaks(page);
  check(
    "one viewer mounted: one .replay, one canvas, one keydown listener on document",
    baseline.viewers === 1 && baseline.canvases === 1 && baseline.listeners["document:keydown"] === 1,
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
  check("download is named kbattle-<mapId>-<seed>.json", download.suggestedFilename() === `kbattle-${log.config.mapId}-${log.seed}.json`, download.suggestedFilename());
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

    await page.addInitScript(LEAK_PROBE);
    await page.goto(url);
    await page.waitForFunction(() => window.__kbattle?.ready === true, undefined, { timeout: 20_000 });
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
    await page.waitForFunction((before) => window.__kbattle?.scale !== before, s.scale);
    await frames2(page);
    await checkAspect(page, "600x900");
    await checkFrame(page, "600x900", 0, "tick0-600x900.png");

    await page.setViewportSize({ width: 1000, height: 700 });
    await frames2(page);
    await checkPlayback(page);
    await page.screenshot({ path: join(outDir, "page.png") });
    // The UI shell reloads the page, so it runs before the files, which check that an upload
    // does not; the marker goes back after it.
    await checkUiShell(page);
    await page.evaluate("window.__smokeMarker = true");
    await checkFiles(page);

    check("zero console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
    await server?.close();
  }
  console.log(failures === 0 ? "smoke: all checks passed" : `smoke: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
