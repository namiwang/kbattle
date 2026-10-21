# kbattle — Roadmap

One table of every milestone, in dependency order. Phases follow
DESIGN.md §8 (P0–P4). Each row links to its milestone entry.

| id | Phase | Slug | Goal (demo) | Depends on | Can run in parallel with |
|----|-------|------|-------------|------------|--------------------------|
| v0.1 | P0 Foundations | [monorepo-scaffold](phase-0-foundations.md#v01---monorepo-scaffold) | `pnpm install && pnpm -r build` succeeds against the empty four-package workspace with the Worker stub serving `index.html`. | — | — |
| v0.2 | P0 | [core-types-conventions](phase-0-foundations.md#v02---core-types-conventions) | `pnpm --filter core test` passes unit tests for `Vec2`, angle normalization and the shared constants file. | v0.1 | — |
| v0.3 | P0 | [boundary-schemas-sample-log](phase-0-foundations.md#v03---boundary-schemas-sample-log) | A hand-authored `fixtures/sample-log.json` validates against the `MatchLog` zod schema; the four other boundary schemas round-trip. | v0.2 | v0.4 (independent) |
| v0.4 | P0 | [worker-skeleton](phase-0-foundations.md#v04---worker-skeleton) | `wrangler dev` serves the static stub and `POST /decide` validates a `DecideRequest` and returns a mocked `DoerAnswer`. | v0.1, v0.3 | v0.5 preparation |
| v0.5 | P0 | [clef-flash-spike](phase-0-foundations.md#v05---clef-flash-spike) | Through the real Worker, a scripted `DecideRequest` reaches `@cf/cloudflare/clef-flash`, returns a valid `DoerAnswer`; latency and rate limit measured and written back into DESIGN.md §9; row 34 answered. | v0.4 | v0.6, P1 |
| v0.6 | P0 | [thinker-adapter-spike](phase-0-foundations.md#v06---thinker-adapter-spike) | From a browser page with a pasted key, Anthropic SDK returns a `Plan` validated by the zod schema with structured output. | v0.3 | v0.5, P1 |
| v1.1 | P1 Sim | [sim-skeleton-rng](phase-1-sim.md#v11---sim-skeleton-rng) | A Node test spawns an agent, fires one bullet, and the tick trace matches a golden file; same seed, same trace. | v0.2 | v0.5, v0.6 |
| v1.2 | P1 | [move-rotate-fire](phase-1-sim.md#v12---move-rotate-fire) | A Node test runs a scripted `Action` stream for 50 ticks on an empty map; movement, rotation, firing, bullet-obstacle collisions resolve against goldens. | v1.1 | v0.5, v0.6 |
| v1.3 | P1 | [perception](phase-1-sim.md#v13---perception) | `core.perceive(state, agent)` matches golden `Observation`s on five hand-built scenes covering cone, LOS, hearing bands and incoming fire. | v1.2 | v0.5, v0.6, P2 start |
| v1.4 | P1 | [bots-and-maps](phase-1-sim.md#v14---bots-and-maps) | Two hand-authored maps load; `wanderer` vs `camper` headless match in Node runs to a `MatchEnd` event with both bots deciding on `DOER_INTERVAL_TICKS`. | v1.3 | P2 |
| v1.5 | P1 | [match-loop-log](phase-1-sim.md#v15---match-loop-log) | A 16-bot match in Node finishes faster than real time and emits a `MatchLog` that validates against the schema. | v1.4 | P2 |
| v1.6 | P1 | [determinism-harness](phase-1-sim.md#v16---determinism-harness) | Given the same seed and recorded doer answers, replaying produces a byte-identical `MatchLog`. | v1.5 | P2 |
| v2.1 | P2 Replay | [pixi-scene-bootstrap](phase-2-replay.md#v21---pixi-scene-bootstrap) | `pnpm --filter web dev` loads a sample `MatchLog`, renders obstacles and agents at tick 0. | v0.3, v1.5 (for sample log; a stub log from v0.3 is enough to start) | P1 |
| v2.2 | P2 | [playback-controls](phase-2-replay.md#v22---playback-controls) | Play, pause, scrub and speed buttons advance the renderer through every `Tick` event of a sample log. | v2.1 | P1 |
| v2.3 | P2 | [bullets-follow-overlays](phase-2-replay.md#v23---bullets-follow-overlays) | Bullet trails, follow-camera and vision-cone overlay all toggle on and off during playback. | v2.2 | P1 |
| v2.4 | P2 | [mind-panel](phase-2-replay.md#v24---mind-panel) | For a selected agent at the scrubbed tick, the panel shows recomputed perception, current plan text, last doer answers with probabilities, and timeline markers for `Thinker` and faulted calls. | v2.3, v1.3 (`core.perceive` reused) | — |
| v2.5 | P2 | [file-upload-download](phase-2-replay.md#v25---file-upload-download) | Upload a `MatchLog` from disk, watch it; download the current log as JSON. | v2.4 | — |
| v3.1 | P3 Brains | [doer-client](phase-3-brains.md#v31---doer-client) | A `DecisionProvider` backed by the real Worker drives a doer-only slot through a short browser match; 429 and timeout fault rows are exercised with a fake provider. | v0.5, v1.5 | v3.2 |
| v3.2 | P3 | [thinker-client](phase-3-brains.md#v32---thinker-client) | A `ThinkerProvider` wraps the Anthropic SDK call from the browser; structured output, refusals and 401 behavior match DESIGN.md §5.5. | v0.6, v1.5 | v3.1 |
| v3.3 | P3 | [orchestrator](phase-3-brains.md#v33---orchestrator) | In Node with fake providers, a prompted agent escalates, the thinker plan lands at a later tick, min/max gaps and one-in-flight debounce behave per DESIGN.md §5.4. | v3.1, v3.2 | — |
| v3.4 | P3 | [default-prompts](phase-3-brains.md#v34---default-prompts) | A default-prompts match (row 23: 1 prompted, 7 bots) runs headless and the prompted agent lands on screen as "doing something sensible" by a human-review checklist. | v3.3 | — |
| v3.5 | P3 | [cost-wallclock-measurement](phase-3-brains.md#v35---cost-wallclock-measurement) | A default public-shape run (Haiku + Sonnet) reports doer calls, thinker calls, token counts, wall-clock, and estimated cost; numbers written back into DESIGN.md §9. Thinker model `[Q2]` resolved. | v3.4 | — |
| v3.6 | P3 | [anti-goal-check](phase-3-brains.md#v36---anti-goal-check) | Two different thinker prompts produce visibly different play on the same seed (manual review across two replays); a prompted agent wins at least some matches against bots. DESIGN.md §1 anti-goals cleared. | v3.5 | — |
| v4.1 | P4 Public | [ui-shell](phase-4-public.md#v41---ui-shell) | One page: key field (localStorage), prompt editors with default values, slot config form; refresh preserves state. | v3.4 | — |
| v4.2 | P4 | [run-screen](phase-4-public.md#v42---run-screen) | From the page, running a match streams tick count, call counts and faults; cancel aborts cleanly. | v4.1, v3.3 | — |
| v4.3 | P4 | [replay-integration-files](phase-4-public.md#v43---replay-integration-files) | After a match the replay opens with its `MatchLog` and prompts; download and upload work from the same page. | v4.2, v2.5 | — |
| v4.4 | P4 | [worker-guard](phase-4-public.md#v44---worker-guard) | A Cloudflare rate-limiting rule throttles `/decide` per IP; the Workers AI daily spend cap is configured and verified in dashboard. Skipped if row 34 fired at v0.5. | v4.3 | — |
| v4.5 | P4 | [deploy-stranger-run](phase-4-public.md#v45---deploy-stranger-run) | A public URL is up; a stranger with an API key completes "write prompts → run → watch → tweak → run again" without reading code. | v4.4 | — |

## Parallel tracks

- `v0.5` Clef spike and `v0.6` thinker spike are independent of each
  other and of P1; both only need `v0.3`'s schemas.
- All of P1 (`v1.1`–`v1.6`) can run alongside the P0 spikes.
- P2 (`v2.1`–`v2.4`) only needs the sample log from `v0.3`; it can run
  alongside P1 and the P0 spikes. The real `MatchLog` from `v1.5`
  replaces the sample inside P2 later.
- P3 is the first phase that fans everything back together.

## Dependencies summary diagram

```
v0.1 → v0.2 → v0.3 → v0.4 → v0.5 ─┐
                 │               │
                 ├─────→ v0.6 ───┼──→ v3.1, v3.2 → v3.3 → v3.4 → v3.5 → v3.6
                 │               │
                 └─ v1.1 → v1.2 → v1.3 → v1.4 → v1.5 → v1.6
                                                 │
                                                 └─────────────→ v3.*
v0.3 → v2.1 → v2.2 → v2.3 → v2.4 → v2.5

v3.4 → v4.1 → v4.2 → v4.3 → v4.4 → v4.5
```
