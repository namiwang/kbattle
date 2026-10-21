# Phase 3 — Brains

Covers DESIGN.md §8 P3. Goal of the phase: `brain/` and both provider
adapters, the two-model orchestrator (DESIGN.md §5.4), default prompts,
and measured cost + wall-clock for the default run (DESIGN.md §9).

Open-item posture:
- `[Q2]` thinker model `FLAG` is resolved at `v3.5`. Default
  assumption: Haiku 5.5 for cheap iteration, Sonnet 5.5 for the
  default demo (DESIGN.md §9).
- `[Q4]` Clef fallback: if `v0.5` fired row 34, `v3.1` ships the
  OpenAI Decisions adapter instead of the Worker-backed one, with
  per-key cost replacing the §9 Clef column.

## v3.1 - doer-client

### Goal

A browser-side `DecisionProvider` backed by the real Worker drives a
doer-only slot through a short browser match; 429 and timeout fault
rows are exercised with a fake provider.

### In Scope

- `brain/src/doer-client.ts`: `DecisionProvider.decide(state,
  questions) → DoerAnswer`, calling the Worker `/decide` route.
- Timeout, backoff on 429, invalid-JSON handling per DESIGN.md §5.5.
- A fake `DecisionProvider` for tests that triggers each fault row.
- Integration with the match loop from `v1.5` through its pluggable
  provider surface.
- A browser dev page that runs a doer-only match (DESIGN.md row 32:
  no key needed).

### Out Of Scope

- Thinker (`v3.2`), orchestration cadence beyond doer-only (`v3.3`).

### Exit Criteria

- [ ] A doer-only match in the browser against the real Worker
      completes and emits a schema-valid `MatchLog`.
- [ ] Each fault row from DESIGN.md §5.5 that applies to the doer is
      covered by a unit test with the fake provider.
- [ ] A planned chaos test ("drop every third response") does not
      stop the match; the log shows "keep last answer" per DESIGN.md
      principle 5.

### Files Touched

- `brain/src/doer-client.ts`, `brain/src/types.ts`,
  `brain/src/http.ts`.
- `brain/test/doer-client.test.ts`.
- `web/src/dev/doer-only.ts` (temporary dev entry).

### Tech Refs

- DESIGN.md §5.4 doer wire shape, §5.5 fault model, §5.6 adapter
  interface.

### Risks

- Milestone-specific: if `v0.5` fired row 34, this milestone ships an
  OpenAI Decisions adapter instead, and DESIGN.md §5.7 lapses.

### Test Plan

- Fake-provider unit tests on fault paths.
- Live browser smoke against `wrangler dev`.

### Budget Snapshot

- Per-call overhead on top of the Worker call under 10 ms.

### Demo

Open the dev page → doer-only 4-slot match runs → log downloads.

---

## v3.2 - thinker-client

### Goal

A `ThinkerProvider` wraps the Anthropic SDK call from the browser;
structured output, refusals and 401 behavior match DESIGN.md §5.5.

### In Scope

- `brain/src/thinker-client.ts`: hard-coded harness prompt (DESIGN.md
  §5.4) + user system prompt + perception/digest formatting.
- Structured output via the SDK's structured-output feature (per
  DESIGN.md §5.4 "use the provider's structured-output feature where it
  exists"), parsed through the `Plan` schema.
- Fault handling: 401 stops the match (DESIGN.md row 29); every other
  fault keeps the last plan.
- The thinker event records both `requestedTick` and the applied
  `tick`, per DESIGN.md §5.3.

### Out Of Scope

- Cadence (`v3.3`).
- Prompt-authoring UI (`v4.1`).

### Exit Criteria

- [ ] A single thinker call from the browser returns a valid `Plan`.
- [ ] 401 bubbles up to stop the match (verified against a bad key).
- [ ] A simulated refusal path keeps the last plan and logs a
      `Thinker` event with `ok: false`.
- [ ] Perception + event digest fit under 1,500 tokens on the default
      scene (DESIGN.md §5.4 budget).

### Files Touched

- `brain/src/thinker-client.ts`,
  `brain/src/thinker-prompt.ts`,
  `brain/src/event-digest.ts`.
- `brain/test/thinker-client.test.ts`.

### Tech Refs

- DESIGN.md §5.4 thinker contract, §5.5 fault rows, §5.6 adapter
  interface, row 29.

### Risks

- Milestone-specific: structured-output support differs by Anthropic
  model generation. Document which models are supported; fall back to
  JSON-schema-in-prompt only if required.

### Test Plan

- Unit tests with a fake HTTP server for each fault row.
- Manual browser smoke against the real API.

### Budget Snapshot

- ≤ 50 Haiku calls during development; ≤ $0.05 spend.

### Demo

Dev page → "spike thinker" button → shows a `Plan` after one call.

---

## v3.3 - orchestrator

### Goal

In Node with fake providers, a prompted agent escalates, the thinker
plan lands at a later tick, min/max gaps and one-in-flight debounce
behave per DESIGN.md §5.4.

### In Scope

- `brain/src/orchestrator.ts`: per-agent state machine wiring
  `DecisionProvider` and `ThinkerProvider` into the match loop from
  `v1.5`.
- Cadence rules from DESIGN.md §5.4: doer every `DOER_INTERVAL_TICKS`;
  thinker on escalate ≥ `ESCALATE_THRESHOLD` honored only after
  `THINKER_MIN_GAP_TICKS`; `THINKER_MAX_GAP_TICKS` forces a call.
- Async thinker: plan is applied at the first tick after it arrives
  (DESIGN.md row 31).
- Doer is lockstep: a tick waits for all due doer answers (or their
  timeout).
- Fault paths wired to log events (DESIGN.md §5.5).

### Out Of Scope

- Default prompts (`v3.4`).
- Prompt-authoring UI (`v4.*`).

### Exit Criteria

- [ ] Node test with scripted fake providers:
  - [ ] Escalation under min gap is debounced.
  - [ ] One in-flight thinker call per agent at a time.
  - [ ] Max gap forces a thinker call.
  - [ ] Thinker result applied at `requestedTick + delay` ticks.
- [ ] Doer timeout keeps the last answer (DESIGN.md principle 5).
- [ ] Determinism harness (`v1.6`) still passes with the orchestrator
      in the loop (replay with recorded answers).

### Files Touched

- `brain/src/orchestrator.ts`,
  `brain/src/providers/fake.ts`.
- `brain/test/orchestrator/{cadence,escalation,timeout}.test.ts`.

### Tech Refs

- DESIGN.md §5.4 rules, row 31 sim-clock, row 14 escalation, §5.5
  faults.

### Risks

- Milestone-specific: thinker async semantics interact with the sim
  tick floor. Keep the model explicit: thinker results do not hold a
  tick, ever.

### Test Plan

- Deterministic Node tests with fake providers.

### Budget Snapshot

- Fake-provider orchestrator test suite under 2 s wall.

### Demo

`pnpm --filter brain test` prints the cadence/escalation suite.

---

## v3.4 - default-prompts

### Goal

A default-prompts match (DESIGN.md row 23: 1 prompted, 7 bots) runs
headless and the prompted agent lands on screen as "doing something
sensible" by a human-review checklist.

### In Scope

- `brain/src/defaults/thinker-system.md` — the shipped thinker system
  prompt (DESIGN.md §5.4 last bullet).
- `brain/src/defaults/doer-instructions.ts` — one text per question
  (move, turn, fire, target); `escalate` instruction is fixed by
  kbattle (DESIGN.md §5.4).
- A reviewer checklist in `plan/progress/v3.4-review-checklist.md`:
  "agent moves toward enemies", "agent fires when target is in cone",
  "no spin-in-place loops".

### Out Of Scope

- Cost measurement (`v3.5`).
- UI (`v4.1`).

### Exit Criteria

- [ ] Default-prompts match runs end-to-end in the browser and emits
      a valid `MatchLog`.
- [ ] Reviewer checklist signed off by the designer (Nami).
- [ ] Default prompts fit under DESIGN.md §5.4 budgets.

### Files Touched

- `brain/src/defaults/*`.
- `plan/progress/v3.4-review-checklist.md` (progress artifact; not a
  plan artifact).

### Tech Refs

- DESIGN.md §5.4 last bullet, row 23 default slots.

### Risks

- See DESIGN.md §10 "Prompts that do not matter" and "Doer quality".

### Test Plan

- Manual review of a replay.

### Budget Snapshot

- Thinker prompt + harness under 1,500 tokens total input (DESIGN.md
  §5.4).

### Demo

Run a default match in the browser → open the replay → mind panel
shows the shipped plan text and sensible answers.

---

## v3.5 - cost-wallclock-measurement

### Goal

A default public-shape run (Haiku + Sonnet) reports doer calls,
thinker calls, token counts, wall-clock and estimated cost; numbers
written back into DESIGN.md §9. Thinker model `[Q2]` resolved.

### In Scope

- A measurement harness that aggregates call counts, token counts
  and wall-clock from a run's `MatchLog`.
- Two full default-shape runs: one with Haiku, one with Sonnet.
- Update DESIGN.md §9 cells with measured values. (Allowed deviation
  from "do not edit DESIGN.md": DESIGN.md §8 P3 exit explicitly says
  "cost and wall-clock per default match recorded in §9".)
- Resolve `[Q2]`: pick thinker model for the public demo and write it
  into DESIGN.md row 18 (which currently carries the `FLAG`).

### Out Of Scope

- UI for cost (`v4.*` optional).

### Exit Criteria

- [ ] Haiku and Sonnet runs each produce a measurement report.
- [ ] DESIGN.md §9 defaults replaced with measured values.
- [ ] DESIGN.md row 18 `FLAG` removed; the chosen thinker model is
      written as a constant in `core/src/constants.ts`.
- [ ] Default wall-clock meets DESIGN.md anti-goal (under 15 min).

### Files Touched

- `brain/src/measure.ts`.
- DESIGN.md §9 (planned edit); DESIGN.md row 18 (planned edit).
- `plan/progress/v3.5-measurement.md`.

### Tech Refs

- DESIGN.md §9 (cost and time), row 18 model constants.

### Risks

- See DESIGN.md §10 "Rate limit" and "Wall-clock".

### Test Plan

- Live runs captured as JSON logs; the report script is a one-shot.

### Budget Snapshot

- Measurement budget: ≤ $1 of Anthropic spend across both runs; Clef
  spend inside DESIGN.md §9 defaults.

### Demo

`pnpm --filter brain exec tsx scripts/measure.ts match.json` prints
"doer: X, thinker: Y, wall: Zs, est. cost: $A" that matches the
updated DESIGN.md §9 cell.

---

## v3.6 - anti-goal-check

### Goal

Two different thinker prompts produce visibly different play on the
same seed; a prompted agent wins at least some matches against bots.
Clears DESIGN.md §1 anti-goals.

### In Scope

- A pair of hand-authored prompt profiles: "aggressive" and
  "defensive".
- Three seeds × two prompts = six matches, all logged.
- A human review log in `plan/progress/v3.6-anti-goal.md`:
  per-seed description of what differs and the win record vs bots.

### Out Of Scope

- Automated metrics for prompt-sensitivity (post-PoC).

### Exit Criteria

- [ ] Two prompts produce different `Doer`/`Thinker` streams on the
      same seed (byte-diff of logs is non-empty and the differences
      are visible in replay).
- [ ] Prompted agent wins at least one of the six matches outright
      (ranking 1; DESIGN.md row 20).
- [ ] Anti-goal 1 ("prompts do not matter") and anti-goal 2
      ("prompted agents lose to the scripted bots in every match") are
      marked cleared in the progress note.

### Files Touched

- `brain/src/defaults/prompts-aggressive.md`,
  `brain/src/defaults/prompts-defensive.md`.
- `plan/progress/v3.6-anti-goal.md`.

### Tech Refs

- DESIGN.md §1 anti-goals, §10 "Prompts that do not matter".

### Risks

- Milestone-specific: this is the first point where the whole PoC
  can fail. DESIGN.md §10 names the mitigation (richer `plan` field,
  more frequent thinker calls).

### Test Plan

- Manual review across six replays side by side (DESIGN.md §7
  sandbox-loop pattern).

### Budget Snapshot

- Six default-shape matches: ≤ $5 at Sonnet 5.5 (DESIGN.md §9).

### Demo

Two browser tabs side by side, same seed, different prompts, visibly
different play; the designer signs off in `v3.6-anti-goal.md`.
