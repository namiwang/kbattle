import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeEnv } from "./fake-env";

describe("worker fetch handler", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/decide"],
    ["POST", "/elsewhere"],
    ["OPTIONS", "/elsewhere"],
  ])("passes %s %s through to the static assets", async (method, path) => {
    const { env, assetsFetch } = fakeEnv();
    const request = new Request(`http://localhost${path}`, { method });

    const response = await worker.fetch(request, env);

    expect(assetsFetch).toHaveBeenCalledExactlyOnceWith(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>hello kbattle</h1>");
  });
});
