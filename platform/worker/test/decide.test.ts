import { DoerAnswerSchema } from "@decision-arena/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import clientModel from "../../core/fixtures/bad/decide-request-client-model.json" with { type: "json" };
import oneTargetOption from "../../core/fixtures/bad/decide-request-one-target-option.json" with { type: "json" };
import unknownQuestion from "../../core/fixtures/bad/decide-request-unknown-question.json" with { type: "json" };
import decideRequest from "../../core/fixtures/decide-request.json" with { type: "json" };
import worker from "../src/index";
import { fakeEnv } from "./fake-env";

// The Worker logs every /decide request; keep test output quiet and let the log test read the lines.
let log: MockInstance<typeof console.log>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function postDecide(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/decide", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function preflight(origin: string): Request {
  return new Request("http://localhost/decide", {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
}

/** The valid fixture padded with trailing spaces (still valid JSON) to exactly `bytes` bytes. */
function paddedRequest(bytes: number): string {
  const json = JSON.stringify(decideRequest);
  return json + " ".repeat(bytes - new TextEncoder().encode(json).byteLength);
}

describe("POST /decide", () => {
  it("answers a valid DecideRequest with the mock DoerAnswer: first option certain, every noul 0", async () => {
    const { env, assetsFetch } = fakeEnv();

    const response = await worker.fetch(postDecide(JSON.stringify(decideRequest)), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body: unknown = await response.json();
    expect(DoerAnswerSchema.safeParse(body).error).toBeUndefined();
    // move and turn criteria come out of DecideRequest in enum order, so their first option is fixed.
    expect(body).toEqual({
      model: "mock",
      answers: {
        move: {
          type: "choice",
          choice: "forward",
          probabilities: { forward: 1, back: 0, left: 0, right: 0, stop: 0 },
          confidence: 1,
        },
        turn: {
          type: "choice",
          choice: "left",
          probabilities: { left: 1, right: 0, none: 0, face_target: 0 },
          confidence: 1,
        },
        fire: { type: "noul", noul: 0 },
        target: { type: "choice", choice: "a3", probabilities: { a3: 1, none: 0 }, confidence: 1 },
        escalate: { type: "noul", noul: 0 },
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("answers exactly the questions asked, each choice with its first option", async () => {
    const { fire, target } = decideRequest.questions;
    const request = {
      state: decideRequest.state,
      questions: { fire, target: { ...target, criteria: { none: "No target.", a3: target.criteria.a3 } } },
    };

    const response = await worker.fetch(postDecide(JSON.stringify(request)), fakeEnv().env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      model: "mock",
      answers: {
        fire: { type: "noul", noul: 0 },
        target: { type: "choice", choice: "none", probabilities: { none: 1, a3: 0 }, confidence: 1 },
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  it.each([
    ["broken JSON", '{"state": {'],
    ["an empty body", ""],
  ])("answers %s with 400 invalid json", async (_name, body) => {
    const response = await worker.fetch(postDecide(body), fakeEnv().env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid json" });
  });

  it.each([
    ["a client-chosen model", clientModel, { code: "unrecognized_keys", keys: ["model"], path: [] }],
    ["an unknown question", unknownQuestion, { code: "unrecognized_keys", keys: ["jump"], path: ["questions"] }],
    ["a target with one option", oneTargetOption, { code: "custom", path: ["questions", "target", "criteria"] }],
  ])("answers a request with %s with 400 and the zod issues", async (_name, body, issue) => {
    const response = await worker.fetch(postDecide(JSON.stringify(body)), fakeEnv().env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid request", issues: [issue] });
  });

  it("answers a body over 16 KB with 413, even when it is a valid request", async () => {
    const response = await worker.fetch(postDecide(paddedRequest(16 * 1024 + 1)), fakeEnv().env);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "body too large" });
  });

  it("answers a declared content-length over 16 KB with 413 without reading the body", async () => {
    const response = await worker.fetch(postDecide("{}", { "content-length": String(16 * 1024 + 1) }), fakeEnv().env);

    expect(response.status).toBe(413);
  });

  it("accepts a body of exactly 16 KB", async () => {
    const response = await worker.fetch(postDecide(paddedRequest(16 * 1024)), fakeEnv().env);

    expect(response.status).toBe(200);
  });
});

describe("CORS for the Vite dev server", () => {
  it.each(["http://localhost:5173", "http://127.0.0.1:5173"])(
    "answers a preflight from %s with 204 and the CORS headers",
    async (origin) => {
      const { env, assetsFetch } = fakeEnv();

      const response = await worker.fetch(preflight(origin), env);

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-methods")).toBe("POST");
      expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
      expect(response.headers.get("vary")).toBe("Origin");
      expect(assetsFetch).not.toHaveBeenCalled();
    },
  );

  it("answers a preflight from an origin not on the list without an allow-origin header", async () => {
    const response = await worker.fetch(preflight("http://localhost:5174"), fakeEnv().env);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    ["an answer", JSON.stringify(decideRequest), 200],
    ["an invalid request", "{}", 400],
    ["an oversized body", paddedRequest(16 * 1024 + 1), 413],
  ])("lets an allowed origin read %s to POST /decide", async (_name, body, status) => {
    const origin = "http://127.0.0.1:5173";

    const response = await worker.fetch(postDecide(body, { origin }), fakeEnv().env);

    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("does not let another origin read a POST /decide answer", async () => {
    const response = await worker.fetch(
      postDecide(JSON.stringify(decideRequest), { origin: "https://example.com" }),
      fakeEnv().env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("request log", () => {
  it("logs one line per /decide request: method, path, status, duration and content-length, no body", async () => {
    const body = JSON.stringify(decideRequest);
    const length = new TextEncoder().encode(body).byteLength;

    await worker.fetch(postDecide(body, { "content-length": String(length) }), fakeEnv().env);
    await worker.fetch(preflight("http://localhost:5173"), fakeEnv().env);

    expect(log).toHaveBeenCalledTimes(2);
    const [postLine, preflightLine] = log.mock.calls.map((args) => args.join(" "));
    expect(postLine).toMatch(new RegExp(`^POST /decide 200 \\d+ms content-length=${length}$`));
    expect(preflightLine).toMatch(/^OPTIONS \/decide 204 \d+ms content-length=-$/);
  });
});
