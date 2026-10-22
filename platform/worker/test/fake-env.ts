import { vi } from "vitest";
import type { Env } from "../src/index";

/** An Env whose static assets answer every request with the hello page. */
export function fakeEnv() {
  const assetsFetch = vi.fn<Env["ASSETS"]["fetch"]>(async () => new Response("<h1>hello Decision Arena</h1>"));
  const env: Env = { ASSETS: { fetch: assetsFetch } };
  return { env, assetsFetch };
}
