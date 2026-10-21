import type { AiBinding } from "./decision/clef";
import { decide } from "./routes/decide";

export interface Env {
  // Static assets binding (web/dist). Only fetch is used, which keeps test fakes small.
  ASSETS: Pick<Fetcher, "fetch">;
  /** [vars]: which doer answers /decide. "clef" is Workers AI (needs AI); anything else, or nothing, is the mock. */
  DOER_BACKEND?: string;
  /** Workers AI, bound only under `--env live` (wrangler.toml, ISSUES I-001). */
  AI?: AiBinding;
}

/** Browser origins allowed to call /decide cross-origin: the Vite dev server. The deployed app is same-origin. */
const ALLOWED_ORIGINS: readonly string[] = ["http://localhost:5173", "http://127.0.0.1:5173"];

const PREFLIGHT_HEADERS = { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/decide" && (request.method === "POST" || request.method === "OPTIONS")) {
      const started = Date.now();
      const response = withCors(
        request,
        request.method === "POST"
          ? await decide(request, env)
          : new Response(null, { status: 204, headers: PREFLIGHT_HEADERS }),
      );
      // One line per request, never the body: method, path, status, duration, declared size.
      const size = request.headers.get("content-length") ?? "-";
      console.log(`${request.method} ${pathname} ${response.status} ${Date.now() - started}ms content-length=${size}`);
      return response;
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Lets an allowed origin read the response; the response varies by Origin either way. */
function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  if (origin !== null && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("access-control-allow-origin", origin);
  }
  response.headers.append("vary", "Origin");
  return response;
}
