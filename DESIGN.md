# Decision Arena — Design

Status: v4.0, 2026-10-22, answers folded in, pending Nami's approval. Scope: tech demo / proof of concept, restructured as a platform.

v4.0 renames kbattle to Decision Arena and turns the one game into the
first of several arenas. It keeps the PoC question, the fault model, the
determinism contract and almost all of the code built under v3.0; it
changes who owns what. v3.0 is in git history (`git show bae7c0f:DESIGN.md`).
`ASSUMED` marks my calls where no answer was given, `[Qn]` points at a
question still owed by Nami.

## 1. Intent

Players author agents that play games against scripted bots, run by
language models of different speeds, and watch the replay to see what
each agent perceived, what it planned and what it chose. Humans do not
play; they write, run, watch, edit, run again.

Why the restructure: the shooter was baked into the core, the two models
had two different code paths, and the name said "battle". The platform
is the product; the shooter is its first arena, racing a cheap second one
because its action space is three choices.

### Goals

- A stranger with an API key picks an arena, writes an agent, runs a
  match and watches it without reading code.
- Adding an arena touches nothing in the platform: one package, one
  contract.
- Every model, from Cloudflare's decision model to a dummy written in
  TypeScript, is used through one interface, so demos and tests run
  without keys on the same path as real agents.
- The PoC question survives the move: prompts and model choices produce
  visibly different play, better than the bots, at a measured cost.

### Non-goals for v4.0

Cadence and budget redesign (deferred, see §12), duo and squad modes and
agent-to-agent talk, the extraction and racing arenas themselves (only
the contracts must leave room for them), ladder, accounts, server-side
runner, self-hosting, zone, loot, items.

### Anti-goals (failure even if it works)

- The platform abstraction makes the shooter slower, harder to test or
  less deterministic than it is today.
- A contract leaks one arena's assumptions (2D positions, bullets,
  facing) into the platform.
- Two shooter arenas duplicate the sim instead of sharing it.
- Players cannot tell what a role does or which model answers it.
- The replay stops showing why an agent did something.

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Decision Arena** | The product. |
| **arena** | One game with its own rules and ending: battle royale, extraction, racing. An arena has modes and maps. |
| **mode** | The team shape inside an arena. `solo` only, for now. |
| **map** | A hand-authored world for an arena (the shooter's `arena-1` becomes `map-1`). |
| **agent** | What a player authors for one arena and what stands in the match: its models in their roles plus its prompts and instructions. `a0`…`a15` in a match are agents. In a future duo mode a player fields several agents that can talk. |
| **model** | Anything that answers structured questions: a Cloudflare model, an Anthropic model, or a dummy, which is TypeScript code (always "go", random, a scripted bot). Models differ in speed, cost and what question types they can answer, not in kind. |
| **role** | A model's place in an agent. `ASSUMED` two roles: the **actor**, sync, asked the arena's action questions every interval; the **planner**, async, rewriting the agent's plan and scratchpad. |
| **bot** | An agent whose roles are dummies with scripted behaviour. The quality floor. |
| **match** | One run of agents in an arena, mode and map with a seed: config, log, replay. |
| **log** | The one artifact of a match: arena events plus every model call. |

## 3. Decision log

Rows 1 to 34 are v3.0's; the ones that still hold are carried, the
others superseded as noted. Rows 35 onward are v4.0.

| # | Topic | Decision |
|---|-------|----------|
| 1–8 | Scope, who pays, replay, sandbox, world, size, mechanics, combat | Carried for the battle royale arena; "who pays" now reads: Workers AI models through Nami's Worker, external providers on the player's key through the gateway (row 49). |
| 9–10 | Perception, tick | Carried for the shooter kit; perception covers the last decision interval (v3 ruling R15). |
| 11–14 | Doer, thinker, user surface, escalation | Superseded by rows 36–40. |
| 15–17 | Comms, refusals, stack | Carried. |
| 18 | Models | Superseded by row 38: a catalog, chosen per role by the player. |
| 19–22 | Where it runs, match end, rate limits, self-hosting | Carried; match end and ranking belong to each arena. |
| 23 | Slots | Carried: a match is a list of slots, each the player's agent, a doer-only agent or a bot; defaults 8 slots, 1 player agent, 7 bots. |
| 24–26 | Conventions, probability thresholds, actor cadence | Carried (`DOER_INTERVAL_TICKS` becomes `ACTOR_INTERVAL_TICKS`). |
| 27 | Mind panel | Carried as the **agent panel**: every role's calls, not two fixed kinds. |
| 28–29 | Worker guard, key failure | Carried. |
| 30 | Artifact | Carried: this file plus one short design per arena; `plan/` re-planned after v4.0 is approved. |
| 31–33 | Sim clock, doer-only slot, bot cadence | Carried: the actor is lockstep, the planner is asynchronous; a doer-only agent is an agent with no planner. |
| 34 | Clef fallback | Carried for the Cloudflare adapter. |
| 35 | Name | Decision Arena. Package scope `@decision-arena`. Nami renames the git repo and directory when the plan starts; nothing in the code depends on the directory name. Work continues on `main` directly (the `poc` branch was fast-forwarded into it). |
| 36 | Arenas | Battle royale and extraction are two arenas sharing a shooter kit (physics, perception, bots, maps format). Racing is an arena that shares only the platform. Modes are team shapes; `solo` now. |
| 37 | One model interface | Every model answers structured questions through one contract (§5.3). The Cloudflare decision model is one adapter of it, Anthropic another, dummies a third. No special "decision model" path. |
| 38 | Models are chosen | The player picks a model per role from a catalog (§5.3) limited to models reachable through Cloudflare AI Gateway: Workers AI models (paid by Nami through the Worker) and external providers (paid by the player's key, passed through the gateway). Launch list in §5.3. Retires v3 row 13's "not model choice". |
| 39 | Roles | An agent has one sync **actor** role and an optional async **planner** role (names confirmed). Sync means the tick waits for the answer up to the model's timeout; async means the answer lands at the first tick after it arrives and writes to memory. A role's model must support the question types that role is asked; dummies support everything. |
| 40 | Cadence and timeouts | No budget mechanics for now. Actor every `ACTOR_INTERVAL_TICKS = 10`; the planner is asynchronous, never holds a tick, and runs less often than in v3: on escalate after `PLANNER_MIN_GAP_TICKS` (`ASSUMED` 100, 5 s) and forced after `PLANNER_MAX_GAP_TICKS` (`ASSUMED` 400, 20 s). Every model has a `timeoutMs` in the catalog; a sync call past its timeout is a fault that keeps the last answer. Any model may be an actor: the editor shows the projected wall-clock of a match from the catalog's latency figures and warns when it exceeds 15 minutes. §12 records the token-budget direction discussed and deferred. |
| 41 | Agents are per arena | An agent belongs to one arena; the prompts, instructions and action questions are the arena's. |
| 42 | Arena contract | An arena is a package implementing §5.2. The platform knows no arena by name; a registry lists them. |
| 43 | Log envelope | `MatchLog` version 2: `{ version, arena, mode, config, agents, events }`. Platform events are `Call` and `MatchEnd`; `Tick` carries an arena-defined payload; every other event kind is the arena's. §5.5. |
| 44 | First slice | The battle royale arena running through the new contracts with dummy agents and the replay, logs identical to today's apart from the envelope, before any real model is wired. The parity gate is a test, not a manual check. |
| 45 | Timing | Now, before the remaining brains work, so the real models are wired once against the contracts. |
| 46 | Second and third readers | `arenas/racing/DESIGN.md` and `arenas/extraction/DESIGN.md` are one-page sketches written as my calls, so every contract is checked against three arenas before R0 ends. Their needs are in §5.2: per-arena tick length and actor interval, a match outcome that is a ranking plus optional per-agent results, and `active(state)` for agents that leave the world alive. |
| 47 | Old logs | Version-2 logs replace version 1 with no migration; uploading a version-1 file gets a clear "old format" message; the sample log and goldens are regenerated. |
| 48 | Planner input | The planner gets the arena's static text (the map) as well as the observation; the planner input budget rises from 1,500 to 2,000 tokens (ISSUES I-022). |
| 49 | Keys and the gateway | `ASSUMED` External-provider calls go from the browser to Nami's AI Gateway with the player's provider key passed through in the `Authorization` header; the gateway stores no keys, keeps no request bodies, and is unauthenticated (a stranger using it spends their own key, not Nami's). Workers AI models go through the Worker binding with the gateway option, paid by Nami and guarded as before. The anti-goal "a key leaves the browser for anything but the provider" is restated: a key goes only to the gateway and the provider, and is never stored. If the gateway cannot be called from a browser (CORS), the Worker proxies the call with the key passed through, never logged. Decided by a 30-minute spike at the start of R2. |

## 4. Principles

v3.0's eight hold; they read the same with the new words. Two are added.

1. The model proposes, the sim decides.
2. Fixed, typed action space; players author words, never actions or code.
3. Perception is a rule: an agent knows only what the arena's `perceive` gives it.
4. Every call is logged, with input, output, outcome and usage.
5. Fallback is "keep doing that".
6. Memory is the scratchpad: plan text and scratchpad, rewritten by the planner.
7. The match is one file.
8. Nothing to operate.
9. **An arena is a plugin.** The platform ships without a game; it cannot name one.
10. **A model is a model.** Speed, cost and supported question types are data, not code paths.

## 5. Architecture

### 5.1 Packages

```
platform/core      contracts (Arena, Model, Agent), match loop, memory, log envelope, RNG, replaying model
platform/models    adapters: cloudflare (through the Worker), anthropic, dummy; the catalog; fault mapping
platform/web       page shell (keys, arena picker, agent editor, match config, run, replay shell, agent panel, files)
platform/worker    Cloudflare Worker: static assets, POST /ask → Workers AI, guard
kits/shooter       the 2D shooter engine: vec2, angles, physics step, bullets, collision, perception, bots, map format, Pixi renderer parts
arenas/battle-royale   the shooter arena that exists today: rules, ending, ranking, maps, defaults, events, renderer
arenas/extraction      later; shooter kit + extraction rules
arenas/racing          later; its own kit or none
```

`ASSUMED` pnpm workspace globs `platform/*`, `kits/*`, `arenas/*`;
package names `@decision-arena/core`, `@decision-arena/models`,
`@decision-arena/web`, `@decision-arena/worker`,
`@decision-arena/kit-shooter`, `@decision-arena/arena-battle-royale`.
Libraries stay consumed as TypeScript source (v3 ruling).

Dependency rule: `platform/*` never imports from `kits/*` or `arenas/*`
except `platform/web`, which imports the arena registry to render; the
registry is the one file that names arenas.

### 5.2 Arena contract (`platform/core`)

```ts
interface Arena<Config, State, Obs, Answers, Ev> {
  id: string;                       // "battle-royale"
  title: string;
  modes: readonly string[];         // ["solo"]
  config: ZodType<Config>;          // mapId, seed, durationTicks, slots, mode, arena-specific fields
  maps: readonly string[];          // ids; getMap(id) returns the arena's map
  tickMs?: number;                  // defaults to the platform's 50 ms
  actorIntervalTicks?: number;      // defaults to the platform's 10
  questions(obs: Obs, memory: Memory): Questions;   // the actor's typed questions for this observation (§5.3)
  spawn(config: Config, rng: RngState): State;
  perceive(state: State, agent: AgentId): Obs;      // pure
  actionFrom(answers: Answers, obs: Obs, previous: Action): Action; // answers → the sim's action, thresholds inside
  step(state: State, actions: Record<AgentId, Action>): { state: State; events: Ev[] };
  tick(state: State): unknown;      // the Tick payload the renderer reads (positions, hp, …)
  active(state: State): AgentId[];  // agents still to be asked: alive and still in the world (extraction removes extracted agents)
  ended(state: State): { ranking: AgentId[]; results?: Record<AgentId, unknown> } | null;  // results: per-agent outcome, arena-defined
  staticText(config: Config): string;   // what every agent knows before the match: the map, the rules in a few lines
  events: ZodType<Ev>;              // discriminated union of the arena's event kinds
  bots: Record<string, (seed: number, slot: number) => Model>;   // dummies
  defaults: AgentDefaults;          // planner prompt, actor instructions per question, fixed plan for planner-less agents
  observationText(obs: Obs): string;   // for the planner's message
  renderer: ArenaRenderer;          // §5.6
}
```

The platform loop (today's `runMatch`, generalized) owns: slots and
agents, the interval constants, asking the actor and planner, memory,
timeouts and aborts, validation and rounding of answers, the log, the
replaying model, `MatchEnd` and cancellation. The arena owns everything
in the table above. The loop never reads an arena's state.

The shooter's current `WorldState`, `step`, `perceive`, bots, maps and
collision code move to `kits/shooter` unchanged; `arenas/battle-royale`
wraps them into the contract and keeps the ranking rule (survival, kills,
HP) and the ending (last alive or duration).

### 5.3 Model contract, adapters and catalog (`platform/core`, `platform/models`)

```ts
type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }   // 2..255 options
  | { type: "noul";   instructions: string; criteria?: { true?: string; false?: string } }  // P(yes)
  | { type: "text";   instructions: string; maxChars: number };

type Answer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "noul";   noul: number }
  | { type: "text";   text: string };

interface Model {
  id: string;                                   // "cloudflare/clef-flash", "dummy/random", "bot/wanderer"
  supports: ReadonlySet<Question["type"]>;      // a decision model has no "text"
  ask(req: { system?: string; state: unknown; questions: Record<string, Question>; signal: AbortSignal }): Promise<Reply>;
}
type Reply = { ok: true; answers: Record<string, Answer>; usage: Usage; model: string }
           | { ok: false; error: ModelError };   // kind: timeout | network | server | rate_limit | invalid_output | refusal | auth | billing | not_found; fatal: boolean
```

Model ids are AI Gateway ids, `provider/model`, so the catalog is a list
of what the gateway can reach. Four adapters:

- **workers-ai** (`workers-ai/@cf/...`): decision models and other Workers
  AI models, called through `POST /ask` on Nami's Worker, which runs
  `env.AI.run(model, input, { gateway: { id } })`. For Clef-class models
  the question set is sent as it is (the Clef wire shape is this
  contract); `text` questions are rejected. Nami pays; the guard applies.
- **gateway-chat** (`anthropic/...`, `openai/...`, `google-ai-studio/...`,
  `groq/...`, `mistral/...` and any other chat provider the gateway
  lists): one OpenAI-compatible chat completion through the gateway with
  the player's provider key passed through, asking for structured output
  with one JSON-schema property per question (an enum for `choice`, a
  number 0–1 for `noul`, a string for `text`), `probabilities` filled
  with 1 for the chosen option, faults mapped as today (timeout,
  network, server, rate limit, invalid output, refusal, auth, billing,
  not found). Providers whose structured output does not come through
  the compat layer are marked `text-only` in the catalog and cannot be
  actors. Replaces the Anthropic SDK adapter of v0.6/v3.2, whose fault
  tests carry over.
- **dummy** (`dummy/first`, `dummy/random`, `bot/<name>`): a TypeScript
  function `(state, questions) => answers`; every bot is a dummy. Usage
  is estimated at four characters per token so a dummy's calls are
  logged like any other.
- **replaying**: answers from a recorded log (determinism).

Catalog (`platform/models/catalog.ts`): id, provider, adapter, key
needed, supported question types, `timeoutMs`, typical latency, list
prices. `ASSUMED` launch list: `workers-ai/@cf/cloudflare/clef-flash`
(actor default), `workers-ai/@cf/cloudflare/clef`,
`anthropic/claude-haiku-5-5` (planner default), `anthropic/claude-sonnet-5-5`,
`dummy/first`, `dummy/random`, `bot/wanderer`, `bot/camper`. Other gateway
providers are catalog data, added when a key and a structured-output
check exist. Row 34's fallback (OpenAI Decisions) is one more adapter.

`ASSUMED` The planner is asked one `text` question for the plan and one
for the scratchpad, with the same `Plan` limits as today; its input is
the arena's `staticText` (the map), the observation text, the digest
and memory, under 2,000 tokens. The actor is asked the arena's questions
plus the platform's fixed `escalate` noul. A model that does not support
`text` cannot be a planner; the editor greys it out. A sync call is
raced against the model's `timeoutMs`; the planner's call has its own
timeout and never holds a tick.

### 5.4 Agent spec

```ts
AgentSpec = {
  arena: string;
  roles: { actor: { model: string }; planner?: { model: string } };
  prompts: { planner: string; actor: Record<QuestionId, string> };   // user-editable text only
}
```

Validated with zod at the boundary (form, file, log). A bot slot is
`{ kind: "bot", bot: "wanderer" }` and expands to an agent whose actor
is the bot dummy and whose planner is absent. A doer-only slot (v3 row
32) is an agent with the default actor instructions, the fixed default
plan and no planner.

Keys: one per provider that needs one (Anthropic today), stored in
localStorage, sent only to that provider. Cloudflare models go through
Nami's Worker (v3 row 2). The editor hides models whose key is missing.

### 5.5 Log envelope

```ts
MatchLog = { version: 2, arena, mode, config, agents: AgentSpec[] /* by slot */, events: Event[] }
Event =
  | Call     { tick, requestedTick, agent, role: "actor" | "planner", model, ok, questions?, answers?, error?, usage?, input? }
  | Tick     { tick, data: unknown /* arena-defined, validated by the arena */ }
  | MatchEnd { tick, ranking }
  | <arena event kinds, validated by arena.events>
```

`Call` replaces `Doer` and `Thinker`; `requestedTick` equals `tick` for
sync calls. `Tick.data` is what the renderer and the agent panel read
(for the shooter: today's rows plus `near`). Rounding, bounds on ticks,
cancellation, the event order inside a tick, and byte-identical replay
carry over from v3.

### 5.6 Replay shell and renderer contract (`platform/web`)

The shell owns playback (clock, scrub, speeds, keyboard), the timeline
with call and fault markers, the agent panel (perception text from
`arena.perceive` on a state the arena rebuilds from `Tick.data`, plan,
last answers with probabilities for every role, faults), files, and the
follow selector. The arena supplies:

```ts
interface ArenaRenderer {
  mount(stage: PixiStage, log: MatchLog): { render(tick): void; destroy(): void; followTargets(): AgentId[]; center(agent): Vec2 | null };
  stateAt(log, tick): unknown;          // for arena.perceive and overlays
  overlays?: Record<string, Overlay>;   // "vision cone", "trails"
}
```

Today's `web/src/replay/*` splits accordingly: coords, stage, clock,
controls, files, errors, mind panel and markers stay in the shell;
map, agents, bullets, camera centering, overlay and `stateFromTick`
move to the shooter kit's renderer.

### 5.7 Page

One page: a key section per provider; an arena picker; the agent editor
for that arena (role → model dropdowns from the catalog, the planner
prompt, one instruction per actor question); match config (mode, map,
seed, slots as today, duration); run with counters per role; the replay
below with download, upload and "edit this agent". Agents and configs
are stored per arena under `decision-arena:v1:*`.

### 5.8 Worker

Unchanged in role. `POST /decide` becomes `POST /ask` with the same
validation, mock and Clef backends, CORS, size and content-type guards,
and the per-IP rate limit when it lands. The request names the model by
catalog id; the Worker maps it to the Workers AI model name and refuses
ids outside the catalog.

## 6. Migration map

| Today (`kbattle`) | v4.0 | Change |
|-------------------|------|--------|
| `core/src/{vec2,angles,units,constants}.ts` | `kits/shooter` (vec2, angles, units, shooter constants) and `platform/core` (interval, timeout, thresholds) | split |
| `core/src/sim/{world,step,collision,weapons,perceive,actions,rng}.ts` | `kits/shooter/sim/*`; `rng.ts` to `platform/core` | move; `actionFromAnswers` becomes `arena.actionFrom` |
| `core/src/sim/{match,log,providers,replay-provider}.ts` | `platform/core/match/*`, generalized over the Arena and Model contracts | rewrite of the glue, same behaviour and tests |
| `core/src/bots/*`, `core/maps/*`, `core/src/maps.ts` | `kits/shooter/bots/*` as dummies; maps renamed `map-1`, `map-2` | move, rename |
| `core/src/schemas.ts` | platform schemas (`Question`, `Answer`, `AgentSpec`, `MatchLog` v2, `Call`) in `platform/core`; shooter state, questions and events in `arenas/battle-royale` | split |
| `brain/src/providers/anthropic.ts`, `thinker-client.ts`, `event-digest.ts`, `thinker-prompt.ts` | `platform/models/gateway-chat.ts` (replaces the SDK adapter; fault tests carried); the planner message builder and digest in `platform/core/planner/*`, taking `arena.staticText` and `arena.observationText` | rewrite the adapter, move the rest |
| `worker/*` | `platform/worker`, route `/ask` | rename |
| `web/src/replay/*`, `web/src/ui/*` | `platform/web` shell + `kits/shooter/render/*` | split |
| `core/fixtures/sample-log.json`, goldens | regenerated as version 2 logs; goldens unchanged in content | regenerate |
| `DESIGN.md`, `plan/`, `ISSUES.md` | this file; `arenas/battle-royale/DESIGN.md` for the shooter specifics (sections 6 of v3.0); `plan/` re-planned; ISSUES carried | rewrite |

Parity gate for the move, as a test: the 873 tests pass in their new
homes, the 16-bot log of `run-match` equals today's apart from the
envelope fields (a test compares the arena events and `Tick.data` of
both), and the replay smoke passes against it.

## 7. Phases of the revamp

| Phase | Deliverable | Exit |
|-------|-------------|------|
| R0 Contracts and moves | New workspace layout, contracts in `platform/core`, shooter code moved into the kit and the battle royale arena, registry | Everything builds; the parity gate holds with dummies and bots. |
| R1 Shell and renderer split | Replay shell generic, shooter renderer behind `ArenaRenderer`, agent panel reads `Call` events | Smoke passes on a version-2 log; follow, overlay, panel as today. |
| R2 Models | Model contract, catalog with timeouts, the workers-ai and gateway-chat adapters (after the CORS spike, row 49), planner glue with the static text, agent editor with role → model choice and the wall-clock projection | A dummy planner and a dummy actor run a match from the page; the real adapters pass today's fault tests; a Haiku planner answers a structured call through the gateway from the browser. |
| R3 PoC | The remaining P3/P4 goals of v3.0 (default agents, cost measurement, anti-goal check, guard, deploy) against the new structure | v3.0 §8 P3 and P4 exits. |

The task-level plan is written after this document is approved.

## 8. Cost and time

Unchanged from v3.0 §9 for the battle royale arena; the catalog carries
list prices so the cost report is computed, not typed.

## 9. Risks

- **Abstraction tax.** The arena contract could slow the hot loop or
  make tests indirect. Mitigation: the loop calls the arena through plain
  functions, no events or callbacks per tick; the parity gate measures
  wall time.
- **Leaky contract.** A shooter notion sneaking into `platform/core`.
  Mitigation: the racing arena's shape is sketched in its design before
  R0 ends, as a second reader of every contract.
- **Model choice confuses players.** Mitigation: defaults preselected,
  dummies labelled, unsupported combinations greyed out.
- **Two shooter arenas drift apart.** Mitigation: extraction is a rule
  set over the kit, and the kit has its own tests.
- v3.0 §10's risks carry: doer quality, prompts that do not matter, rate
  limits, stalls, wall-clock, abuse, tab lifetime, keys.

## 10. Left to the builder

- Exact zod shapes for the contracts and the version-2 envelope; the
  registry's shape; how `Tick.data` is typed per arena.
- Directory details inside each package, test layout, scripts.
- The order of moves inside R0 and how to keep the suite green at every
  commit (git `mv` first, contract adoption second is the suggestion).
- The Pixi stage interface handed to renderers.
- Which of today's web tests become shell tests and which kit tests.

## 11. Open items

- Answered on 2026-10-22: timing (now), timeouts and planner frequency (row 40), role names (actor, planner), racing and extraction sketches (row 46), first slice (row 44), catalog limited to the gateway (row 38), rename by Nami (row 35), old logs dropped (row 47), plan rewritten, work on `main`, planner map text (row 48), turn quantization and the review minors carried into R3 (ISSUES I-017, I-023), parity gate as a test.
- Still open: `[Q2]`–`[Q6]` from v3.0 where not superseded; the v0.5 and v0.6 live spikes still need credentials; browser-to-gateway CORS (row 49, spike in R2); which gateway providers pass structured output through the compat layer (checked per provider when added).

## 12. Deferred: cadence and budget

No budget mechanics for now (Nami, 2026-10-22). Discussed and deferred so
the core loop lands first. The
direction: replace interval, min gap and max gap with a token budget per
role and a bucket that refills at `budget ÷ duration` per tick; a role is
asked when it can afford roughly its last call, the planner also when
its bucket is full. Usage is provider-reported (Anthropic, Cloudflare and
OpenAI all return it), estimated for dummies, and only authoritative when
the house runs the match. Rewards concise prompts, derives cadence,
leaves "keep the last answer" as the fallback. Open: one pool per agent
or one budget per role; raw tokens or price-weighted credits.
