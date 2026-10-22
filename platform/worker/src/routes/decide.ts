import { DecideRequestSchema, type DecideRequest, type DoerAnswer } from "@kbattle/core";
import { clefAnswer, DoerBackendError } from "../decision/clef";
import { mockAnswer } from "../decision/mock";
import type { Env } from "../index";

// Abuse hygiene until the real guard (DESIGN.md §5.7, v4.4): a real request is a few KB.
const MAX_BODY_BYTES = 16 * 1024;

/** POST /decide: validate a DecideRequest and answer it with a DoerAnswer (DESIGN.md §5.4). */
export async function decide(request: Request, env: Env): Promise<Response> {
  // A declared size over the limit is refused unread; a body without one is measured.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return tooLarge();
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = DecideRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return Response.json(await doerAnswer(env, parsed.data));
  } catch (error) {
    if (!(error instanceof DoerBackendError)) throw error;
    // The reason goes to the log as a second line (stderr, the wrangler terminal), never to the client.
    console.error(`POST /decide: ${error.message}`);
    if (error.status === 429) {
      const headers: Record<string, string> = error.retryAfter === undefined ? {} : { "retry-after": error.retryAfter };
      return Response.json({ error: "rate limited" }, { status: 429, headers });
    }
    return Response.json({ error: "doer backend failed" }, { status: 502 });
  }
}

/** The doer DOER_BACKEND names: "clef" asks Workers AI; anything else, or nothing, gets the mock. */
async function doerAnswer(env: Env, request: DecideRequest): Promise<DoerAnswer> {
  if (env.DOER_BACKEND !== "clef") return mockAnswer(request);
  if (env.AI === undefined) {
    throw new DoerBackendError('DOER_BACKEND is "clef" but there is no AI binding: run wrangler with --env live');
  }
  return clefAnswer(env.AI, request);
}

function tooLarge(): Response {
  return Response.json({ error: "body too large" }, { status: 413 });
}
