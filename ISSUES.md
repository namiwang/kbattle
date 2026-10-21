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
