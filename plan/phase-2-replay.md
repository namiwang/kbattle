# Phase 2 — Replay

Covers DESIGN.md §8 P2. Goal of the phase: a PixiJS replay viewer in
`web/` that reads a `MatchLog` file and shows the match, with a mind
panel (DESIGN.md row 27) and timeline markers. The viewer never runs
the sim; it reads `Tick` events (DESIGN.md §5.3).

Open-item posture: none of P2 depends on `[Q2]`/`[Q4]`. P2 can start
as soon as `v0.3` provides a sample log; it does not have to wait for
P1 to finish.

## v2.1 - pixi-scene-bootstrap

### Goal

`pnpm --filter web dev` loads a sample `MatchLog` and renders
obstacles and agents at tick 0 in a PixiJS canvas.

### In Scope

- Vite entry wiring PixiJS.
- `web/src/replay/stage.ts`: top-down canvas, meters-to-pixels
  transform (y down, 0° = +x, DESIGN.md §6.1).
- Map renderer: polygonal obstacles from `MapSpec`.
- Agent renderer: dots with facing arrows.
- A dev drop-zone that loads `core/fixtures/sample-log.json`.

### Out Of Scope

- Playback controls (`v2.2`), bullets/follow (`v2.3`), mind panel
  (`v2.4`), file UI (`v2.5`).

### Exit Criteria

- [ ] At tick 0, agent positions, facings and all obstacles render
      correctly against the sample log.
- [ ] Canvas resize preserves meters-to-pixels aspect.
- [ ] Zero `console.error` on load.

### Files Touched

- `web/src/replay/{stage,map,agents,coords}.ts`.
- `web/src/main.ts` (route to the replay in dev).

### Tech Refs

- DESIGN.md §5.1 web role, §6.1 conventions, §7 Replay.

### Risks

- Milestone-specific: PixiJS v8 API changes; pin the version in
  `web/package.json`.

### Test Plan

- Manual smoke in browser.
- Playwright headless check that one obstacle and one agent are drawn
  (optional, time permitting).

### Budget Snapshot

- 60 fps on a mid laptop with a 16-agent scene.

### Demo

Open `http://localhost:5173/replay` → stale PixiJS scene of tick 0.

---

## v2.2 - playback-controls

### Goal

Play, pause, scrub and speed buttons advance the renderer through
every `Tick` event of the sample log.

### In Scope

- `web/src/replay/clock.ts`: tick cursor, play, pause, scrub, speed
  (0.25x, 0.5x, 1x, 2x, 4x).
- Timeline bar with current tick, total ticks, drag-to-scrub.
- Keyboard shortcuts (space to toggle; left/right to step).

### Out Of Scope

- Mind panel (`v2.4`).

### Exit Criteria

- [ ] Play advances through every tick in the sample log.
- [ ] Pause stops the renderer within one frame.
- [ ] Scrub jumps to any tick without replaying from zero.
- [ ] Speed changes do not break tick coherence (positions remain in
      sync with the current tick).

### Files Touched

- `web/src/replay/clock.ts`, `web/src/replay/controls.tsx` (or plain
  TS DOM), `web/src/replay/timeline.ts`.
- `web/test/replay/clock.test.ts`.

### Tech Refs

- DESIGN.md §7 Replay.

### Risks

- Scrub reconstructing world state from `Tick` events only (no
  simulation); the plan is to index by tick on load.

### Test Plan

- Unit test on the clock state machine.
- Manual browser smoke across all speeds.

### Budget Snapshot

- Scrub to any tick in a 6,000-tick log under 16 ms.

### Demo

Open the replay page → scrub to tick 3,000 → agents jump to that
state; play to resume.

---

## v2.3 - bullets-follow-overlays

### Goal

Bullet trails, follow-camera and vision-cone overlay all toggle on
and off during playback.

### In Scope

- Bullet rendering from `Tick.bullets` with a short fading trail.
- Follow-agent camera: a dropdown lists agent ids; camera centers on
  the chosen agent each tick.
- Vision-cone overlay toggle: draw the cone of the followed agent
  using `core.perceive` (DESIGN.md §6.2 cone values).

### Out Of Scope

- Showing *other* agents' perception (that is `v2.4` mind panel).

### Exit Criteria

- [ ] Bullet trails disappear within N ticks after the bullet is gone
      from `Tick`.
- [ ] Follow dropdown lists every spawned agent; selecting re-centers
      camera.
- [ ] Vision-cone overlay toggles on/off and recomputes per tick
      without visible stutter.

### Files Touched

- `web/src/replay/{bullets,camera,overlay}.ts`.

### Tech Refs

- DESIGN.md §7, §6.2 Perception (cone values).

### Risks

- Milestone-specific: performance of the perception overlay — reuse
  the `core.perceive` function from `v1.3` with memoization per tick.

### Test Plan

- Manual browser smoke.

### Budget Snapshot

- 60 fps with trails and overlay on at 1x speed.

### Demo

Open replay → follow `a0` → toggle overlay on → cone drawn around
`a0`.

---

## v2.4 - mind-panel

### Goal

For a selected agent at the scrubbed tick, the mind panel shows
recomputed perception, current plan text, last doer answers with
probabilities, and timeline markers for `Thinker` and faulted calls
(DESIGN.md row 27).

### In Scope

- `web/src/replay/mind-panel.ts`: side panel bound to the clock and
  the followed agent.
- Perception recomputed on demand via `core.perceive` (DESIGN.md §5.3).
- Current plan text: latest successful `Thinker` event ≤ current tick
  for the agent.
- Last doer answers: latest `Doer` event ≤ current tick for the agent,
  with probabilities visible for `noul` answers.
- Timeline markers: dots for `Thinker` events (keyed by `tick` and
  `requestedTick`, DESIGN.md §5.3) and faults (any `ok: false`).

### Out Of Scope

- Writing prompts (`v4.1`).

### Exit Criteria

- [ ] For a sample log containing crafted `Doer` and `Thinker` events,
      the panel updates within one frame of a scrub.
- [ ] Fault markers appear exactly on faulted ticks.
- [ ] A `Thinker` event with `requestedTick ≠ tick` draws two markers
      (requested and applied) linked.

### Files Touched

- `web/src/replay/mind-panel.ts`,
  `web/src/replay/mind-panel.css`.
- `core/fixtures/sample-log.json` grows crafted `Doer`/`Thinker`
  events to drive the panel in dev.

### Tech Refs

- DESIGN.md row 27, §5.3 event shapes, §7 Replay.

### Risks

- Milestone-specific: with no mind events in the sample log yet, this
  milestone extends the fixture; the real end-to-end panel waits for
  `v3.3` events.

### Test Plan

- Scripted scrub through crafted event stream; assertion harness
  checks panel DOM.

### Budget Snapshot

- Panel update under 8 ms on scrub.

### Demo

Open replay → follow `a0` → scrub to a crafted thinker-fault tick →
panel shows the fault with reason and the previous plan still in
view.

---

## v2.5 - file-upload-download

### Goal

Upload a `MatchLog` from disk, watch it; download the current log as
JSON.

### In Scope

- Drag-and-drop upload accepting a single `.json` file; validate with
  `MatchLog` schema (DESIGN.md §5.3).
- Download button that saves the currently loaded `MatchLog` to disk.
- Error UI on schema failure with the zod issue list.

### Out Of Scope

- Hosting replays (DESIGN.md §11 post-PoC).

### Exit Criteria

- [ ] Uploading a `MatchLog` opens the replay without a page reload.
- [ ] Downloading a `MatchLog` produces a file that re-uploads
      successfully.
- [ ] Invalid JSON shows a readable error.

### Files Touched

- `web/src/replay/files.ts`, `web/src/replay/errors.ts`.

### Tech Refs

- DESIGN.md §5.3, §7 Files, §3 principle 7.

### Risks

- Large logs (3–5 MB) parse synchronously; show a loading state.

### Test Plan

- Manual smoke; one unit test on the parse-and-report-error path.

### Budget Snapshot

- Upload-to-first-frame under 300 ms for a 5 MB log.

### Demo

Save the sample log from `v1.5` → upload here → match plays back.
