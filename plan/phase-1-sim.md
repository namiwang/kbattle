# Phase 1 — Sim

Covers DESIGN.md §8 P1. Goal of the phase: a deterministic, headless,
pure-TypeScript simulator with perception, scripted bots, two maps,
a match loop, and determinism tests. No model calls, no renderer.

The exit for the whole phase is DESIGN.md §8 P1: "a 16-bot match runs
faster than real time in Node; same seed gives an identical log".
Milestones below are the path to that exit.

Open-item posture: the sim does not depend on `[Q2]`, `[Q4]`, or the
thinker `FLAG`. It consumes an abstract `DecisionProvider`, filled in
later. Numbers from DESIGN.md §6.2 marked `ASSUMED` are placeholders to
tune at `v3.4`.

## v1.1 - sim-skeleton-rng

### Goal

A Node test spawns an agent, fires one bullet, and the tick trace
matches a golden file. Same seed produces the same trace.

### In Scope

- `core/src/sim/world.ts`: `WorldState`, agent and bullet maps, tick
  counter.
- `core/src/sim/rng.ts`: seeded RNG (xoroshiro or similar).
- `core/src/sim/step.ts`: `step(state, actions)` skeleton that applies
  nothing but advances time and lets bullets travel in a straight
  line (no collisions yet).
- Golden file under `core/fixtures/golden/v1.1-single-bullet.json`.

### Out Of Scope

- Movement, rotation, firing semantics (`v1.2`).
- Perception (`v1.3`).

### Exit Criteria

- [ ] `pnpm --filter core test` (planned) golden-matches a single
      bullet traversing a 50-tick trace.
- [ ] Running the same scenario with the same seed twice produces an
      identical state object.

### Files Touched

- `core/src/sim/{world,rng,step}.ts`.
- `core/fixtures/golden/v1.1-single-bullet.json`.
- `core/test/sim/skeleton.test.ts`.

### Tech Refs

- DESIGN.md §6.1 (conventions), §6.2 (world and rules).

### Risks

- Milestone-specific: RNG choice must be deterministic across Node
  and the browser; pin to a pure-JS library with no WASM.

### Test Plan

- Golden-file test.

### Budget Snapshot

- Single tick under 200 µs for a 16-agent world (headroom for
  `v1.5`).

### Demo

`pnpm --filter core test` prints the golden match line.

---

## v1.2 - move-rotate-fire

### Goal

A Node test runs a scripted `Action` stream for 50 ticks on an empty
map; movement, rotation, firing and bullet-obstacle collisions resolve
against goldens.

### In Scope

- Implement `Action` application in `step.ts`: move direction, turn
  direction, fire with cooldown and spread (DESIGN.md §6.2).
- Bullets: muzzle spawn, per-tick travel, remove on obstacle or agent
  hit.
- Weapon stats constants (`core/src/constants.ts`) for bullet speed,
  damage, fire interval, spread.
- Obstacle collision math (segment vs polygon).

### Out Of Scope

- Perception (`v1.3`).
- Bots (`v1.4`).

### Exit Criteria

- [ ] Golden trace for an agent firing while turning matches.
- [ ] Bullet-obstacle intersection removes the bullet in the correct
      tick (goldened).
- [ ] Bullet-agent intersection emits a `Hit` and applies damage.

### Files Touched

- `core/src/sim/step.ts`, `core/src/sim/collision.ts`,
  `core/src/sim/weapons.ts`.
- `core/fixtures/golden/v1.2-*.json`.
- `core/test/sim/{movement,firing,collision}.test.ts`.

### Tech Refs

- DESIGN.md §6.1 conventions, §6.2 bullets.

### Risks

- Collision rounding differences between Node builds. Use integer
  tick-indexed states and avoid relying on `Math.random`.

### Test Plan

- Vitest with multiple hand-crafted scenes per feature.

### Budget Snapshot

- Collisions O(bullets × obstacle-edges); fine at PoC scale.

### Demo

`pnpm --filter core test sim/` prints the full feature-matrix pass.

---

## v1.3 - perception

### Goal

`core.perceive(state, agent)` matches golden `Observation`s on five
hand-built scenes covering cone vision, LOS, hearing bands, incoming
fire.

### In Scope

- `core/src/sim/perceive.ts`: vision cone + LOS, hearing (shots 80 m,
  footsteps 15 m, coarse distance bands), incoming fire (2 m miss
  radius), self status (DESIGN.md §6.2).
- Scene fixtures covering: cone edge; LOS blocked by obstacle;
  hearing without visibility; incoming fire from a bullet that missed;
  all four combined.
- Perception must be a pure function; it is reused by the mind panel
  (`v2.4`).

### Out Of Scope

- Agent-side use of observations (that is the orchestrator in P3).

### Exit Criteria

- [ ] Five scene fixtures produce byte-equal `Observation` output
      against goldens.
- [ ] `perceive` has no non-determinism (property test: 100 random
      states → identical repeated outputs).
- [ ] Benchmarks: `perceive` for 16 agents in a single tick under
      1 ms (headroom for `v1.5` and the mind panel).

### Files Touched

- `core/src/sim/perceive.ts`, `core/src/sim/los.ts`.
- `core/fixtures/scenes/*.json`,
  `core/fixtures/golden/v1.3-*.json`.
- `core/test/sim/perceive.test.ts`.

### Tech Refs

- DESIGN.md §5.3 (`Observation`), §6.2 Perception, §3 principle 3.

### Risks

- See DESIGN.md §10 "Doer quality": wording and clamp of observation is
  what the doer sees. Keep the field order most-important-first per
  DESIGN.md §5.4.

### Test Plan

- Goldens + a property test (seeded random states round-trip).

### Budget Snapshot

- ≤ 1 ms for 16 agents at full tick rate.

### Demo

`pnpm --filter core test sim/perceive` → all scenes pass.

---

## v1.4 - bots-and-maps

### Goal

Two hand-authored maps load; `wanderer` vs `camper` headless match in
Node runs to a `MatchEnd` event with both bots deciding on
`DOER_INTERVAL_TICKS`.

### In Scope

- `core/maps/arena-1.json`, `core/maps/arena-2.json`: ~100 × 100 m
  (DESIGN.md §6.2 `ASSUMED`), polygonal obstacles.
- `core/src/bots/wanderer.ts`, `core/src/bots/camper.ts`:
  `DecisionProvider` implementations emitting the same `DoerAnswer`
  shape, so bots run through the same code path as prompted agents.
- Map loader validating against `MapSpec`.

### Out Of Scope

- Match loop/log emission (`v1.5`).

### Exit Criteria

- [ ] Both maps load and pass a geometry sanity check (no self-
      intersecting polygons; spawn-safe cells on the edge).
- [ ] A 2-bot wanderer-vs-camper match steps for `MATCH_DURATION_TICKS`
      or until one dies, returning a final world state.
- [ ] Bots call `decide` only on tick numbers divisible by
      `DOER_INTERVAL_TICKS` (DESIGN.md rows 32–33).

### Files Touched

- `core/src/bots/{wanderer,camper,types}.ts`.
- `core/maps/arena-1.json`, `core/maps/arena-2.json`,
  `core/src/maps/loader.ts`.
- `core/test/bots/*.test.ts`.

### Tech Refs

- DESIGN.md §6.2 Bots, rows 23 and 33.

### Risks

- Milestone-specific: `camper` requires a target-selection heuristic.
  Keep it as "closest visible enemy", not perfect play; see DESIGN.md
  §10 "Prompts that do not matter" — bots must be beatable.

### Test Plan

- Vitest; bot behavior tested with injected perception.

### Budget Snapshot

- A full match of two bots completes in Node under 5 s.

### Demo

`pnpm --filter core exec tsx scripts/run-bots.ts` → prints
`MatchEnd { ranking: [...] }`.

---

## v1.5 - match-loop-log

### Goal

A 16-bot match in Node finishes faster than real time and emits a
`MatchLog` that validates against the schema.

### In Scope

- `core/src/sim/match.ts`: the loop from DESIGN.md §5.1 core role
  ("tick, collect actions, step, append to log").
- Event emission for all kinds from DESIGN.md §5.3.
- Pluggable `DecisionProvider` (the bots satisfy it today;
  Worker-backed clients land in `v3.1`).
- Log writer that produces the full `MatchLog` object.

### Out Of Scope

- Thinker integration (`v3.2`+).
- Live-tick wall throttle `TICK_MIN_WALL_MS` (that only matters in
  the browser; headless Node runs as fast as possible).

### Exit Criteria

- [ ] A 16-bot match completes and the emitted `MatchLog` passes
      `MatchLog.parse`.
- [ ] Wall-clock in Node under 10 s for a 6,000-tick match (DESIGN.md
      row 20 default).
- [ ] Replaying the log with the renderer in `v2.*` matches the
      spawn/death counts.

### Files Touched

- `core/src/sim/match.ts`, `core/src/sim/log.ts`,
  `core/src/sim/providers.ts`.
- `core/test/sim/match.test.ts`.

### Tech Refs

- DESIGN.md §5.1, §5.3, §8 P1.

### Risks

- Log size: DESIGN.md §5.3 budgets 3–5 MB per 16-agent match. If `Tick`
  events dominate, pack positions as fixed-point and recheck.

### Test Plan

- 16-bot match in Node + schema validation + size check.

### Budget Snapshot

- Log size ≤ 5 MB at defaults.

### Demo

`pnpm --filter core exec tsx scripts/run-match.ts > match.json` →
file validates, roughly 3 MB.

---

## v1.6 - determinism-harness

### Goal

Given the same seed and the same recorded doer answers, replaying
produces a byte-identical `MatchLog`.

### In Scope

- A test runner that drives the match with a `ReplayingProvider` whose
  answers come from a recorded `MatchLog` (`Doer` and `Thinker`
  events).
- Byte-equality assertion on serialized logs after a round trip.
- Document the determinism contract in a comment at the top of
  `core/src/sim/match.ts`.

### Out Of Scope

- Cross-engine determinism (not required per DESIGN.md §6.1).

### Exit Criteria

- [ ] Round-trip test: run → log → replay with recorded answers →
      byte-equal log.
- [ ] Mutating a single doer answer in the recording changes the
      output log (sanity: determinism, not just caching).

### Files Touched

- `core/src/sim/replay-provider.ts`.
- `core/test/sim/determinism.test.ts`.

### Tech Refs

- DESIGN.md §6.1 ("same seed and the same recorded answers, replayed at
  their recorded ticks, reproduce the same log").

### Risks

- Floating-point drift. Pin to deterministic math primitives
  (seeded RNG + no `performance.now`).

### Test Plan

- Vitest round-trip over the 16-bot match log from `v1.5`.

### Budget Snapshot

- Replay runs in the same wall budget as the live run.

### Demo

`pnpm --filter core test sim/determinism` prints `OK`.
