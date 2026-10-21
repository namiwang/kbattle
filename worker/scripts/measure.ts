// One-off runner for the v0.5 Clef spike (plan/phase-0-foundations.md): POSTs
// core/fixtures/decide-request.json to /decide N times and prints latency per status (p50/p95/max),
// 429 details, the answers' schema check, the clef-flash cost estimate and one sample answer.
//
//   pnpm --filter worker exec tsx scripts/measure.ts [--n 60] [--url http://localhost:8787/decide] [--concurrency 1]
//
// Start the Worker first: `pnpm --filter worker dev` (mock) or `pnpm --filter worker dev --env live` (Clef).
// No retries and no pauses: a 429 is data. Exits 1 when no call got a 200.

import decideRequest from "../../core/fixtures/decide-request.json" with { type: "json" };
import { report, type Call } from "./measure-report";

// The Node globals used here. The worker tsconfig has workers-types only, where `process` is `any`.
declare const process: { argv: string[]; exitCode: number | undefined; exit(code: number): never };

/** Plan v0.5 budget: at most 500 calls for the whole spike (≤ $0.05). */
const MAX_CALLS = 500;

const options = parseOptions(process.argv.slice(2));
const body = JSON.stringify(decideRequest);
const calls: Call[] = [];
const started = performance.now();
let next = 0;

/** Sends one call at a time until N are out; `concurrency` lanes run side by side. */
async function lane(): Promise<void> {
  while (next < options.n) {
    const index = next++;
    calls[index] = await post(performance.now() - started);
  }
}

async function post(startMs: number): Promise<Call> {
  const sent = performance.now();
  try {
    const response = await fetch(options.url, { method: "POST", headers: { "content-type": "application/json" }, body });
    const text = await response.text();
    const retryAfter = response.headers.get("retry-after");
    return { startMs, ms: performance.now() - sent, status: response.status, body: text, retryAfter };
  } catch (error) {
    return { startMs, ms: performance.now() - sent, status: "error", body: describe(error), retryAfter: null };
  }
}

await Promise.all(Array.from({ length: options.concurrency }, lane));
console.log(report(calls, { url: options.url, concurrency: options.concurrency, elapsedMs: performance.now() - started }));
if (!calls.some((call) => call.status === 200)) process.exitCode = 1;

function parseOptions(args: string[]): { n: number; url: string; concurrency: number } {
  const parsed = { n: 60, url: "http://localhost:8787/decide", concurrency: 1 };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined) fail(`${flag} needs a value`);
    if (flag === "--url") parsed.url = value;
    else if (flag === "--n") parsed.n = positiveInt(flag, value);
    else if (flag === "--concurrency") parsed.concurrency = positiveInt(flag, value);
    else fail(`unknown option ${flag}; usage: measure.ts [--n 60] [--url ${parsed.url}] [--concurrency 1]`);
  }
  if (parsed.n > MAX_CALLS) fail(`--n ${parsed.n} is over the spike budget of ${MAX_CALLS} calls (plan v0.5)`);
  return parsed;
}

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`${flag} must be a positive integer, got ${value}`);
  return n;
}

function fail(message: string): never {
  console.error(`measure: ${message}`);
  process.exit(2);
}

/** "TypeError: fetch failed (ECONNREFUSED)": Node's fetch puts the reason in error.cause. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const reason = cause instanceof Error ? ` (${"code" in cause ? String(cause.code) : cause.message})` : "";
  return `${error.name}: ${error.message}${reason}`;
}
