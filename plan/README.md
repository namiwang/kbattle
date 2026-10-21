# kbattle — Implementation Plan

Status: v0 of the task-level plan, 2026-10-21. Companion to
[`../DESIGN.md`](../DESIGN.md). DESIGN.md is the design; this folder is the
"how do we build it" written after it, as decided in DESIGN.md §2 row 30.

## How to read this folder

- Start with [`roadmap.md`](roadmap.md): one table of every milestone,
  in dependency order, with phase, goal, prerequisites and the demo.
- Then open the phase file you care about:
  - [`phase-0-foundations.md`](phase-0-foundations.md) — scaffolding,
    schemas, Worker skeleton, Clef and thinker spikes (DESIGN.md §8 P0).
  - [`phase-1-sim.md`](phase-1-sim.md) — deterministic sim, perception,
    bots, maps, match loop (DESIGN.md §8 P1).
  - [`phase-2-replay.md`](phase-2-replay.md) — PixiJS replay and mind
    panel (DESIGN.md §8 P2).
  - [`phase-3-brains.md`](phase-3-brains.md) — doer and thinker clients,
    orchestrator, default prompts, cost measurement (DESIGN.md §8 P3).
  - [`phase-4-public.md`](phase-4-public.md) — UI, run screen, Worker
    guard, deploy (DESIGN.md §8 P4).
- [`progress/README.md`](progress/README.md) describes how to record
  what actually happened as milestones ship.
- Risks live in DESIGN.md §10. Milestone entries only call out their own
  milestone-specific risk; everything else links back to §10.

## Conventions

- **Milestones are versioned `v<phase>.<n>`** (e.g. `v0.3`, `v1.5`).
  Order inside the whole plan is `v0.1 → v4.5`.
- **Each milestone is runnable or demoable.** If a milestone cannot be
  demoed, it is split.
- **Exit criteria are requirements**, written as `[ ]` checkboxes, not
  evidence that work is finished.
- **"Files Touched" is predictive.** Nothing has been built; paths and
  module names are the planner's current guess. Deviations go in the
  progress note.
- **DESIGN.md is the source of truth.** Milestone entries link to §2 rows
  and §-numbered sections instead of restating them.
- **Validation commands are planned gates.** The toolchain is not set
  up yet; the commands listed (`pnpm install`, `pnpm -r test`,
  `wrangler dev`, etc.) are what each milestone will run once the
  scaffold in `v0.1` lands.
- **Open items are respected.** Where a milestone depends on DESIGN.md
  `[Q1]`–`[Q6]` or the thinker-model `FLAG`, it says so and names the
  assumption used:
  - `[Q1]` artifact — this folder is the answer.
  - `[Q2]` thinker model `FLAG` — assume Anthropic Claude (chosen at
    `v3.5`); Haiku 5.5 for cheap iteration, Sonnet 5.5 for the default
    public demo (DESIGN.md §9).
  - `[Q3]` Worker guard — Cloudflare rate-limiting rule + Workers AI
    daily spend cap (DESIGN.md row 28, §5.7).
  - `[Q4]` Clef fallback — resolved by the `v0.5` spike. Default:
    continue with `@cf/cloudflare/clef-flash`. If the spike fires row
    34, swap in the OpenAI Decisions adapter at `v3.1` and drop the
    Worker guard milestone to a static-hosting one.
  - `[Q5]` default slots — row 23: 8 slots, 1 prompted, 7 bots.
  - `[Q6]` tick floor — row 31: `TICK_MIN_WALL_MS = 50`.
- **Parallelism is called out per milestone.** Default is strict
  sequence; parallel tracks are only used where they are safe
  (DESIGN.md §8 says P0 Clef spike and P1 sim can run alongside, and the
  replay viewer only needs a sample log).

## Updating the plan

- When a milestone's exit criteria change, edit the milestone in place
  and leave a one-line note in `progress/` saying why.
- When a milestone is finished, add a progress note under
  `progress/vX.Y-<slug>.md` with evidence; do not mark the exit
  criteria "done" inside the plan file.
- Keep this folder short enough to read in one sitting. Push detail
  back into DESIGN.md or an ADR when it grows.
