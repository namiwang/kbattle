// Headless browser smoke for the replay viewer. Not part of `pnpm test`; run
// `pnpm --filter web smoke`. Starts Vite on port 5174 (or opens KBATTLE_URL),
// loads the page in Playwright's chromium, waits for window.__kbattle.ready,
// checks canvas pixels against the sample log and the map, resizes the window,
// and saves screenshots under web/.smoke/. Exits 1 if any check fails.

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

    check("zero console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
    await server?.close();
  }
  console.log(failures === 0 ? "smoke: all checks passed" : `smoke: ${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
