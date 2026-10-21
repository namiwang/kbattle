# ISSUES

Running log of uncertainties, defects and decisions taken while executing
`plan/`. Newest at the bottom. Status: `open`, `resolved`, or
`blocked-on-nami`. Each entry says what was decided and what it costs if
the decision is wrong.

## I-001 Cloudflare credentials absent — blocked-on-nami

wrangler's stored OAuth token has expired and cannot be refreshed in a
non-interactive session; no `CLOUDFLARE_API_TOKEN` in the environment.
Blocks the live parts of v0.5 (Clef spike), v3.1 (real Worker smoke),
v4.4 (guard) and v4.5 (deploy). Everything else proceeds with mocks and
fakes. To unblock: run `wrangler login` in a terminal, or export
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with Workers AI access.
Observed at v0.4: with an `[ai]` binding in `wrangler.toml`, `wrangler dev`
tries to refresh the token, fails (400) and exits 1 without listening;
`wrangler dev --local` starts but AI calls still go remote and would fail.
So the binding stays commented out until a token exists, and v0.5 must
switch between Clef and the mock on an explicit variable, not on `env.AI`.

## I-002 Anthropic API key absent — blocked-on-nami

No `ANTHROPIC_API_KEY` in the environment. Blocks the live parts of v0.6,
v3.2, v3.4, v3.5, v3.6 and the bad-key check in v4.2. Unit tests with fake
providers proceed. To unblock: export `ANTHROPIC_API_KEY`, or paste a key
into the spike page when it exists.

## I-003 Plan tooling mismatch — resolved

The executing-plans helper scripts expect `## Task N` headings; this plan
uses `## vX.Y - slug`. Ledger kept by hand at
`.superpowers/sdd/kbattle-plan/progress.md` (git-ignored); each
milestone's brief is its plan section plus the shared brief in the same
directory. Cost if wrong: none, bookkeeping only.

## I-004 Clef wire shape — resolved

Cloudflare docs (`developers.cloudflare.com/workers-ai/models/clef-flash/`)
confirm the request shape in DESIGN.md §5.4: `model`, `state`
(string | object | array), `questions{id: {type, instructions,
criteria}}` with types `noul`, `choice` and also `score`. Response is
`{ model, answers{id: ...}, usage{input_tokens, output_tokens} }`; from
the published output schema an answer is `{type:"noul", noul}` (P(yes)),
`{type:"choice", choice, probabilities, confidence}` or `{type:"score",
score, legend, probabilities, confidence}`. The v0.3 `DoerAnswer` schema
mirrors this exactly, so the Worker stays a thin proxy and the mind panel
gets the raw probabilities. Pricing $0.038 per million
input tokens, output free, context 24,576 tokens. Rate limit not stated on
the model page. Clef was released 2026-10-01 and is Jev-API compatible.

## I-005 `target` question needs two or more options — resolved

Clef's input schema requires 2 to 255 options for a `choice` question,
and `instructions` must be non-empty. DESIGN.md §5.4 builds `target`
choices from visible enemy ids plus `none`, which is a single option when
nobody is visible. Decision: omit the `target` question from the request
when no enemy is visible (target stays `none`, `face_target` means
`none`); the answer schema makes `target` optional. User doer
instructions that are blank fall back to the shipped default so
`instructions` is never empty. Cost if wrong: one extra branch in the
request builder.

## I-006 Local HTTP goes through a proxy — resolved

The shell exports `http_proxy=http://127.0.0.1:7890` with no `no_proxy`,
so plain `curl http://localhost:...` gets a 502 from the proxy. Use
`curl --noproxy '*'` (or `NO_PROXY=localhost,127.0.0.1`) for every local
smoke test. wrangler prints a harmless "Proxy environment variables
detected" warning.

## I-007 pnpm 11 and toolchain notes — resolved

pnpm 11 holds back packages published less than about a day ago and
silently writes `minimumReleaseAgeExclude` entries into
`pnpm-workspace.yaml`; versions one release older were pinned instead.
Dependency install scripts are blocked unless listed under `allowBuilds`
(esbuild and workerd are). TypeScript is `~6.0.3` because typescript-eslint
8.72 does not support 7.x. Vite 8, vitest 5, wrangler 4.151.2 (exact),
`compatibility_date = 2026-10-19` (newest the bundled workerd supports).
The `worker` package depends on `web` so `pnpm -r build` builds `web/dist`
before wrangler needs it.

## I-008 Progress notes cadence — resolved

`plan/README.md` asks for a note per finished milestone; `plan/progress/
README.md` says not to write one for routine work. Decision: a note is
written when a milestone deviated from its plan text, measured something,
or made a decision; routine milestones are recorded by their commits and
by this file. Cost if wrong: a few missing notes, recoverable from git.

## I-009 Strictness of third-party response schemas, Worker bundle size — resolved

v0.3 made every wire schema strict. `DecideRequest` stays strict (it is
the abuse boundary of the Worker). `DoerAnswer` and `Plan` validate
responses from Clef and from the thinker model, so a harmless extra key
would fault every call; v0.4 changes them to strip unknown keys instead.
Cost if wrong: an extra key silently dropped. Separately, a Worker that
imports the zod schemas bundles at about 110 KB minified (33 KB gzipped),
above the plan's 50 KB "budget snapshot" for v0.4; accepted, the budget
is advisory and the gzipped size is what ships.

## I-010 Worker accepts any content-type — open (v4.4)

A cross-site `text/plain` POST needs no CORS preflight, so CORS alone does
not stop another site from spending Nami's Workers AI budget through a
visitor's browser. Requiring `content-type: application/json` (415
otherwise) forces a preflight and is a one-line guard; v4.4 adds it with
the rate limit. Cost if wrong: none, it only rejects non-JSON callers.

## I-011 pnpm 11 passes `--` through to the script — resolved

`pnpm --filter web dev -- --port 5174` hands the literal `--` to Vite,
which then ignores the port and starts on 5173. Use
`pnpm --filter web dev --port 5174 --strictPort`. Also: functions declared
inside Playwright `page.evaluate` callbacks break under tsx (esbuild's
`__name` helper is missing in the page); pass a string script instead.

## I-012 Which thinker errors stop the match — resolved, implemented in v3.2 (Nami may override)

Row 29 stops the match on 401/403. v0.6 found two neighbours that leave
the match silently stuck on its first plan: 402 (no credit on the key) and
404 (the model is not available to the account). Decision: treat 402 and
404 like 401/403 (fatal, visible error) from v3.2 onward; everything else
keeps the last plan. Cost if wrong: a match stops that could have limped
on with a stale plan.

## I-013 Anthropic request shape is model-specific — half resolved (v3.2 done; v3.5 re-checks)

With `@anthropic-ai/sdk` 0.135.0 the provider sends
`output_config: { effort: "low", format: { type: "json_schema" } }` and
`thinking: { type: "disabled" }`. The agent reports that disabling
thinking is accepted by Haiku 5.5 but rejected (400) by Sonnet 5.5 and
Opus 5.5, which would turn every call into a `server` fault. v3.2 made the
thinking parameter model-specific (`thinkingParamFor`: Haiku 5.5 →
disabled, Sonnet 5.5 → `between_tools`, Opus 5.5 → omitted, which means
Opus always thinks inside the 600-token `max_tokens`); v3.5 must re-run
the fault tests and size `max_tokens` for the chosen model. The 600-token `max_tokens` is below
what `Plan` allows, so the harness prompt must ask for short output.
Spike bundle is 419 KB (102 KB gzipped), mostly the SDK.

## I-014 Event ticks are unbounded in the log schema — open (v1.5)

`MatchLogSchema` caps `config.durationTicks` at 60,000 but not event
ticks, so a crafted file with a tick of 1e8 makes the viewer's per-tick
index hang the tab. v1.5 adds a refinement: every event tick is an
integer within `0..config.durationTicks`, and the writer guarantees it
(cancelled runs end early, never late). Cost if wrong: a hostile file
still parses; the viewer could add its own guard.

## I-015 Workers AI binding errors carry no status or Retry-After — open (v0.5 live, v4.4)

In workerd 1.20261019.1 `env.AI.run` throws `InferenceUpstreamError` with
no status; the status is only recorded on the binding as the undocumented
`lastRequestHttpStatusCode`, shared within the isolate. The Worker reads
it to answer 429 vs 502, which can misattribute under concurrency, and no
`Retry-After` is available to forward. The browser client therefore backs
off on its own schedule (§5.5). Also: `wrangler deploy --env live` names
the Worker `kbattle-live`; v4.5 decides the production name. Cost if
wrong: a rare 429 reported as 502 (client keeps the last answer either
way).

## I-016 Near misses are not in the log — resolved (v1.5)

`incoming` in an observation includes bullets that passed within 2 m, but
no log event records them, so the mind panel could only rebuild hits.
Decision: v1.5 adds an optional `near` field to `Tick` events,
`[targetId, fromX, fromY][]`, present only when non-empty, so the viewer
rebuilds `lastTick.nearMisses`. DESIGN.md §5.3's event list is unchanged;
`Tick` gains a field. Cost if wrong: a few bytes per contested tick.

## I-017 Turn choices quantize to 90° per decision — open (tune at v3.4)

With `TURN_RATE_DPS = 180` and a decision every 10 ticks (0.5 s), a
`left`/`right` answer held for one decision turns exactly 90°, so without
`face_target` a facing only ever changes by multiples of 90°. Candidates:
lower `TURN_RATE_DPS` (120 → 60° per decision; 180° about-face in 1.5 s)
or keep it and rely on `face_target`. Decide while tuning the default
prompts in v3.4 by watching replays. Cost if wrong: coarse scanning.
