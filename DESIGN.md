# kbattle — Design

Status: v3.0 draft, 2026-10-21. Scope: tech demo / proof of concept.

v3.0 consolidates v2.0 with two outside sources: the RaidRank design docs
(`research/ai-extraction-fps/en`, a sibling project with code-authored
agents and server-side async simulation) and the AI-agents-in-games survey
(`research/ai-agents-in-games.md`). It adds nothing to the game. It adds
the principles behind the decisions, the conventions a builder would
otherwise guess, a fault table, the replay "mind panel", and an abuse guard
for the Worker. §2 remains the decision log. `ASSUMED` marks my calls where
no answer was given, `FLAG` marks decisions still owed, `[Qn]` points at a
question asked in chat.

## 1. Intent

LLM-driven agents play a simplified top-down battle royale. Humans do not
play; they author an agent's mind and watch the replay.

The loop: write prompts → run a match in the browser → watch the replay →
edit the prompts → run again. Public URL, no accounts.

Why: to learn whether prompt-authored minds, running on a cheap per-tick
decision model plus an occasional LLM planner, produce play that is visibly
different from prompt to prompt and better than scripted bots. If yes,
kbattle grows a ladder. If no, the PoC answered the question cheaply.

### Goals

- A stranger with an API key writes a thinker prompt, runs a match and
  watches it without reading code.
- At any tick the replay shows what an agent perceived, what its thinker
  last said, and what its doer chose.
- Prompt changes produce visibly different play.
- Cost and wall-clock per match are measured numbers, recorded here at P3.

### Non-goals for the PoC

Zone, loot, items, armor, meds, ammo, grenades, squads, comms, stances,
vehicles, live streaming, accounts, ladder, server-side match runner,
self-hosted models, more than one provider per role.

### Anti-goals (failure even if it works)

- Prompts do not matter: two different minds play the same way.
- Prompted agents lose to the scripted bots in every match.
- The viewer cannot see why an agent did something.
- A default match takes longer than about 15 minutes of wall-clock.
- Strangers run up Nami's Workers AI bill.
- A user's key leaves their browser for anything but the provider.

## 2. Decision log

Rows 1 to 22 are Nami's decisions from v1 and v2. Rows 23 onward are
v3.0 additions; each is `ASSUMED` until confirmed.

| # | Topic | Decision |
|---|-------|----------|
| 1 | Scope | Tech demo / PoC with a public URL. Kept simple, no accounts. |
| 2 | Who pays | Thinker: the user's own API key, entered in the browser. Doer: Nami's Workers AI binding, reached through the Worker. |
| 3 | Live vs replay | Replay now. The renderer reads the match log, so live streaming later means streaming the same log. |
| 4 | End loop | Sandbox matches now; ladder later. |
| 5 | World | 2D continuous plane, top-down, obstacles block line of sight. |
| 6 | Match size | 4 to 16 solo agents, configurable. |
| 7 | Mechanics | HP, death, move, rotate, shoot. No zone, pickups or items. |
| 8 | Combat | Real simulated bullets: projectiles with velocity, travel time, collision. |
| 9 | Perception | Vision cone with LOS; hearing (shots, footsteps); own status plus the full static map; incoming-fire bearing. |
| 10 | Tick | Physics at 50 ms. |
| 11 | Doer | A decision model (Clef class). Eligible every tick; its last answer persists until replaced. Fixed questions: move, turn, fire, target, escalate. |
| 12 | Thinker | An LLM with a user-authored system prompt. Writes plan text (injected into the doer state) and a scratchpad it rewrites each call. Runs when the doer escalates or a max interval passes. |
| 13 | User surface | Thinker system prompt and per-question doer instructions. Not cadence, budgets or model choice. |
| 14 | Escalation | Every doer call carries an `escalate` question. The doer decides; the runtime only debounces. |
| 15 | Comms | None. |
| 16 | Refusals | Treated like invalid output: keep the last plan, log it. |
| 17 | Stack | TypeScript pnpm monorepo, PixiJS renderer, Cloudflare for everything server-side. |
| 18 | Models | Hard-coded constants, one per role, behind adapter interfaces so switching is a config change. Doer = `@cf/cloudflare/clef-flash`. `FLAG` thinker model `[Q2]`; candidates and per-match cost in §9. |
| 19 | Where it runs | The browser runs the match. Server side is one Worker now; R2, Durable Objects and D1 only post-PoC. |
| 20 | Match end | Last agent alive, or `MATCH_DURATION_TICKS` elapsed. `ASSUMED` ranking: survival, then kills, then HP. Zone is the first post-PoC mechanic. |
| 21 | Rate limits | Not a design driver. One interval constant plus backoff on 429. |
| 22 | Self-hosting | Never, not even as a fallback. |
| 23 | Slots | `ASSUMED` A match is a list of slots; each slot is the user's prompted mind or a scripted bot. One prompt profile in the UI; the config says how many slots use it. Default run: 8 slots, 1 prompted, 7 bots. `[Q5]` |
| 24 | Conventions | `ASSUMED` Screen convention everywhere: meters, y down, angles in degrees clockwise-positive with 0° = +x. Relative bearings in (−180, 180], positive = to the right. Ticks are the only time unit inside the sim. |
| 25 | Probability answers | `ASSUMED` A `noul` answer becomes an action by threshold: fire at ≥ 0.5, escalate at ≥ 0.7. Constants, not user-editable. |
| 26 | Doer cadence | `ASSUMED` `DOER_INTERVAL_TICKS = 10` (one decision per 500 ms of sim time). Every tick stays possible by constant; see §9 for why 10. |
| 27 | Mind panel | `ASSUMED` The replay viewer shows, for a selected agent at the current tick, its perception, its current plan text, its last doer answers, and timeline markers for thinker calls and faults. |
| 28 | Worker guard | `ASSUMED` `/decide` is protected by a Cloudflare rate-limiting rule per IP and a daily Workers AI spend cap. No auth, no tokens. `[Q3]` |
| 29 | Key failure | `ASSUMED` A 401/403 from the thinker provider stops the match and shows the error. Every other thinker failure keeps the last plan (row 16). |
| 30 | Artifact | `ASSUMED` This file is the design; the task-level implementation plan is a separate document written after this one is approved. `[Q1]` |
| 31 | Sim clock | `ASSUMED` The doer is lockstep: a tick that is due for doer answers waits for them (or their timeout). The thinker is asynchronous: its plan lands at whatever tick it returns on, and the event records both ticks. A tick never advances faster than real time (`TICK_MIN_WALL_MS = 50`), so thinker latency in sim time equals wall latency instead of being multiplied by sim speed. `[Q6]` |
| 32 | Doer-only slot | `ASSUMED` A third slot kind, `doer`: the default doer instructions and a fixed plan text, no thinker. It is the control for "is it the thinker or the doer that matters" and lets a visitor without a key run a non-bot match. |
| 33 | Bot cadence | `ASSUMED` Scripted bots decide every `DOER_INTERVAL_TICKS` like everyone else, so the quality floor is not a reaction-time advantage. |
| 34 | Clef fallback | `ASSUMED` If the P0 spike shows clef-flash cannot serve the §5.4 shape, or is not available on the account, the doer moves to OpenAI Decisions on the user's key, the Worker shrinks to static hosting, and rows 2, 28 and §5.7 lapse. No Workers AI text model prompted for JSON: the decision-model premise is the point. `[Q4]` |

## 3. Principles

These are the rules behind §2, drawn from what worked across the agent
integrations in `research/ai-agents-in-games.md` (Mantella, Tales from the
RimWorld, Living in Calradia, the benchmark environments) and from the
RaidRank runtime model. A builder facing an undecided question should pick
the answer that keeps all eight true.

1. **The model proposes, the sim decides.** The doer picks from fixed
   choices; the sim clamps, resolves and is the only writer of world state.
2. **Fixed, typed action space.** Users author words (a system prompt and
   per-question instructions), never actions, choices or code.
3. **Perception is a rule.** An agent knows only what `core.perceive`
   gives it: cone and LOS vision, hearing, incoming fire, own status, the
   static map. Nothing else leaks into a prompt.
4. **Every call is logged.** Each doer and thinker call is an event with
   its input, output and outcome. Failures are events, not exceptions.
5. **Fallback is "keep doing that".** A failed or late answer never
   changes the sim's behavior: the last answer stands. The doer waits only
   up to its timeout; the thinker never holds a tick (row 31).
6. **Memory is the scratchpad.** The only persistent agent state is the
   text the thinker rewrites each call. No vector store, no summaries.
7. **The match is one file.** The replay JSON is the only artifact; sharing
   is sending the file; the renderer never runs the sim.
8. **Nothing to operate.** No accounts, no database, no code execution,
   one Worker. Add machinery only when the demo earns it.

## 4. Prior art and positioning

| Family | Examples | What kbattle takes | What it leaves |
|--------|----------|--------------------|----------------|
| Programming games | Screeps, Battlecode, CodinGame (RaidRank `biz/competitor-analysis.md`) | Tick model: all agents act, then the sim resolves. Replay as the feedback surface. Fixed seeds for comparison. | Code-authored agents, sandboxes, server-side queues, ladders. |
| RaidRank (sibling design) | `research/ai-extraction-fps/en` | Game-data vocabulary (Vec2, degrees, ticks, sound as data), fault model, replay requirements (timeline, decision markers, fault markers), the sandbox loop. | Budget modes (sim time is decoupled from wall time here), extraction, loot, vehicles, stances, Rails monolith. |
| LLM game agents | Mantella, Tales from the RimWorld, Calradia, Convai, Gigax | Propose/validate boundary, typed actions, logged calls, deterministic fallback, knowledge boundaries. | Voice, NPC dialogue, generated-code skills. |
| LLM arenas | Agent Arena, LLM Skirmish, Arena42 (per the RaidRank competitor doc) | Evidence that spectating LLM agents is a product. | Benchmark framing, hosted agents. |

One line: kbattle is the prompt-authored, browser-run, replay-first cousin
of RaidRank. RaidRank asks "how good is your code"; kbattle asks "how good
is your prompt".

## 5. Architecture

### 5.1 Packages

| Package | Role |
|---------|------|
| `core/` | Types, deterministic sim, perception, scripted bots, maps, and the match loop (tick, collect actions, step, append to log). Pure TypeScript: no I/O, no model calls. Runs in Node and the browser. |
| `brain/` | Thinker and doer drivers plus the two provider adapters. The only package that makes network calls. |
| `web/` | Vite app: prompt editors, key entry (localStorage), match config, runs the match, PixiJS replay with mind panel, download and upload of replay JSON. |
| `worker/` | One Cloudflare Worker: serves `web/` as static assets and exposes `POST /decide` → Workers AI `clef-flash`. |

Split further only when a package becomes hard to test.

### 5.2 Runtime

- The match runs on the browser main thread as an async loop. Model calls
  are awaited fetches, so the UI stays responsive. Move to a Web Worker
  only if the UI stutters.
- Tick rule (row 31): a tick advances when every doer answer due this
  tick is in or timed out, and at least `TICK_MIN_WALL_MS` of wall time
  has passed since the previous tick. Thinker results are applied at the
  start of the first tick after they arrive. So a match runs at real time
  when the doer is fast, slower when it is not, never faster.
- Concurrency is bounded by provider rate limits, not the browser; both
  endpoints speak HTTP/2. See §9 for what the rate limit does to match
  size.
- Replays are one JSON file. Sharing is downloading the file.
- Local dev: `wrangler dev` for the Worker, Vite for the app.
- Only `worker/` and the adapters in `brain/` touch Cloudflare or provider
  APIs.

### 5.3 Types, validation and the log

Plain TS interfaces inside the process. Zod only where data enters from
outside, each schema with its type derived via `z.infer`:

| Boundary | Schema |
|----------|--------|
| Doer response, Worker → browser | `DoerAnswer` |
| Thinker response, LLM → browser | `Plan = { text, scratchpad }` |
| `/decide` body, browser → Worker | `DecideRequest` |
| Replay file, disk → browser | `MatchLog` |
| User config, forms and links | `MatchConfig` |

Internal types: `MapSpec`, `WorldState`, `Agent`, `Bullet`, `Obstacle`,
`Observation`, `Action`, `Event`.

```
MatchConfig = { mapId, seed, durationTicks, slots: Slot[] }
Slot        = { kind: "prompted" } | { kind: "doer" } | { kind: "bot", bot: "wanderer" | "camper" }

MatchLog = { version, config, seed, prompts, events[] }

Event =
  | Spawn    { tick, agent, pos, facing }
  | Tick     { tick, agents: [id, x, y, facing, hp][], bullets: [id, x, y][] }
  | Shot     { tick, agent, bullet }
  | Hit      { tick, bullet, target, damage }
  | Death    { tick, agent, killer }
  | Doer     { tick, agent, answers, ok, error? }
  | Thinker  { tick, requestedTick, agent, input, plan, ok, error? }
  | MatchEnd { tick, ranking }
```

`Tick` carries positions, so the renderer never runs the sim. A bullet that
hits an obstacle simply stops appearing in `Tick`. Escalation is an answer
inside `Doer`; failures are a flag on the call events. `Thinker.tick` is
the tick the plan was applied, `requestedTick` the tick it was asked for;
the mind panel draws both. `prompts` holds the
thinker system prompt and doer instructions that produced the match, so a
replay is reproducible and comparable. Doer state is not logged (about
200 MB per match); `core.perceive(state, agent)` is pure, so the mind
panel recomputes it from `Tick`. Expect 3 to 5 MB per 16-agent match.

### 5.4 The two-model brain

```
                  every DOER_INTERVAL_TICKS                on escalate / max gap
observation ───▶  DOER (decision model)  ──escalate?──▶  THINKER (LLM)
   │               state = perception + plan text          in: system prompt (user),
   │               questions: move, turn, fire,                scratchpad, perception,
   │                          target, escalate                 digest of events since last call
   │               out: one typed answer per question      out: plan text, scratchpad
   ▼
 action (persists until the next doer answer) ───▶ sim.step every 50 ms
```

Doer request in Clef's shape (questions keyed by id; `noul` is a
probability, `choice` takes a criteria map). Verify the exact wire shape
against the Workers AI docs in P0.

```json
{
  "model": "clef-flash",
  "state": {
    "self": { "pos": [x, y], "facing": deg, "hp": 72 },
    "visible": [{ "id": "a3", "bearing": -12, "dist": 38, "moving": true }],
    "heard": [{ "kind": "shot", "bearing": 140, "dist": "far" }],
    "incoming": [{ "bearing": 95 }],
    "plan": "Hold the east wall, engage anyone crossing the gap, retreat north under 40 HP."
  },
  "questions": {
    "move":     { "type": "choice", "instructions": "<user-editable>", "criteria": { "forward": "...", "back": "...", "left": "...", "right": "...", "stop": "..." } },
    "turn":     { "type": "choice", "instructions": "<user-editable>", "criteria": { "left": "...", "right": "...", "none": "...", "face_target": "..." } },
    "fire":     { "type": "noul",   "instructions": "<user-editable>" },
    "target":   { "type": "choice", "instructions": "<user-editable>", "criteria": { "a3": "...", "a7": "...", "none": "..." } },
    "escalate": { "type": "noul",   "instructions": "fixed by kbattle: the plan no longer fits the situation" }
  }
}
```

Rules:

- The doer runs every `DOER_INTERVAL_TICKS` ticks, starting at tick 1,
  one call per agent per due tick, each with `DOER_TIMEOUT_MS`. Answers
  persist until replaced. Bots and `doer` slots follow the same cadence
  (rows 32, 33).
- The thinker's system prompt is a fixed harness prompt (the game, the
  observation format, the JSON output) followed by the user's prompt. The
  user never sees or edits the harness part.
- `noul` answers become actions by threshold (row 25). `face_target` with
  `target = none` means `none`.
- `target` choices are built per call from visible enemy ids.
- Escalation is honored when no thinker call is in flight for that agent
  and `THINKER_MIN_GAP_TICKS` have passed. `THINKER_MAX_GAP_TICKS` forces
  a call if the doer never escalates.
- The thinker returns a JSON object validated by the `Plan` schema (use
  the provider's structured-output feature where it exists). Anything else
  is a failure per §5.5.
- Doer instructions are per question, text only, length-capped. Users
  cannot add questions or change choices.
- Clef-flash has a 24,576-token context and truncates `state`, so the
  state is ordered most-important-first. Budget: under 600 tokens for the
  doer state, under 1,500 for the thinker input. The event digest for the
  thinker is text: hits taken, kills, shots heard, enemies seen since the
  last call, newest first, cut to fit.
- The app ships default prompts: one thinker system prompt and one
  instruction per doer question, good enough that the default run is
  watchable. Writing them is part of P3.

### 5.5 Fault model

Every row is logged as a `Doer` or `Thinker` event with `ok: false` and
`error`. Nothing in this table stops the sim except the last row.

| Fault | Doer | Thinker |
|-------|------|---------|
| Timeout, network error, 5xx | Keep last answer | Keep last plan |
| 429 | Back off (exponential, capped), keep last answer. If chronic, raise `DOER_INTERVAL_TICKS`. | Back off, keep last plan |
| Invalid JSON or schema failure | Keep last answer | Keep last plan |
| Refusal (`stop_reason: refusal`) | n/a | Keep last plan |
| Call due while one is in flight | Cannot happen: the tick waits for the doer up to `DOER_TIMEOUT_MS` | Debounce: one in flight per agent, later escalations dropped |
| 401/403 (bad key) | n/a (Nami's binding) | Stop the match, show the error (row 29) |

### 5.6 Adapters and constants

- `ThinkerProvider.complete(system, messages) → Plan`. One implementation
  (Anthropic, called from the browser with the SDK's
  `dangerouslyAllowBrowser: true`; low effort, small `max_tokens`).
- `DecisionProvider.decide(state, questions) → DoerAnswer`. One
  implementation: the Worker. Switch the constant to `@cf/cloudflare/clef`
  if flash plays badly. Jev (same shape as Clef) and OpenAI Decisions
  (`noul` → `predicate`) are later adapters.
- Tests use scripted bots from `core/` and a fake `DecisionProvider` and
  `ThinkerProvider`.
- All constants in one file: `THINKER_MODEL`, `DOER_MODEL`,
  `MATCH_DURATION_TICKS`, `DOER_INTERVAL_TICKS`, `DOER_TIMEOUT_MS`,
  `TICK_MIN_WALL_MS`, `THINKER_MIN_GAP_TICKS`, `THINKER_MAX_GAP_TICKS`,
  `FIRE_THRESHOLD`, `ESCALATE_THRESHOLD`.

### 5.7 Worker and abuse guard

`POST /decide` costs Nami money on every call. Protection for the PoC
(row 28): a Cloudflare rate-limiting rule keyed by IP, sized for one
match at a time per IP, plus a daily spend cap on Workers AI. Accept that
a determined abuser can still spend the daily cap. If that happens, the
next step is a per-match token issued by the Worker with a per-token call
budget, not accounts.

## 6. Game design

### 6.1 Conventions (row 24)

- `Vec2 { x, y }` in meters, y down (PixiJS convention, so the renderer
  draws without flipping).
- Angles in degrees, clockwise-positive, 0° = +x. `facing` is absolute.
- Bearings in observations are relative to `facing`, normalized to
  (−180, 180], positive = to the right.
- Ticks are the time unit inside the sim; constants written in m/s or
  seconds are converted once at load.
- Ids: agents `a0`…`a15` in slot order, bullets `b<n>` ascending.
- Seeded RNG for spawn and spread. Same seed and the same recorded
  answers, replayed at their recorded ticks, reproduce the same log.
  Tests prove this in Node with fake providers; cross-engine determinism
  is not required because the renderer reads `Tick`.

### 6.2 World and rules

- **Arena.** Rectangular continuous map with polygonal obstacles, fully
  known to every agent. Spawns spread around the edge. `ASSUMED` about
  100 by 100 m so contact happens within a minute without a zone. Two
  hand-authored maps as JSON in `core/`.
- **Agent.** Position, facing, HP 100, one weapon with fixed stats (bullet
  speed, damage, fire interval, spread). Fixed move speed relative to
  facing, fixed turn rate.
- **Actions per tick.** Move direction, turn direction, fire. The sim
  clamps everything; the doer only picks discrete choices.
- **Bullets.** Spawned at the muzzle with facing plus seeded spread,
  travel per tick, removed on hitting an obstacle or an agent (damage).
  Travel time and leading a moving target are real.
- **Perception**, computed by the sim per agent per tick:
  - Vision: enemies inside a cone (`ASSUMED` 90°, 60 m) with clear LOS.
  - Hearing: shots within 80 m, footsteps within 15 m, as bearing plus a
    coarse distance band.
  - Incoming: bearing of bullets that hit or passed within 2 m this tick.
  - Self: position, facing, HP, kills, time remaining.
- **Bots.** Two scripted minds, used as the quality floor and in tests:
  `wanderer` (roam, face and shoot anything visible) and `camper` (hold a
  corner, shoot anything visible, relocate when hit). They decide on the
  doer cadence (row 33) and emit the same `Action` shape.
- **Match end.** Last agent alive, or `MATCH_DURATION_TICKS` (`ASSUMED`
  6,000 = 5 min sim time). Ranking: survival, kills, HP.
- **Out of scope.** See §1 non-goals.

## 7. User surface

One page, no routes needed:

1. **Key.** Paste a provider key; stored in localStorage; the page says it
   is sent only to the provider.
2. **Mind.** The thinker system prompt (textarea) and one instruction per
   doer question (five short fields, length-capped). Defaults filled in.
3. **Match.** Map, seed, slot count, how many slots are prompted, how many
   are doer-only, duration. Default per row 23. Without a key, prompted
   slots are unavailable and doer-only slots are offered instead.
4. **Run.** Progress by tick with call counts and failures. Cancel.
5. **Replay.** PixiJS top-down: play, pause, scrub, speed, follow an agent,
   bullet trails, perception overlay if cheap. The **mind panel** (row 27)
   for the selected agent: perception at this tick, current plan text,
   last doer answers with probabilities, and a timeline with markers for
   thinker calls and faults.
6. **Files.** Download the replay JSON; upload one to watch it. The file
   carries its prompts, so "what did I write for this run" is answered.

The iteration loop RaidRank calls the sandbox loop is: keep the seed,
change the prompt, run again, compare the two replays side by side in two
tabs. Nothing more is built for it in the PoC.

## 8. Phases

| Phase | Deliverable | Exit |
|-------|-------------|------|
| P0 Foundations | `core/` types and conventions, the five boundary schemas, a hand-written sample log, Worker skeleton, thinker adapter spike | Sample log validates. `clef-flash` answers a sample request through the Worker; the wire shape in §5.4 is confirmed or corrected, and its real rate limit and latency are measured and written into §9 (or row 34 fires). The thinker answers a structured call from a browser origin with a pasted key. |
| P1 Sim | `core/` sim, perception, bots, maps, match loop, tests | A 16-bot match runs faster than real time in Node. Same seed gives an identical log. Bullets, LOS, hearing, incoming fire and both bots have tests. |
| P2 Replay | PixiJS replay and mind panel in `web/`, reading a log file | Play, pause, scrub, follow, bullet trails. Mind panel shows perception, plan and doer answers for a sample log. Thinker and fault markers on the timeline. |
| P3 Brains | `brain/`, both adapters, default prompts, match runs in the browser | A prompted agent beats bots in some matches. Two different prompts play visibly differently, and a prompted agent plays differently from a doer-only one. Cost and wall-clock per default match recorded in §9. |
| P4 Public | Key entry, editors, config, run, watch, files, Worker guard, deploy | A stranger with a key writes prompts and watches a match without reading code. Rate limit and spend cap verified. |

The task-level breakdown is in `plan/roadmap.md` (row 30): 28 milestones,
`v0.1` to `v4.5`, one file per phase, progress notes under `plan/progress/`.

## 9. Cost and time (verify at P0 and P3)

Doer cost assumes clef-flash at about $0.000023 per ~600-token call (v2
estimate). Thinker cost uses Anthropic list prices as of 2026-10-06
(input / output per million tokens: Opus 5.5 $4 / $20, Sonnet 5.5
$2 / $10, Haiku 5.5 $0.10 / $0.50) at 1,500 in / 300 out per call. Rate
limit: v2 cited a documented 300 rpm for Workers AI text generation; P0
measures the real figure for clef-flash. Only doer calls hit that limit;
thinker calls go to the user's provider.

Per 5-minute match (6,000 ticks), doer every 10 ticks:

| Run | Doer calls | Doer cost | Doer time at 300 rpm | Thinker calls | Thinker cost (Opus / Sonnet / Haiku) |
|-----|-----------|-----------|----------------------|---------------|---------------------------------------|
| Default: 8 slots, 1 prompted, 7 bots | 600 | ~$0.01 | 2 min | ~60 | $0.75 / $0.38 / $0.02 |
| 8 slots, all prompted | 4,800 | ~$0.11 | 16 min | ~500 | $6 / $3 / $0.15 |
| 16 slots, all prompted | 9,600 | ~$0.22 | 32 min | ~1,000 | $12 / $6 / $0.30 |
| 16 slots, all prompted, doer every tick | 96,000 | ~$2.20 | 5.3 h | ~1,000 | same |

Wall-clock is the larger of the doer time above and 5 minutes (the tick
floor, row 31). So at 300 rpm the default run takes about 5 minutes and
the 15-minute anti-goal allows about 2 prompted slots at cadence 10, or
16 at cadence 64. If P0 measures a higher limit, the table shrinks
accordingly; if the limit is real, match size for the public demo is
capped by it and row 21 is revisited at P3. Prompt caching on the harness
prompt lowers thinker input cost. Workers AI's free 10,000 neurons per
day cover a handful of default runs; expect the paid plan for a public
URL.

## 10. Risks

- **Doer quality.** A decision model with a 600-token state may play
  badly. Tune instructions and state wording early; bots are the floor;
  switch to `clef` by constant if needed.
- **Prompts that do not matter.** The anti-goal. P3's exit requires two
  prompts to play visibly differently; if they do not, the thinker's plan
  must reach the doer more strongly (richer `plan` field, more frequent
  thinker calls) before anything else is built.
- **Rate limit.** Caps doer cadence. Accepted: raise `DOER_INTERVAL_TICKS`.
- **Escalation storms.** Min gap and one-in-flight, from P3.
- **Stalls.** No zone. Small map and the time limit cover the PoC.
- **Wall-clock.** A default match should finish in under 15 minutes. If
  not, lower the prompted-slot default before touching cadence; §9 has
  the arithmetic.
- **Clef unavailable or wrong shape.** Row 34. P0 answers it first so P1
  and P2 proceed either way.
- **Abuse.** Row 28 and §5.7.
- **Tab lifetime.** Closing the tab kills the match. Accepted for the PoC.
- **Keys.** localStorage only, sent only to the provider. Say so on the
  page.

## 11. Post-PoC pointers

In order, and only if the demo earns it. Each has a ready reference.

1. **Zone.** Lift `ZonePhase` and the center-selection rule from RaidRank
   `simulation/game-data.md` §9.1. Adds two events and a `zone` field in
   `Tick`.
2. **Share links.** Replay JSON on R2 behind the Worker.
3. **Server-side runner.** One Durable Object per match, streaming the
   same log; live view is the replay viewer reading a growing log.
4. **Ladder.** D1, a fixed thinker model paid by the house, per-match
   thinker-call budget per agent for fairness (RaidRank's planner tokens,
   `game-data.md` §18), placement rating (RaidRank `progression/`).
5. **Pre-match thinker call.** Spawn-zone choice as the first thinker
   decision (RaidRank `game-data.md` §8.4).
6. **Loot and items.** Last; RaidRank `game-data.md` §8.6 and the BR
   mechanics reference.

## 12. Open items

- `FLAG` thinker model `[Q2]`.
- `[Q1]` artifact shape, `[Q3]` Worker guard, `[Q4]` Clef fallback,
  `[Q5]` default slots, `[Q6]` tick floor; see chat.
- `ASSUMED` §6 numbers (map size, cone, ranges, duration, thresholds) are
  placeholders to tune in P1 and P3.
