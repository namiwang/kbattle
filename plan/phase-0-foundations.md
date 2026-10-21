# Phase 0 — Foundations

Covers DESIGN.md §8 P0. Goal of the phase: lay down the workspace,
nail the five boundary schemas (DESIGN.md §5.3), stand up the Worker
skeleton (DESIGN.md §5.1, §5.7), and run two external spikes
(Clef-flash and the thinker provider) so P1–P4 proceed knowing the
network reality.

Open-item posture for this phase:
- `[Q4]` Clef fallback (DESIGN.md row 34) is resolved by `v0.5`. Default
  assumption: continue with `@cf/cloudflare/clef-flash`.
- `[Q2]` thinker model `FLAG`: `v0.6` uses Haiku 5.5 as the cheapest
  Claude for the spike. The production choice is deferred to `v3.5`.
- All milestone validation commands are planned; the toolchain itself
  only exists after `v0.1`.

## v0.1 - monorepo-scaffold

### Goal

`pnpm install && pnpm -r build` succeeds against the empty four-package
workspace with the Worker stub serving an `index.html`.

### In Scope

- Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  shared `tsconfig` references.
- Four packages: `core/`, `brain/`, `web/`, `worker/` (DESIGN.md §5.1).
- `web/` wired to Vite with a one-line "hello kbattle" page.
- `worker/` wired to `wrangler` with a static-assets binding pointing
  at `web/dist` and a `/decide` route stub that returns `501`.
- `pnpm` scripts: `build`, `test`, `dev`, `lint`, `typecheck`.
- `.gitignore`, `.editorconfig`, `README.md` top-level pointer to
  `DESIGN.md` and this plan folder.

### Out Of Scope

- Any game, schema or Worker logic (lands in `v0.2`+).
- CI config (post-PoC).

### Exit Criteria

- [ ] `pnpm install` (planned) completes without errors.
- [ ] `pnpm -r build` (planned) succeeds for all four packages.
- [ ] `pnpm --filter web dev` (planned) serves the hello page.
- [ ] `pnpm --filter worker dev` (planned, `wrangler dev`) serves the
      static assets and returns 501 on `POST /decide`.
- [ ] `pnpm -r test` (planned) runs zero tests cleanly.

### Files Touched

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`.
- `core/package.json`, `core/tsconfig.json`, `core/src/index.ts`.
- `brain/package.json`, `brain/tsconfig.json`, `brain/src/index.ts`.
- `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`,
  `web/index.html`, `web/src/main.ts`.
- `worker/package.json`, `worker/wrangler.toml`, `worker/src/index.ts`.
- `.gitignore`, `.editorconfig`, `README.md`.

### Tech Refs

- DESIGN.md §5.1 Packages, §5.2 Runtime (local dev).

### Risks

- Local pnpm/wrangler versions drift from what Cloudflare serves. Pin
  via `packageManager` in root `package.json` and record `wrangler`
  version in `worker/package.json`.

### Test Plan

- Smoke: `pnpm -r build`, `pnpm --filter worker dev` manual curl of
  `/decide` returns 501.

### Budget Snapshot

- Cold `pnpm install` under 60 s on a developer laptop.
- Worker bundle after this milestone under 20 KB (static only).

### Demo

Open `http://localhost:5173` → "hello kbattle". `curl -X POST
http://localhost:8787/decide` → 501.

---

## v0.2 - core-types-conventions

### Goal

`pnpm --filter core test` passes unit tests for `Vec2`, angle
normalization and the shared constants file (DESIGN.md §5.6).

### In Scope

- `core/src/types.ts`: internal interfaces `MapSpec`, `WorldState`,
  `Agent`, `Bullet`, `Obstacle`, `Observation`, `Action`, `Event`,
  `MatchConfig`, `Slot` (DESIGN.md §5.3).
- `core/src/vec2.ts`: `Vec2`, `add`, `sub`, `len`, `norm`, `rot`,
  m-y-down convention (DESIGN.md §6.1).
- `core/src/angles.ts`: degree helpers, normalize to (−180, 180],
  bearing relative to facing.
- `core/src/constants.ts`: every tunable from DESIGN.md §5.6.
- Unit tests on vec and angle helpers.

### Out Of Scope

- Simulation logic (`v1.*`).
- Zod schemas (`v0.3`).

### Exit Criteria

- [ ] `pnpm --filter core typecheck` (planned) clean.
- [ ] `pnpm --filter core test` (planned) ≥ 10 cases pass covering
      angle wraparound, bearing sign (positive = right), and vector
      rotation under DESIGN.md §6.1 conventions.
- [ ] All constants named in DESIGN.md §5.6 export from `constants.ts`
      with the default values from DESIGN.md §5.4 and §6.2.

### Files Touched

- `core/src/types.ts`, `core/src/vec2.ts`, `core/src/angles.ts`,
  `core/src/constants.ts`, `core/src/index.ts`.
- `core/test/vec2.test.ts`, `core/test/angles.test.ts`,
  `core/test/constants.test.ts`.

### Tech Refs

- DESIGN.md §5.3, §5.6, §6.1.

### Risks

- Angle sign convention (clockwise-positive, 0° = +x) is easy to flip
  under y-down. The test for "+90° from +x points to +y" is the guard.

### Test Plan

- Unit tests only. No network, no sim.

### Budget Snapshot

- `core/` with no deps except `vitest` (or chosen test runner).

### Demo

`pnpm --filter core test -w=false` prints the test tree.

---

## v0.3 - boundary-schemas-sample-log

### Goal

A hand-authored `fixtures/sample-log.json` validates against the
`MatchLog` zod schema; the four other boundary schemas round-trip.
Satisfies DESIGN.md §8 P0 "sample log validates".

### In Scope

- `core/src/schemas.ts` with zod schemas for the five boundaries from
  DESIGN.md §5.3: `DoerAnswer`, `Plan`, `DecideRequest`, `MatchLog`,
  `MatchConfig`. Types derived via `z.infer`.
- Discriminated-union `Event` schema matching DESIGN.md §5.3.
- `core/fixtures/sample-log.json`: a hand-written 2-agent, ~200-tick
  log, enough to exercise every `Event` kind.
- Round-trip tests: schema → parse → schema.

### Out Of Scope

- Any producer of real logs (`v1.5`).
- Worker handling of `DecideRequest` beyond schema import (`v0.4`).

### Exit Criteria

- [ ] `pnpm --filter core test` (planned) parses the sample log
      successfully.
- [ ] Each of the five boundary schemas has at least one positive and
      one negative test.
- [ ] Every `Event` kind named in DESIGN.md §5.3 appears in the sample
      log at least once.
- [ ] `z.infer` types used in at least one dependent import in `core/`
      to prove type inference works.

### Files Touched

- `core/src/schemas.ts`, `core/src/index.ts` (re-exports).
- `core/fixtures/sample-log.json`.
- `core/test/schemas.test.ts`.

### Tech Refs

- DESIGN.md §5.3 (table and `MatchLog`/`Event` shape).

### Risks

- `Doer` and `Thinker` events include free-form objects. Keep the
  schemas permissive on input and strict on output; the strict shape
  comes from `v3.1`/`v3.2` where the adapters land.

### Test Plan

- Vitest suite over fixture files; negative fixtures live under
  `core/fixtures/bad/`.

### Budget Snapshot

- Sample log under 50 KB; the real-match 3–5 MB budget from DESIGN.md
  §5.3 is the P1 target.

### Demo

Node REPL: `require('core').schemas.MatchLog.parse(require('./core/fixtures/sample-log.json'))`
returns the parsed object.

---

## v0.4 - worker-skeleton

### Goal

`wrangler dev` serves the static stub and `POST /decide` validates a
`DecideRequest` and returns a mocked `DoerAnswer`.

### In Scope

- `worker/src/index.ts`: router (manual or `hono`-equivalent), one
  `POST /decide` route.
- Import `DecideRequest`/`DoerAnswer` schemas from `core/`.
- Mocked doer: returns a deterministic `DoerAnswer` per question
  shape (all defaults, `escalate: 0.0`).
- `wrangler.toml` bindings stub for `AI` (not yet called).
- CORS allowance for the Vite dev origin.
- Request-logging middleware.

### Out Of Scope

- Calling Workers AI (that is `v0.5`).
- Rate limiting and spend cap (`v4.4`).

### Exit Criteria

- [ ] `pnpm --filter worker dev` (planned) accepts a `curl` POST of a
      valid `DecideRequest` and returns a schema-valid `DoerAnswer`.
- [ ] Invalid body returns 400 with the zod error.
- [ ] Unit tests on the router with miniflare-equivalent harness.

### Files Touched

- `worker/src/index.ts`, `worker/src/routes/decide.ts`,
  `worker/wrangler.toml`.
- `worker/test/decide.test.ts`.

### Tech Refs

- DESIGN.md §5.1 (worker role), §5.3 (schemas), §5.4 (DoerAnswer shape),
  §5.7 (guard — placeholder here).

### Risks

- The mocked `DoerAnswer` must match what `v0.5` returns; keep the
  shape driven by the schema, not hardcoded strings.

### Test Plan

- Worker unit tests with the Cloudflare test runner. Manual `curl`
  smoke.

### Budget Snapshot

- Worker bundle under 50 KB.

### Demo

`curl -X POST http://localhost:8787/decide -d @core/fixtures/decide-request.json`
→ 200 with a mocked answer.

---

## v0.5 - clef-flash-spike

### Goal

Through the real Worker, a scripted `DecideRequest` reaches
`@cf/cloudflare/clef-flash`, returns a schema-valid `DoerAnswer`,
and the measured latency and rate limit are written into DESIGN.md §9.
Resolves `[Q4]` / DESIGN.md row 34.

### In Scope

- `worker/src/decision/clef.ts`: call the Workers AI binding with the
  exact wire shape in DESIGN.md §5.4.
- `worker/src/routes/decide.ts`: swap the mock for the real call.
- A one-off `worker/scripts/measure.ts` runner that hits `/decide` N
  times and reports latency and 429 behavior.
- Record the measured p50 / p95 latency and observed rate limit in
  DESIGN.md §9 and in this milestone's progress note.
- Row 34 decision captured in `plan/progress/v0.5-clef-flash-spike.md`.

### Out Of Scope

- Browser-side orchestration (`v3.1`).
- Rate-limit rule (`v4.4`).

### Exit Criteria

- [ ] A single `DecideRequest` from `core/fixtures/decide-request.json`
      returns a schema-valid `DoerAnswer` (via `wrangler dev` or a
      preview deploy).
- [ ] The wire shape in DESIGN.md §5.4 is confirmed or corrected in a
      follow-up edit to §5.4 (allowed deviation from the "no edits to
      DESIGN.md" rule because DESIGN.md §8 P0 exit says so).
- [ ] p50 and p95 latency across ≥ 50 calls recorded.
- [ ] Observed rate-limit behavior (429 vs quota) recorded.
- [ ] Explicit row-34 call: either "continue with Clef" or "fire row
      34 fallback", written into the progress note.

### Files Touched

- `worker/src/decision/clef.ts`, `worker/src/routes/decide.ts`.
- `worker/scripts/measure.ts`.
- DESIGN.md §9 (planned small edit to numbers), §2 row 34 outcome.

### Tech Refs

- DESIGN.md §5.4 (wire shape), §5.5 (fault model), §9 (cost table), row
  18 (model constants), row 34.
- Workers AI docs for `@cf/cloudflare/clef-flash` (fetch in the
  spike).

### Risks

- Milestone-specific: the Workers AI binding may not expose Clef on
  the account, or the wire shape may differ. The row-34 branch is the
  mitigation.
- See DESIGN.md §10 "Clef unavailable or wrong shape" and "Doer
  quality".

### Test Plan

- Live call through `wrangler dev` with a scripted request.
- Timing captured in `measure.ts` output.

### Budget Snapshot

- Spike budget: ≤ 500 calls total during measurement; ≤ $0.05 at the
  v2 cost estimate (DESIGN.md §9).

### Demo

`pnpm --filter worker exec tsx scripts/measure.ts` prints a latency
histogram and an answer sample.

### Parallelism

- Independent of P1. P1 can start as soon as `v0.3` lands.

---

## v0.6 - thinker-adapter-spike

### Goal

From a browser page with a pasted key, the Anthropic SDK (with
`dangerouslyAllowBrowser: true`, DESIGN.md §5.6) returns a `Plan`
validated by the zod schema, using structured output.

### In Scope

- `brain/src/providers/anthropic.ts`: `ThinkerProvider.complete`
  implementation; low effort, small `max_tokens`.
- `brain/src/schemas.ts` re-exporting `Plan` from `core/`.
- A disposable "spike page" in `web/` with a key field and a
  "run spike" button, outputting the returned `Plan`.
- A fault-handling pass through the §5.5 table rows that the browser
  can actually see: 401/403, 429, invalid JSON, refusal.

### Out Of Scope

- Prompt-authoring UI (`v4.1`).
- Orchestration cadence (`v3.3`).

### Exit Criteria

- [ ] From the spike page in `web/`, a pasted key + a sample
      perception payload returns a `Plan` that passes `Plan.parse`.
- [ ] 401 behavior stops the spike with a visible error (DESIGN.md row
      29).
- [ ] A deliberate "invalid JSON" response path keeps the last plan
      and logs the fault (DESIGN.md §5.5).
- [ ] Haiku 5.5 cost per call recorded, used as the first data point
      for §9 at `v3.5`.

### Files Touched

- `brain/src/providers/anthropic.ts`, `brain/src/types.ts`.
- `web/src/spike-thinker.ts`, `web/src/spike-thinker.html`.

### Tech Refs

- DESIGN.md §5.4 thinker contract, §5.5 fault model, §5.6 adapter
  interface, §9 Anthropic prices.

### Risks

- Milestone-specific: Anthropic structured output in-browser may need
  a specific SDK version; pin it and record the version.
- `[Q2]` thinker-model `FLAG`: Haiku 5.5 is assumed for the spike;
  the production choice is deferred to `v3.5`.

### Test Plan

- Manual browser smoke with a real key.
- Unit tests with a fake HTTP server simulating 401, 429, refusal, and
  invalid JSON.

### Budget Snapshot

- ≤ 50 Haiku calls in the spike; ≤ $0.01 of thinker spend.

### Demo

Open the spike page, paste key, click "run spike" → textarea shows a
parsed `Plan`.

### Parallelism

- Independent of `v0.5` and of P1.
