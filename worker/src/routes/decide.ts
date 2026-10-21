import { DecideRequestSchema } from "@kbattle/core";
import { mockAnswer } from "../decision/mock";

// Abuse hygiene until the real guard (DESIGN.md §5.7, v4.4): a real request is a few KB.
const MAX_BODY_BYTES = 16 * 1024;

/** POST /decide: validate a DecideRequest and answer it with a DoerAnswer (DESIGN.md §5.4). */
export async function decide(request: Request): Promise<Response> {
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
  return Response.json(mockAnswer(parsed.data));
}

function tooLarge(): Response {
  return Response.json({ error: "body too large" }, { status: 413 });
}
