import { DOER_MODEL } from "@decision-arena/core";
import { DoerAnswerSchema, type DecideRequest, type DoerAnswer } from "@decision-arena/core/legacy";

/**
 * The slice of the Workers AI binding (env.AI) the Clef adapter calls. clef-flash is not in workers-types'
 * model map, so on the real `Ai` this is run's unknown-model overload and needs no cast (test/clef.test.ts).
 */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * A doer backend call that failed. The route logs the message (never sends it) and answers 429 when the
 * upstream status is 429, else 502. No retries in the Worker: the browser backs off (DESIGN.md §5.5).
 */
export class DoerBackendError extends Error {
  /** The upstream HTTP status, when known. */
  readonly status: number | undefined;
  /** The upstream Retry-After, when it sent one. */
  readonly retryAfter: string | undefined;

  constructor(message: string, upstream: { status?: number | undefined; retryAfter?: string | undefined } = {}) {
    super(message);
    this.name = "DoerBackendError";
    this.status = upstream.status;
    this.retryAfter = upstream.retryAfter;
  }
}

// Clef's request body names the model without the catalog prefix: "@cf/cloudflare/clef-flash" → "clef-flash".
const CLEF_MODEL = DOER_MODEL.slice(DOER_MODEL.lastIndexOf("/") + 1);

/** Asks Clef (DOER_MODEL on Workers AI) the request's questions (DESIGN.md §5.4) and returns its answer. */
export async function clefAnswer(ai: AiBinding, request: DecideRequest): Promise<DoerAnswer> {
  let output: unknown;
  try {
    output = await ai.run(DOER_MODEL, { model: CLEF_MODEL, ...request });
  } catch (error) {
    // workerd's Ai.run (cloudflare-internal:ai-api) throws InferenceUpstreamError("<internal code>: <description>")
    // without the HTTP status or headers, and records the status on the binding as lastRequestHttpStatusCode.
    // That record is shared by concurrent calls in one isolate, and a failure before any HTTP response leaves
    // the previous call's status there: good enough to tell a 429 from a failure. An error that carries its
    // own status (and Retry-After) wins.
    const status = httpStatus(field(error, "status")) ?? httpStatus(field(ai, "lastRequestHttpStatusCode"));
    const retryAfter = field(error, "retryAfter");
    throw new DoerBackendError(`${DOER_MODEL} failed${status === undefined ? "" : ` with HTTP ${status}`}: ${describe(error)}`, {
      status,
      retryAfter: typeof retryAfter === "string" || typeof retryAfter === "number" ? String(retryAfter) : undefined,
    });
  }
  const parsed = DoerAnswerSchema.safeParse(output);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
    throw new DoerBackendError(`${DOER_MODEL} answer does not match DoerAnswerSchema (${issues.join("; ")}): ${excerpt(output)}`);
  }
  return parsed.data;
}

/** A property of a thrown value, when it is an object. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** An HTTP error status, or undefined. */
function httpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Up to 1,000 characters of a value as JSON, for the log. */
function excerpt(value: unknown): string {
  return (JSON.stringify(value) ?? String(value)).slice(0, 1000);
}
