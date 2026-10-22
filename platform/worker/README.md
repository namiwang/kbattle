# worker

The Decision Arena Worker (DESIGN.md §5.2, §5.7): serves the web build (`../web/dist`) and answers
`POST /decide`, the doer call, with a `DoerAnswer` (§5.4).

## Doer backend

`DOER_BACKEND` in `wrangler.toml` picks what answers `/decide`:

| Value | Answer | Needs |
|---|---|---|
| `mock` (top-level `[vars]`) | First option of every choice at probability 1, every noul 0, `model: "mock"` | nothing |
| `clef` (`--env live`) | `@cf/cloudflare/clef-flash` (`DOER_MODEL`) on Workers AI, through the `AI` binding | a Cloudflare account with Workers AI |

Any other value, or none, gets the mock. The top level has no `[ai]` binding because with one
`wrangler dev` needs a Cloudflare login (ISSUES I-001); `[env.live]` adds it.

With `clef`, a Workers AI 429 becomes `429 {"error":"rate limited"}`. Any other failure (a Workers AI
error, an answer that fails `DoerAnswerSchema`, no `AI` binding) becomes `502 {"error":"doer backend
failed"}`. The reason goes to the wrangler terminal, never to the client. The Worker does not retry;
the browser backs off (§5.5).

## Run with the mock (no account needed)

```sh
pnpm --filter web build      # wrangler serves platform/web/dist, so it must exist
pnpm --filter worker dev     # http://localhost:8787
curl --noproxy '*' -X POST http://localhost:8787/decide \
  -H 'content-type: application/json' --data @platform/core/fixtures/decide-request.json
```

`--noproxy '*'` is needed in a shell that exports `http_proxy` (ISSUES I-006). `measure.ts` uses
Node's `fetch`, which ignores it.

## Run live (Clef on Workers AI)

Budget for the v0.5 spike: at most 500 calls and $0.05 in total (plan/phase-0-foundations.md, v0.5).
`measure.ts` refuses `--n` over 500. At about 600 input tokens per call, 500 calls cost about $0.011.

```sh
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...   # or run `wrangler login` once
pnpm --filter worker dev --env live
# in a second terminal:
pnpm --filter worker exec tsx scripts/measure.ts --n 60
```

`--env live` sets `DOER_BACKEND = "clef"` and binds `AI`. The AI binding is always remote, so even
`wrangler dev` calls Workers AI on the account and is billed. The token needs Workers AI access and
enough Workers permissions for wrangler's remote-binding session; `wrangler login` grants both.
Deploying later: `pnpm --filter worker exec wrangler deploy --env live`. The Worker name is then
`decision-arena-live`; v4.5 picks the public one.

## Measure

`scripts/measure.ts` POSTs `platform/core/fixtures/decide-request.json` to `/decide` N times, one at a time
unless told otherwise, and prints:

- latency per HTTP status: p50, p95 and max (nearest-rank)
- 429 details: count, the first one (call number, seconds in, request rate until then), Retry-After, body
- how many 200s pass `DoerAnswerSchema`, and the model that answered
- the cost from `usage.input_tokens` at $0.038 per million, also per prompted slot per match (600 calls, §9)
- one sample answer

Options: `--n` (default 60, at most 500), `--url` (default `http://localhost:8787/decide`),
`--concurrency` (default 1). It never retries or pauses, so a 429 is data. It exits 1 when no call
got a 200.

## Tests

`pnpm --filter worker test` makes no network calls; Workers AI is faked in `test/clef.test.ts`.
