// The pure half of scripts/measure.ts (plan v0.5): turns the calls it made into the printed report.
// Latency is nearest-rank per HTTP status; cost comes from usage.input_tokens of the valid answers.

import { DOER_INTERVAL_TICKS, MATCH_DURATION_TICKS } from "@decision-arena/core";
import { DoerAnswerSchema, type DoerAnswer } from "@decision-arena/core/legacy";

/** clef-flash price per million input tokens (Workers AI model page, 2026-10-21); output tokens are free. */
const USD_PER_MILLION_INPUT_TOKENS = 0.038;
/** Doer calls one prompted slot makes in a match: 600 (DESIGN.md §9). */
const CALLS_PER_SLOT_PER_MATCH = MATCH_DURATION_TICKS / DOER_INTERVAL_TICKS;

/** One POST /decide as measure.ts saw it. */
export interface Call {
  /** When it was sent, in ms since the run started. */
  startMs: number;
  /** From send to the last byte of the body, in ms. */
  ms: number;
  /** The HTTP status, or "error" when no response came back. */
  status: number | "error";
  /** The response body, or the network error. */
  body: string;
  /** The Retry-After header, if any. */
  retryAfter: string | null;
}

export interface Run {
  url: string;
  concurrency: number;
  elapsedMs: number;
}

/** Nearest-rank percentile of ascending values: the smallest value with at least p% of the values at or below it. */
export function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

export function report(calls: readonly Call[], run: Run): string {
  const indexed = calls.map((call, index) => ({ call, index }));
  const lines = [
    `POST ${run.url}: ${calls.length} calls in ${(run.elapsedMs / 1000).toFixed(1)} s, concurrency ${run.concurrency} ` +
      `(${perMinute(calls.length, run.elapsedMs)} calls/min)`,
    "",
    ...latencyTable(calls),
    "",
  ];

  const oks = indexed.filter(({ call }) => call.status === 200);
  const valid: { index: number; answer: DoerAnswer }[] = [];
  let firstInvalid: string | undefined;
  for (const { call, index } of oks) {
    const parsed = DoerAnswerSchema.safeParse(parseJson(call.body));
    if (parsed.success) {
      valid.push({ index, answer: parsed.data });
    } else {
      const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
      firstInvalid ??= `first invalid 200 (call ${index + 1}): ${issues.join("; ")}`;
    }
  }
  const models = countBy(valid.map(({ answer }) => answer.model));
  lines.push(
    valid.length === 0
      ? `answers: none valid (${oks.length} 200s)`
      : `answers: ${valid.length} of ${oks.length} 200s pass DoerAnswerSchema; model ${models}`,
  );
  if (firstInvalid !== undefined) lines.push(firstInvalid);

  const limited = indexed.filter(({ call }) => call.status === 429);
  const first = limited[0];
  if (first === undefined) {
    lines.push("429: none");
  } else {
    const rate = first.call.startMs > 0 ? ` (${perMinute(first.index, first.call.startMs)} calls/min)` : "";
    const retryAfters = [...new Set(limited.map(({ call }) => call.retryAfter ?? "none"))].join(", ");
    lines.push(
      `429: ${limited.length} of ${calls.length} calls; first at call ${first.index + 1}, ` +
        `${(first.call.startMs / 1000).toFixed(1)} s in, after ${first.index} calls${rate}; ` +
        `Retry-After: ${retryAfters}; body ${clip(first.call.body)}`,
    );
  }

  for (const status of statuses(calls)) {
    if (status === 200 || status === 429) continue;
    const body = clip(calls.find((call) => call.status === status)?.body ?? "");
    if (status === "error") lines.push(`error: ${body}; is the Worker running at ${run.url}?`);
    else lines.push(`${status}: first body ${body}${status === 502 ? " (the reason is in the wrangler dev log)" : ""}`);
  }

  const sample = valid[0];
  if (sample !== undefined) {
    const tokens = valid.reduce((sum, { answer }) => sum + (answer.usage?.input_tokens ?? 0), 0);
    const perAnswer = tokens / valid.length;
    lines.push(
      `cost: ${tokens} input tokens, ${Math.round(perAnswer)} per answer → $${usd(tokens)} for these ${valid.length}; ` +
        `$${usd(perAnswer * CALLS_PER_SLOT_PER_MATCH)} per prompted slot per match (${CALLS_PER_SLOT_PER_MATCH} calls)`,
      `sample answer (call ${sample.index + 1}), model ${sample.answer.model}, usage ${JSON.stringify(sample.answer.usage)}:`,
      ...Object.entries(sample.answer.answers).map(([id, answer]) => `  ${id}: ${JSON.stringify(answer)}`),
    );
  }
  return lines.join("\n");
}

/** Rows of status, calls, p50, p95 and max latency in ms; "error" (no response) last. */
function latencyTable(calls: readonly Call[]): string[] {
  const rows = ["status  calls  p50 ms  p95 ms  max ms"];
  for (const status of statuses(calls)) {
    const ms = calls.filter((call) => call.status === status).map((call) => call.ms);
    ms.sort((a, b) => a - b);
    const cells = [percentile(ms, 50), percentile(ms, 95), percentile(ms, 100)].map((v) => v.toFixed(1).padStart(6));
    rows.push(`${String(status).padEnd(6)}  ${String(ms.length).padStart(5)}  ${cells.join("  ")}`);
  }
  return rows;
}

function statuses(calls: readonly Call[]): (number | "error")[] {
  return [...new Set(calls.map((call) => call.status))].sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : a === "error" ? 1 : -1,
  );
}

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value} ×${n}`).join(", ");
}

function perMinute(count: number, ms: number): number {
  return Math.round((count * 60_000) / ms);
}

function usd(inputTokens: number): string {
  return ((inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1_000_000).toFixed(6);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
