import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

function fakeEnv() {
  const assetsFetch = vi.fn<Env["ASSETS"]["fetch"]>(
    async () => new Response("<h1>hello kbattle</h1>"),
  );
  const env: Env = { ASSETS: { fetch: assetsFetch } };
  return { env, assetsFetch };
}

describe("worker fetch handler", () => {
  it("answers POST /decide with 501 and a JSON error", async () => {
    const { env, assetsFetch } = fakeEnv();
    const request = new Request("http://localhost/decide", {
      method: "POST",
      body: "{}",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(501);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "not implemented" });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/"],
    ["GET", "/decide"],
    ["POST", "/elsewhere"],
  ])("passes %s %s through to the static assets", async (method, path) => {
    const { env, assetsFetch } = fakeEnv();
    const request = new Request(`http://localhost${path}`, { method });

    const response = await worker.fetch(request, env);

    expect(assetsFetch).toHaveBeenCalledExactlyOnceWith(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>hello kbattle</h1>");
  });
});
