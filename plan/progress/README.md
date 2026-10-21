# Progress notes

Evidence of what actually happened as milestones ship. The plan files
predict; progress notes record.

## When to write a note

- A milestone's exit criteria have been met (one note per milestone).
- A milestone's exit criteria were revised (short note explaining
  why; also edit the milestone in the phase file).
- A spike landed (`v0.5`, `v0.6`, `v3.5`, `v3.6`): the measurement
  and the decision taken.
- A planned validation command failed in a way that changed the plan
  (e.g. a `wrangler deploy` constraint surfaced only on the real
  account).

Do not write a note for routine implementation that simply followed
the plan.

## File naming

`vX.Y-<slug>.md`, matching the milestone id and slug from the phase
files. Example: `v0.5-clef-flash-spike.md`.

## Shape of a note

Keep it short. Fill only the fields that carry information.

```markdown
# vX.Y - slug

- Date: YYYY-MM-DD
- Phase: PN
- Status: completed | revised | spike-decision | blocked

## Commands run

- `pnpm --filter core test` → OK
- `wrangler dev` + curl `/decide` → 200
- (etc.)

## Evidence

- Link or path to the artifact that proves it: a saved MatchLog, a
  screenshot, a deployed URL, a measurement table, a stranger-test
  note.

## Deviations from the plan

- What was built differently than the milestone predicted and why.

## Carry-forward risks

- What this milestone did not resolve; which later milestone picks it
  up.

## Decisions / Blockers

- Any open-item from DESIGN.md §12 (`[Q1]`–`[Q6]`, `FLAG`) resolved or
  moved. Any blocker that needs the designer.
```

## Special notes

The following milestones have progress artifacts the plan already
names:

- `v0.5-clef-flash-spike.md` — must state the row 34 decision and
  record measured latency and rate limit (feeds DESIGN.md §9).
- `v3.4-review-checklist.md` — the designer's checklist signoff.
- `v3.5-measurement.md` — the thinker-model `[Q2]` decision and the
  updated §9 cells.
- `v3.6-anti-goal.md` — the anti-goal clearance across six replays.
- `v4.5-stranger.md` — the stranger-test writeup.

## What does not go here

- Code diffs or long design discussion: those belong in the repo
  history or in an ADR under `plan/` if ever needed.
- Restated plan text: link, do not copy.
- Risks that already live in DESIGN.md §10: link to the §10 bullet
  instead of restating it.
