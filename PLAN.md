# abarena — plan

What is built and what is next. A step is done when its checks pass;
`pnpm test` and `pnpm build` pass at every commit. The design is in
[DESIGN.md](DESIGN.md).

## Now

### 1. One package
`platform/`, `kits/`, `arenas/`, the workspace and ESLint go. What is
kept (the sim, perception, the two bots, the two maps, the match loop)
lives in `src/core` and `src/arenas/battle-royale` with the shapes and
rules of DESIGN.md. Nothing of the old page, the Anthropic adapter or
the Worker is carried over; git has them. Until the page exists,
`pnpm build` is the typecheck.
- [x] The two reference bot matches play out tick for tick as before the move; then the hash of the new log is pinned in a test.
- [x] A scripted match (a planner, a replan, a failed call, a late actor, a first call that fails, a Stop) logs what DESIGN's Match section says, and the same on a second run.
- [x] Under fake timers a real-time match keeps the clock, lands a slow answer late, and stops within a tick.
- [x] `pnpm match` runs a bot match and prints its ranking; `pnpm match log.json` also writes the log.

### 2. Models
The decision and chat adapters and the model list.
- [ ] Each adapter passes its tests against a fake `fetch`: the request it sends, a good reply, a refused answer, a reply that is not JSON, an error status.

### 3. The page
Agents, Run, the replay, the timeline, the panel and the result, as
DESIGN.md describes them.
- [ ] Node tests of the page's view functions: from a log cut at any tick, the frame, the panel of a fighter, the timeline bars, a row's result.
- [ ] By hand in a browser: the page opens on a bot match, playing; select a fighter, pause, scrub, read the panel.
- [ ] A scripted planner that answers after 3 s: the match keeps real time, is drawn while it runs, the plan lands as a bar, Stop ends it, the log downloads and opens again.
- [ ] A model that refuses the key ends the match, and the page says why.

## Next (needs an OpenRouter key or a local Ollama)

### 4. First real match
- [ ] A decision-model actor with a chat-model planner plays from the page.
- [ ] Measured from the page, per model: time per call (median, p95), failed calls, tokens and cost.
- [ ] The default match, two fighters with a planner and two without among four bots, over five seeds: mean place and cost per fighter, written into the README whichever way they fall.
- [ ] The model list holds only ids that answered.
- [ ] The log of one such match ships with the page as its opening replay.

### 5. Online
- [ ] The static page is deployed.

## Open

- No model has been called for real yet: no key is set up where this is built. The model ids are listed, never called.
- OpenRouter's decision endpoint is alpha; its reply is known from documentation only.
- A hosted page reaches Ollama only when the player sets `OLLAMA_ORIGINS` and allows local network access.
- A left or right turn held for one decision is 90°, and a late answer keeps an agent turning; tune when real models play.
- A real-time match plays to its end in real time, even after every model-driven fighter is dead.
