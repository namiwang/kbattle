import { describe, expect, it } from "vitest";
import { percentile, report, type Call } from "../scripts/measure-report";

const RUN = { url: "http://localhost:8787/decide", concurrency: 1, elapsedMs: 3000 };

function answer(inputTokens: number, model = "clef-flash"): string {
  return JSON.stringify({
    model,
    answers: { fire: { type: "noul", noul: 0.82 }, escalate: { type: "noul", noul: 0.07 } },
    usage: { input_tokens: inputTokens, output_tokens: 0 },
  });
}

function call(status: Call["status"], ms: number, body = "", extra: Partial<Call> = {}): Call {
  return { startMs: 0, ms, status, body, retryAfter: null, ...extra };
}

describe("percentile", () => {
  it("is nearest-rank: the smallest value with at least p% of the values at or below it", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);

    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("report", () => {
  it("prints latency per status, schema-valid answers, no 429, the cost and a sample answer", () => {
    const calls = [call(200, 30, answer(500)), call(200, 10, answer(520)), call(200, 20, answer(540))];

    const text = report(calls, RUN);

    expect(text).toContain("POST http://localhost:8787/decide: 3 calls in 3.0 s, concurrency 1 (60 calls/min)");
    expect(text).toMatch(/^status\s+calls\s+p50 ms\s+p95 ms\s+max ms$/m);
    expect(text).toMatch(/^200\s+3\s+20\.0\s+30\.0\s+30\.0$/m);
    expect(text).toContain("answers: 3 of 3 200s pass DoerAnswerSchema; model clef-flash ×3");
    expect(text).toContain("429: none");
    // 1,560 tokens at $0.038 per million; 520 per answer × 600 calls per prompted slot per match.
    expect(text).toContain("cost: 1560 input tokens, 520 per answer → $0.000059 for these 3; $0.011856 per prompted slot per match (600 calls)");
    expect(text).toContain(
      'sample answer (call 1), model clef-flash, usage {"input_tokens":500,"output_tokens":0}:\n' +
        '  fire: {"type":"noul","noul":0.82}\n' +
        '  escalate: {"type":"noul","noul":0.07}',
    );
  });

  it("details 429s, other failures and network errors, and counts only schema-valid answers", () => {
    const calls = [
      call(200, 40, answer(600)),
      call(200, 50, '{"model":"clef-flash","answers":{"fire":{"type":"noul","noul":1.7}}}'),
      call(429, 5, '{"error":"rate limited"}', { startMs: 2500, retryAfter: "2" }),
      call(429, 7, '{"error":"rate limited"}', { startMs: 2600 }),
      call(502, 9, '{"error":"doer backend failed"}'),
      call("error", 1, "TypeError: fetch failed (ECONNREFUSED)"),
    ];

    const text = report(calls, RUN);

    expect(text).toMatch(/^200\s+2\s+40\.0\s+50\.0\s+50\.0$/m);
    expect(text).toMatch(/^429\s+2\s+5\.0\s+7\.0\s+7\.0$/m);
    expect(text).toMatch(/^502\s+1\s+9\.0\s+9\.0\s+9\.0$/m);
    expect(text).toMatch(/^error\s+1\s+1\.0\s+1\.0\s+1\.0$/m);
    expect(text).toContain("answers: 1 of 2 200s pass DoerAnswerSchema; model clef-flash ×1");
    expect(text).toContain("first invalid 200 (call 2): answers.fire.noul: Too big: expected number to be <=1");
    expect(text).toContain(
      '429: 2 of 6 calls; first at call 3, 2.5 s in, after 2 calls (48 calls/min); Retry-After: 2, none; body {"error":"rate limited"}',
    );
    expect(text).toContain('502: first body {"error":"doer backend failed"} (the reason is in the wrangler dev log)');
    expect(text).toContain("error: TypeError: fetch failed (ECONNREFUSED); is the Worker running at http://localhost:8787/decide?");
    expect(text).toContain("cost: 600 input tokens, 600 per answer");
  });

  it("says so when no call returned a valid answer", () => {
    const text = report([call("error", 1, "TypeError: fetch failed (ECONNREFUSED)")], RUN);

    expect(text).toContain("answers: none valid");
    expect(text).not.toContain("sample answer");
  });
});
