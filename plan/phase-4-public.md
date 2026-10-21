# Phase 4 — Public

Covers DESIGN.md §8 P4. Goal of the phase: everything a stranger needs
to use kbattle — key field, prompt editors, match config, run screen,
replay integration, Worker guard (DESIGN.md §5.7), and a deployed
public URL.

Open-item posture:
- `[Q3]` Worker guard — `v4.4` ships the row 28 answer: Cloudflare
  rate-limiting rule per IP + Workers AI daily spend cap.
- `[Q4]` Clef fallback — if `v0.5` fired row 34, `v4.4` becomes a
  static-hosting milestone (no `/decide` to guard) and DESIGN.md §5.7
  lapses.

## v4.1 - ui-shell

### Goal

One page: a key field (localStorage), prompt editors with default
values from `v3.4`, a match config form backed by `MatchConfig`
(DESIGN.md §5.3). Refresh preserves state.

### In Scope

- `web/src/ui/key.ts`: paste, store in localStorage, show
  "sent only to the provider" (DESIGN.md §7, §10 Keys).
- `web/src/ui/mind.ts`: textarea for the thinker system prompt, five
  short length-capped fields for doer instructions (DESIGN.md §7, row
  13).
- `web/src/ui/match.ts`: map, seed, slot count, prompted vs
  doer-only vs bot (DESIGN.md row 23 defaults), duration.
- No-key mode: prompted slots disabled, doer-only slots offered
  (DESIGN.md §7 bullet 3).
- Zod validation on form submit against `MatchConfig`.

### Out Of Scope

- Running a match (`v4.2`).
- Replay (`v4.3`).

### Exit Criteria

- [ ] Reload preserves key, prompts and config.
- [ ] "Clear key" button removes it from localStorage.
- [ ] Without a key, prompted-slot inputs are disabled.
- [ ] A valid default config submits; an invalid one shows readable
      zod errors.

### Files Touched

- `web/src/ui/{key,mind,match,form}.ts`,
  `web/src/ui/storage.ts`.
- `web/test/ui/*.test.ts`.

### Tech Refs

- DESIGN.md §7, row 13, row 23.

### Risks

- Milestone-specific: localStorage keys and version migration. Prefix
  all keys with `kbattle:` and version them.

### Test Plan

- Jsdom unit tests on the form state.
- Manual smoke on refresh behavior.

### Budget Snapshot

- First paint under 500 ms on a cold cache.

### Demo

Open page → paste key, write prompt, pick 8 slots (1 prompted) →
refresh → still there.

---

## v4.2 - run-screen

### Goal

From the page, running a match streams tick count, call counts and
faults; cancel aborts cleanly.

### In Scope

- `web/src/run/runner.ts`: glue between the form, the orchestrator
  (`v3.3`), and the status surface.
- Live counters: tick N/M, doer calls, thinker calls, faults by kind
  (DESIGN.md §5.5).
- Cancel button: aborts the match, finalizes a partial `MatchLog`
  (ends with a synthetic `MatchEnd` of `ranking: []`).
- Error surface: 401 from the thinker stops the match with a visible
  error (DESIGN.md row 29).

### Out Of Scope

- Replay surface after the run (`v4.3`).

### Exit Criteria

- [ ] A default run from the page completes and the status surface
      shows final counts matching the log.
- [ ] Cancel mid-match stops within one tick and leaves a parseable
      log.
- [ ] A deliberately-bad key stops the match and shows the error.

### Files Touched

- `web/src/run/{runner,status,errors}.ts`.
- `web/test/run/*.test.ts`.

### Tech Refs

- DESIGN.md §7 Run, §5.5, row 29.

### Risks

- Milestone-specific: tab-close kills the match (DESIGN.md §10 Tab
  lifetime). Accepted; the status surface warns on beforeunload during
  a run.

### Test Plan

- Manual browser smoke.

### Budget Snapshot

- UI updates no more than every 100 ms during a run.

### Demo

Enter prompts → click Run → counters tick → match ends → counts shown.

---

## v4.3 - replay-integration-files

### Goal

After a match the replay opens with its `MatchLog` and prompts;
download and upload work from the same page.

### In Scope

- Wire the finished `MatchLog` from `v4.2` directly into the replay
  viewer from P2.
- Download button saves the match (log already includes `prompts`,
  DESIGN.md §5.3).
- Upload re-opens the viewer with the uploaded log (reuses `v2.5`).
- "Edit prompts" button copies the log's prompts back into the mind
  editors for a next run.

### Out Of Scope

- Hosting replays (post-PoC).

### Exit Criteria

- [ ] After a run, the replay viewer opens inside the same page.
- [ ] Download produces a file that opens the same replay elsewhere.
- [ ] Upload accepts a prior kbattle log and plays it.
- [ ] "Edit prompts" seeds the editors with the log's prompts.

### Files Touched

- `web/src/page.ts` (page composition).
- `web/src/run/handoff.ts`.

### Tech Refs

- DESIGN.md §5.3 (`prompts` field), §7 Files, §11 iteration loop.

### Risks

- Milestone-specific: large logs block the main thread. Chunk the
  download/upload parse with `requestIdleCallback`.

### Test Plan

- Manual smoke: run → watch → download → upload → watch again.

### Budget Snapshot

- Run-to-replay transition under 500 ms on a 5 MB log.

### Demo

Run default match → viewer opens → download → upload → replay again.

---

## v4.4 - worker-guard

### Goal

A Cloudflare rate-limiting rule throttles `/decide` per IP; the
Workers AI daily spend cap is configured and verified in the
dashboard (DESIGN.md row 28, §5.7).

### In Scope

- Rate-limit rule: size for one default match at a time per IP (DESIGN.md
  §5.7). Expressed in `wrangler.toml` (or dashboard config documented
  in `worker/README.md`).
- Workers AI daily spend cap configured on the account.
- A verification script `worker/scripts/throttle-test.ts` that fires
  calls faster than the limit and asserts 429s.

### Out Of Scope

- Per-match token (noted as the next-step in DESIGN.md §5.7; post-PoC).
- Any form of accounts.

### Exit Criteria

- [ ] The rate-limit rule returns 429 above the configured per-IP
      cadence (verified by the throttle script).
- [ ] The daily spend cap is set and documented in `worker/README.md`.
- [ ] An abuse scenario (two tabs from the same IP) is captured in a
      brief postmortem-shape note under `plan/progress/`.

### Files Touched

- `worker/wrangler.toml`, `worker/README.md`,
  `worker/scripts/throttle-test.ts`.

### Tech Refs

- DESIGN.md row 28, §5.7 Worker guard, §10 Abuse.

### Risks

- Milestone-specific: Cloudflare rate-limiting rules are account-level
  config; the plan assumes Nami's account has the right plan. If not,
  implement a Durable-Object counter inside the Worker instead.
- If `v0.5` fired row 34, this milestone becomes "static hosting only"
  and the guard lapses.

### Test Plan

- Script fires N calls, expects 429 after the limit.

### Budget Snapshot

- Verification script spend: ≤ $0.05 on Clef.

### Demo

`pnpm --filter worker exec tsx scripts/throttle-test.ts` prints
"first 429 at call M of N".

---

## v4.5 - deploy-stranger-run

### Goal

A public URL is up; a stranger with an API key completes
"write prompts → run → watch → tweak → run again" without reading
code. Matches DESIGN.md §8 P4 exit and DESIGN.md §1 goal 1.

### In Scope

- `wrangler deploy` of the Worker with the static-assets binding.
- Public URL recorded in the repo README.
- A "stranger test" with a human who did not build kbattle: they
  complete the loop end to end and leave a one-page note in
  `plan/progress/v4.5-stranger.md`.
- Any blocking usability fixes required to make that work.

### Out Of Scope

- Public announcements, analytics, accounts (post-PoC).

### Exit Criteria

- [ ] `pnpm --filter worker deploy` (planned) produces a working
      public URL.
- [ ] A stranger with no priors runs the default and a custom match
      and watches both replays without asking for help.
- [ ] DESIGN.md §1 Goals 1–4 are mapped to evidence in
      `plan/progress/v4.5-stranger.md`.
- [ ] Row 28/§5.7 guard still works against the public URL
      (re-run the `v4.4` throttle script).

### Files Touched

- `worker/wrangler.toml` (production), `README.md` (link).
- `plan/progress/v4.5-stranger.md`.

### Tech Refs

- DESIGN.md §1 Goals, §8 P4, §5.7, §10 Abuse.

### Risks

- Milestone-specific: Workers AI's paid plan is required for a public
  URL (DESIGN.md §9 last paragraph). Confirmed with Nami.
- See DESIGN.md §10 for the rest.

### Test Plan

- Stranger test. Throttle verification against the live URL.

### Budget Snapshot

- First week of public: ≤ $20 of Workers AI spend (daily cap bounds
  it).

### Demo

A URL. A stranger. A finished replay watched to completion. The link
goes into the repo README.
