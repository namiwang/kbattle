export interface Env {
  // Static assets binding (web/dist). Only fetch is used, which keeps test fakes small.
  ASSETS: Pick<Fetcher, "fetch">;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/decide") {
      return Response.json({ error: "not implemented" }, { status: 501 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
