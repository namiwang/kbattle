# kbattle — Project Plan

Status: v2.0, 2026-10-21. Scope: tech demo / proof of concept.
§2 is the decision log; everything below follows from it. `ASSUMED` marks my
calls where no answer was given; `FLAG` marks decisions still owed.

v2.0 folded the three follow-up rounds into the decision table and cut
over-design: four packages instead of seven, zod only at trust boundaries,
an eight-kind event log, no Web Worker, no per-match budgets, post-PoC
phases collapsed to a note.

## 1. Vision

LLM-driven agents play a simplified top-down battle royale. Humans do not
play; they author an agent's mind and watch the replay. The loop: write
prompts → run a match in the browser → watch the replay → iterate. Public
URL, no accounts, ladder later.

## 2. Decision log

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
| 18 | Models | Hard-coded constants, one per role, behind adapter interfaces so switching is a config change. Doer = `@cf/cloudflare/clef-flash`. `FLAG` thinker model; default one Anthropic model, chosen at P3. |
| 19 | Where it runs | The browser runs the match. Server side is one Worker now; R2, Durable Objects and D1 only post-PoC. |
| 20 | Match end | Last agent alive, or `MATCH_DURATION_TICKS` elapsed. `ASSUMED` ranking: survival, then kills, then HP. Zone is the first post-PoC mechanic. |
| 21 | Rate limits | Not a design driver. One interval constant plus backoff on 429. |
| 22 | Self-hosting | Never, not even as a fallback. |

## 3. Architecture

### 3.1 Packages

| Package | Role |
|---------|------|
| `core/` | Types, deterministic sim, perception, scripted bots, and the match loop (tick, collect actions, step, append to log). Pure TypeScript: no I/O, no model calls. Runs in Node and the browser. |
| `brain/` | Thinker and doer drivers plus the two provider adapters. The only package that makes network calls. |
| `web/` | Vite app: prompt editors, key entry (localStorage), match config, runs the match, PixiJS replay, download and upload of replay JSON. |
| `worker/` | One Cloudflare Worker: serves `web/` as static assets and exposes `POST /decide` → Workers AI `clef-flash`. |

Bots and the match loop live in `core/`, the renderer lives in `web/`. Split
further only when a package becomes hard to test.

### 3.2 Runtime

- The match runs on the browser main thread as an async loop. Model calls
  are awaited fetches, so the UI stays responsive. Move to a Web Worker only
  if the UI stutters.
- Sim time is decoupled from wall time: a tick advances when its doer
  answers are in, so a match runs as fast as the calls return.
- Replays are one JSON file. Sharing is downloading the file.
- Local dev: `wrangler dev` for the Worker, Vite for the app.
- Only `worker/` and the adapters in `brain/` touch Cloudflare APIs.

### 3.3 Types and validation

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
MatchLog = { version, config, seed, events[] }

Event =
  | Spawn    { tick, agent, pos, facing }
  | Tick     { tick, agents: [id, x, y, facing, hp][], bullets: [id, x, y][] }
  | Shot     { tick, agent, bullet }
  | Hit      { tick, bullet, target, damage }
  | Death    { tick, agent, killer }
  | Doer     { tick, agent, answers, ok, error? }
  | Thinker  { tick, agent, input, plan, ok, error? }
  | MatchEnd { tick, ranking }
```

`Tick` carries positions, so the renderer never runs the sim. A bullet that
hits an obstacle simply stops appearing in `Tick`. Escalation is an answer
inside `Doer`; failures are a flag on the call events. Doer state is not
logged (it would be ~200 MB per match); `core.perceive(state, agent)` is
pure, so an overlay can recompute it from `Tick`. Expect 3 to 5 MB per
16-agent match.

### 3.4 The two-model brain

```
                  eligible every tick                  on escalate / max gap
observation ───▶  DOER (decision model)  ──escalate?──▶  THINKER (LLM)
   │               state = perception + plan text          in: scratchpad, perception,
   │               questions: move, turn, fire,                events since last call
   │                          target, escalate              out: plan text, scratchpad
   │               out: one typed answer per question
   ▼
 action (persists until the next doer answer) ───▶ sim.step every 50 ms
```

Doer request in Clef's shape (questions keyed by id; `noul` is a
probability, `choice` takes a criteria map):

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

- The doer runs every `DOER_INTERVAL_TICKS` ticks, starting at 1. On a 429
  the runtime backs off and keeps the last answer; if that keeps happening,
  raise the constant.
- Answers persist until replaced. A late or failed call means "keep doing
  that".
- Escalation is honored when no thinker call is in flight for that agent and
  `THINKER_MIN_GAP_TICKS` have passed. `THINKER_MAX_GAP_TICKS` forces a call
  if the doer never escalates.
- Thinker failures keep the last plan and are logged.
- `target` choices are built per call from visible enemy ids.
- Doer instructions are per question, text only, length-capped. Users cannot
  add questions or change choices.
- Clef-flash has a 24,576-token context and truncates `state`, so the state
  is ordered most-important-first. Budget: under 600 tokens for the doer
  state, under 1,500 for the thinker input.

### 3.5 Adapters and constants

- `ThinkerProvider.complete(system, messages) → Plan`. One implementation.
- `DecisionProvider.decide(state, questions) → DoerAnswer`. One
  implementation: the Worker. Switch the constant to `@cf/cloudflare/clef`
  if flash plays badly. Jev (same shape as Clef) and OpenAI Decisions
  (`noul` → `predicate`) are later adapters.
- Tests use scripted bots from `core/` and a fake `DecisionProvider`.
- All constants in one file: `THINKER_MODEL`, `DOER_MODEL`,
  `MATCH_DURATION_TICKS`, `DOER_INTERVAL_TICKS`, `THINKER_MIN_GAP_TICKS`,
  `THINKER_MAX_GAP_TICKS`.

## 4. Game design

- **Arena.** Rectangular continuous 2D map with polygonal obstacles, fully
  known to every agent. Spawns spread around the edge. `ASSUMED` about
  100 by 100 m so contact happens within a minute without a zone.
- **Agent.** Position, facing, HP 100, one weapon with fixed stats (bullet
  speed, damage, fire interval, spread). Fixed move speed relative to
  facing, fixed turn rate.
- **Actions per tick.** Move direction, turn direction, fire. The sim clamps
  everything; the doer only picks discrete choices.
- **Bullets.** Spawned at the muzzle with facing plus seeded spread, travel
  per tick, removed on hitting an obstacle or an agent (damage). Travel time
  and leading a moving target are real.
- **Perception**, computed by the sim per agent per tick:
  - Vision: enemies inside a cone (`ASSUMED` 90°, 60 m) with clear LOS.
  - Hearing: shots within 80 m, footsteps within 15 m, as bearing plus a
    coarse distance band.
  - Incoming: bearing of bullets that hit or passed within 2 m this tick.
  - Self: position, facing, HP, kills, time remaining.
- **Match end.** Last agent alive, or `MATCH_DURATION_TICKS` (`ASSUMED`
  6,000 = 5 min sim time). Ranking: survival, kills, HP.
- **Determinism.** Seeded RNG for spread and spawn. Same seed and recorded
  answers reproduce the same log.
- **Out of scope.** Zone, loot, items, armor, meds, ammo, grenades, squads,
  comms, stances, vehicles.

## 5. Phases

| Phase | Deliverable | Exit |
|-------|-------------|------|
| P0 Design | `core/` types, the five boundary schemas, a hand-written sample log, Worker skeleton | Sample log validates; `clef-flash` answers a sample request through the Worker; the thinker answers a sample call from a browser origin. |
| P1 Sim | `core/` sim, perception, bots, match loop, tests | A 16-bot match runs faster than real time in Node; same seed gives an identical log; bullets, LOS, hearing and incoming-fire have tests. |
| P2 Replay | PixiJS replay in `web/` | Play, pause, scrub, follow an agent, bullet trails. Perception overlay if cheap. |
| P3 Brains | `brain/`, both adapters, match runs in the browser | A prompted agent beats bots in some matches; cost and wall-clock per match recorded here. |
| P4 Public | Prompt and instruction editors, key entry, config, run, watch, download and upload replays | A stranger with a key writes prompts and watches a match without reading code. |

Post-PoC, in order and only if the demo earns it: zone; replay share links
on R2; a server-side runner (Durable Object per match, since a match
outlives one request) with live streaming; a ladder on D1 with a fixed
thinker model; loot and items.

## 6. Cost (verify in P3)

Per 16-agent, 5-minute match:

| Item | Cost |
|------|------|
| Doer every tick, clef-flash, 96,000 calls at ~600 tokens | ~$2.20 |
| Doer every 10 ticks, clef-flash | ~$0.22 |
| Thinker, ~1,000 calls at ~1,500 in / 300 out | $2 to $6 on the user's key |

Workers AI's free 10,000 neurons per day covers about half a match at the
10-tick cadence, so expect the paid plan. The documented 300 rpm limit for
Text Generation is far below per-tick for 16 agents; the interval constant
absorbs that.

## 7. Risks

- **Rate limit.** Caps doer cadence. Accepted: raise `DOER_INTERVAL_TICKS`.
- **Doer quality.** A decision model with a 600-token state may play badly.
  Tune instructions and state wording early; bots are the quality floor.
- **Stalls.** No zone. Small map and the time limit cover the PoC.
- **Escalation storms.** Min gap and one-in-flight, from P3.
- **Tab lifetime.** Closing the tab kills the match. Accepted for the PoC.
- **Keys.** localStorage only, sent only to the provider. Say so on the page.

## 8. Open items

- `FLAG` thinker model for v1 (default: one Anthropic model).
- `ASSUMED` §4 numbers (map size, cone, ranges, duration) are placeholders
  to tune in P1.
