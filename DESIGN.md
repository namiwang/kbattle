# abarena — design

abarena is an auto battle arena. You build an agent out of models of
different sizes, give each one job, field it in an arena and watch the
match play itself. Nobody plays by hand: pick models, write one prompt,
run, watch, change one thing, run again.

The bet behind it: the next generation of systems is a composition of
models of different sizes, each doing the job it is best at. abarena
turns that into a game. A small fast model has the reflexes, a large
slow one has the ideas, and a match shows what the pairing is worth:
where it placed against the same actor alone, and what each model cost
in reaction time and money.

## Words

| Word | Meaning |
|------|---------|
| arena | A game: a world, rules, an ending. The first is a top-down battle royale. |
| agent | One fighter's build: a model per job, and one prompt. A match can field several of the same agent. |
| model | Anything that answers questions: a decision model, a chat model or a script. |
| actor | The agent's fast job: at a decision it answers the arena's questions. |
| planner | The agent's slow job, optional: every few seconds it rewrites the plan. |
| decision | One round of asking the actors; in the battle royale, twice a second. |
| observation | What the arena shows one agent at one decision. |
| plan | The text an actor reads beside its observation: the agent's prompt, until its planner writes a new one. |
| bot | An agent played by a script the arena ships (`bot/<name>`): no planner, no prompt, no key. |
| log | The one file a match leaves: every tick and every model call. The replay is drawn from it. |

## Rules

1. Models answer, the arena decides. An action is a pick among options
   the arena offers; players write words, never code.
2. One model interface. Size, price and vendor are data; speed is
   measured in the match.
3. An agent knows only what the arena shows it.
4. Every call is in the log: what the model was shown, what it
   answered, how long it took, what it cost.
5. Nothing waits for a model. A failed call changes nothing: the agent
   keeps doing what it was doing. A slow call lands late.
6. Nothing to operate: a static page with no third-party script. A key
   is kept in the browser, goes only to its own provider, and never
   enters a log.

## Layout

One package.

```
src/core/                   the Model, Arena and log types, the match loop, the seeded RNG
src/models/                 the decision and chat adapters, the model list
src/arenas/battle-royale/   sim, perception, bots, maps, and draw, which paints a tick on a canvas
src/web/                    the page
src/match.ts                pnpm match
test/                       sim, match, models, page
```

`core` imports nothing else and knows no arena. `models` and `arenas`
import `core`. `web` imports all three.

## Model

```ts
type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }  // option id → what picking it means
  | { type: "text"; instructions: string; maxChars: number };

interface Model {
  ask(req: { state: unknown; questions: Record<string, Question>; signal: AbortSignal }): Promise<Reply>;
}

type Reply = {
  answers: Record<string, string>;                         // the option id, or the text
  probabilities?: Record<string, Record<string, number>>;  // per choice question, when the model gives them
  usage?: { input_tokens: number; output_tokens: number; cost?: number };  // cost in dollars, when the provider says
};
```

`state`, `questions`, `instructions`, `criteria`, `answers` and `usage`
are the words of System One, the request that decision models share. A
question is everything a model is told: there is no system text. A
choice has 2 to 26 options with lower-case ids.

A model that cannot answer throws, with the provider's own words. The
loop checks every reply against what it asked: a pick that is not one
of the options is dropped, a text is cut to `maxChars`, and a reply
with nothing left is a failed call.

Two adapters cover every hosted and local model:

- `decision`: System One. `{ model, state, questions }` in, the state
  as JSON text; a pick and a probability per option out, in one forward
  pass. Decision models answer choices, not text.
- `chat`: an OpenAI-compatible chat completion asked for a JSON object
  with one property per question.

A provider is data: a decision URL, a chat URL and whether it needs a
key. A model id is `provider/name`, split at the first slash.
`src/models/index.ts` lists the models the page offers, each as
`decision` or `chat`, from two providers:

- `openrouter`: one key, both adapters, callable from a browser.
- `ollama`: both adapters on the player's own machine, no key.

Any listed model can be an actor; a planner is a chat model.

## Agent

```ts
type Agent = { actor: string; planner?: string; prompt?: string }  // model ids
```

One prompt per agent, in the player's words: how to fight. It is the
first plan, and the planner's standing orders. A prompt and a plan are
at most 600 characters: the actor reads one of them at every decision.

Two jobs, because an arena has two clocks, the tick and the fight.

## Arena

```ts
type Config = { seed: number; map: string };

interface Arena<State, Obs> {
  id: string;
  maps: string[];
  tickMs: number;                        // match time per tick
  actEvery: number;                      // ticks between decisions
  questions: Record<string, Question>;   // what every actor is asked at a decision
  defaultPrompt: string;                 // what a new agent starts with on the page
  bots: Record<string, (seed: number, index: number) => Model>;

  rules(config: Config): string;         // what a planner is told: the map, the rules
  spawn(config: Config, agents: string[]): State;
  perceive(state: State, agent: string): Obs;                               // pure
  step(state: State, answers: Record<string, Record<string, string>>): State;
  snapshot(state: State): unknown;       // what the replay draws a tick from
  active(state: State): string[];        // agents still asked
  ended(state: State): string[] | null;  // the ranking, best first
}
```

`step` gets the answers that landed on this tick. An agent without new
answers keeps doing what it was doing, and so does a question without a
new answer. The loop never reads an arena's state and never holds an
agent's action.

## Match

```ts
runMatch(arena, config, agents, options?: {
  models?: (id: string) => Model;     // every id that is not bot/<name>
  realTime?: boolean;                 // keep the clock: tick k is due k × tickMs after the start
  signal?: AbortSignal;               // Stop: the match ends after the tick in progress
  onEvent?: (event: Event) => void;   // each event as it is logged; a running match is drawn from these
}): Promise<MatchLog>
```

Agents are `a0`, `a1`, … in list order. The world after k steps is tick
k. Every `actEvery` ticks, from tick 0, is a decision. One call is out
per agent and job at a time. At a decision, for each active agent:

1. A plan that has arrived becomes its plan.
2. Its planner is asked when it has never been asked; when the actor's
   latest answer said yes to `replan` and 5 s have passed since the
   last request; and in any case after 20 s. Seconds are match time.
   The state is `{ rules, prompt, plan, history, observation }`, where
   `history` is what its actor saw and answered since the last request;
   the one question is `plan`, a text.
3. Its actor, if free, is asked the arena's questions with
   `{ plan, observation }` as state. An agent with a planner gets one
   more question from the match: `replan` (yes, no).

On every tick the actors' answers that have arrived land, and the arena
steps.

Without `realTime` there is no clock: every call is waited for, so an
actor's answers land on the tick they were asked and a plan lands at
the next decision. The same seed and the same scripts give the same
log, byte for byte. With `realTime` the match waits for the tick's time
and for nothing else: a slow model, actor or planner, costs what it
would cost in the world. It stops keeping time once only bots are left,
and a call with no answer after 30 s is given up.

A job's first call in a match must succeed: if it fails, the match ends
with that error. A match that an error or Stop cut short has no ranking
and says why. Calls still out at the end are logged as failed.
`runMatch` rejects only before tick 0.

## Log

```ts
type MatchLog = { version: 1; arena: string; config: Config; agents: Agent[]; events: Event[] }

type Event =
  | { kind: "Tick"; tick: number; snapshot: unknown }
  | { kind: "Call"; tick: number; agent: string; job: "actor" | "planner";
      askedTick?: number;       // when it was asked, if earlier than tick
      observation?: unknown;    // what the arena showed the actor
      answers?: Record<string, string>;
      probabilities?: Record<string, Record<string, number>>;
      usage?: { input_tokens: number; output_tokens: number; cost?: number };
      ms?: number;              // wall time of the call; real-time matches only
      error?: string }          // why it failed
  | { kind: "End"; tick: number; ranking: string[]; error?: string }
```

Events are in the order things happened. A call is logged at the tick
its answer took effect. The plan an actor read is the answer of its
planner's latest call at or before that tick, else the agent's prompt.
What a planner read is already in the log: its agent's actor calls
since its last request.

## Page

One screen: agents and Run on the left, the replay and the panel on the
right.

- Agents: four rows. A row is an agent and a count: its actor, its
  planner unless the actor is a bot, and how many of it to field, 2 to
  16 fighters in all. The selected row's prompt shows beneath. Each
  row lists its fighters; selecting one fills the panel. A key field
  shows for a provider in use.
- Match: map, seed, Run; Stop while it runs. An empty seed is drawn
  fresh for each run.
- Replay: the arena on a canvas, drawn from the log. One viewer plays a
  finished log and a growing one, up to its last tick; scrub back and
  return. Under it a timeline: the recorded part, a bar for each
  planner call of the selected fighter from asked to landed, a mark for
  each failed call. Space plays and pauses; left and right step one
  decision.
- Panel, for the selected fighter at the tick on screen: its plan and
  where it came from; what its actor read and what it picked, with the
  probability when the model gave one; a failed call in red. Wherever a
  model is named, its time and cost stand beside it.
- Result, in the rows: the places a row's fighters took and, per job,
  calls, failed calls, the median time per call, tokens and cost.
- Download saves the log; Open plays one.

A match with a model that is not a bot runs in real time. The first
visit fields bots only, and the page runs a match of bots by itself, so
it opens already playing.

## Battle royale

A 100 × 100 m map with polygon obstacles; up to 16 fighters spawn
around the edge with 100 HP and one gun. The last one alive wins; after
5 minutes the ranking is survival, then kills, then HP.

- A tick is 50 ms; a decision comes every 10 ticks, and an observation
  covers exactly those 10.
- Questions: `move` (forward, back, left, right, stop), `turn` (left,
  right, none, face_target: toward the nearest enemy it saw at this
  decision, followed until the next) and `fire` (yes, no).
- A fighter sees enemies in a cone ahead with line of sight, hears
  shots and footsteps through walls, and feels bullets that hit it or
  pass close.
- Bullets are simulated: travel time, spread and leading a target are real.
- Bots: `wanderer` roams and shoots what it sees; `camper` holds a
  corner and moves when hit.

## Not now

More jobs per agent, such as a coach that rewrites the prompt between
matches; prompts per job; teams and talk between agents; series of
matches with means; model lists and prices fetched from the providers;
a model the site pays for; sign-in in place of a pasted key; more
arenas; accounts and budgets.
