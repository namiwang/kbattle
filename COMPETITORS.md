# abarena — competitors

Similar products, projects and papers, read on 2026-11-27. GitHub stars,
licenses and last pushes are from the GitHub API; Steam player counts
are from Steam's API at one moment that day; "site says" marks a number
only the product itself reports. "Unverified" means nobody could confirm
it.

## Summary

Nothing found does what abarena does: a fighter the player builds from
several models, in a match that does not wait for them, with each
model's time and cost on screen, on a static page with the player's own
key. Every piece exists somewhere else:

- the genre and the cost-per-win result: OpenRouter's Royale experiment;
- a clock that punishes slow models: LLM Colosseum;
- a prompt plus a model choice plus your own key, as a product: BOTVBOT;
- a model per job inside one agent: Mindcraft;
- proof that a fast and a slow model together beat either alone in real
  time: two papers (HLA, AgileThinker), neither of which reports money.

The nearest threat is the first: OpenRouter has announced a public
benchmark on its battle royale.

## LLM arenas and bot battles

How they play:

| | Type | The player writes | Models per fighter | Clock | Cost shown |
|---|---|---|---|---|---|
| [Royale: Last Agent Standing](https://openrouter.ai/blog/insights/royale-last-agent-standing/) | experiment (OpenRouter) | nothing; watch replays | 1 | waits for all 11 models each tick | per model and per win, in the article |
| [LLM Colosseum](https://github.com/OpenGenerativeAI/llm-colosseum) | open-source project | a model; a prompt by editing code | 1 | real time | no |
| [Kaggle Game Arena](https://www.kaggle.com/game-arena) | hosted benchmark, livestreams (Google DeepMind) | nothing | 1 | turn-based | cost per game, Werewolf only |
| [SnakeBench](https://snakebench.com/) | open-source project, hosted site | nothing on the site | 1 | turn-based | total cost per model |
| [TextArena](https://github.com/TextArena/TextArena) | open-source framework, online ladder | agent code | whatever the code does | turn-based | unverified |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | open-source project | a profile: models and prompts | several, one per role | real-time world, no score | no |
| [BOTVBOT](https://botvbot.xyz) | product | a game plan in words, a model | 1 | turn-based; 10 s per move and a thinking budget per fight | a receipt per fight |
| [AgentKombat](https://agentkombat.com) | product, pre-launch | a strategy in words, a model | 1 | turn-based | not stated |
| [pvpAI](https://www.pvpai.fun) | product, beta | English rules, a loadout | 1, the house model | unverified: site says real time, repo says turn-based | unverified |
| [Prompt Battles](https://github.com/asynchronous-x/prompt-battles) | open-source project | a prompt, compiled once to code | 1, before the fight only | real time; no model in the fight | nothing to show |
| [CodeClash](https://codeclash.ai) | paper, benchmark | nothing; models write the code | 1 | rounds | no |
| [Gladiabots](https://store.steampowered.com/app/871930) | product | visual rules | none | real time; rules are instant | — |
| [Screeps](https://store.steampowered.com/app/464350) | product | JavaScript | none | ticks, with a CPU cap per tick | CPU per tick |

Where they stand:

| | Runs | Source | Price | Popularity | State |
|---|---|---|---|---|---|
| Royale | hosted replay viewer | closed; the repo holds personas only | free to watch | 15 stars; 30 games | one-off, June 2026; "RoyaleBench" announced, not found |
| LLM Colosseum | local emulator and ROM; a hosted demo | MIT | free | 1,489 stars | dead: last commit 2025-03-21 |
| Kaggle Game Arena | hosted | harness Apache-2.0 | free | 118 stars on the harness; viewers unverified | alive: poker and Werewolf added 2026-02, paper 2026-09 |
| SnakeBench | hosted; local with keys | public, no license file | free | 103 stars; 3,473 games, 875 models (site says) | alive: last commit 2026-11-20 |
| TextArena | local or hosted | MIT | free | 440 stars | slow: last push 2026-10-05 |
| Mindcraft | local, own keys | MIT | free | 6,058 stars | alive: last push 2026-10-27 |
| BOTVBOT | hosted; own OpenRouter key or OpenAI-style endpoint | not stated | free ladder; hosted models at cost plus 50%; bodies $8.99 | no counts published | alive: Season 0, fights free since 2026-10 |
| AgentKombat | hosted, own key; Solana devnet | "open-source engine", no repo linked | free credits; 5% of staked pots | 200 registered, 248 fights (site says) | opens 2026-12-07 |
| pvpAI | hosted | proprietary | free now; betting planned | unverified | slow: last push 2025-12-08 |
| Prompt Battles | static page, no key | public, no license | free | 0 stars | dead: one push, 2025-12-26 |
| CodeClash | local | MIT | free | 218 stars | slow: last commit 2026-07-16 |
| Gladiabots | Steam, mobile | closed | $14.99 | 862 Steam reviews; 4 playing | slow: its developer is promoting a next game |
| Screeps | Steam, browser | server ISC, client closed | $19.99; CPU unlock $149.99 | 1,950 Steam reviews; 3,361 stars; 46 playing on Steam | alive: Season 11 since 2026-09-01 |

### LLM arenas

**Royale: Last Agent Standing.** Eleven models, one each, in 30 games
of a top-down battle royale on a 400 × 400 m map with a shrinking zone,
drawn on a canvas. Grok 4.1 Fast won 13 games at $0.97 a win; Claude
Sonnet 4.6 won 5 at $26.78 a win; the run cost $482 by the article's
count. The
simulation "collects all 11 agents' actions at once, advances the world
a tick", so a slow model loses money and never a turn. The author, who
leads developer relations at OpenRouter, calls it "the prototype for a
public benchmark" that will "open up for submissions"; no date.
Take: cost per win is the number people repeat. Avoid meeting it on its
own ground: abarena's difference is the clock and the pairing.

**LLM Colosseum.** Two models fight in Street Fighter III through an
emulator, ranked by Elo. Its README: "It is a real time game, fast
decisions are key", and Claude 3 Sonnet ranked low for "large API
latencies". It needs a ROM and Docker, shows neither time nor cost, and
stopped in March 2025.
Take: the finding (small and fast beats large and slow) with none of
the reasons. Avoid any install step.

**Kaggle Game Arena.** Frontier models play chess, poker and Werewolf
head to head, with commentary on livestreams. The roster is closed and
the games wait for the models.
Take: a match needs to be watchable by someone who has no key.

**SnakeBench.** Two models steer snakes on a grid; the site has live
games, replays and a leaderboard with a cost column.
Take: a replay link per match, and cost beside every model.

**TextArena.** More than 100 text games behind one interface and an
online ladder for agents people write in code.
Take: nothing; it is for people who write code.

**Mindcraft.** LLM agents in live Minecraft. A profile names a
different model for chat, code, vision and embedding: the only project
found where one agent is several models. It is not a contest and
measures nothing.
Take: per-job models are familiar to its 6,000 stargazers. They have
nowhere to see what a pairing is worth.

Also seen: VideoGameBench (378 stars, dead since 2025-05; its "Lite"
mode pauses the game while the model thinks, the full mode does not),
Stratix Cup (16 models each write a soccer policy, then the code plays
on stream; season 1 ended 2026-06-26), AI Diplomacy (717 stars,
turn-based).

### Bot battles

**BOTVBOT.** Browser robot boxing. The player writes a game plan in
plain sentences and may point the fighter at any OpenRouter model or
OpenAI-style endpoint. Three rounds of up to 12 blind simultaneous
moves; ten seconds per move and a budget of model usage per fight; a
model that times out "freezes for that exchange", and the replay says
FROZE. Every fight is a public replay with a receipt of usage and cost.
Take: the closest product. It prices thinking by rule (a budget, a
timeout) where abarena prices it by physics (the world moves on). The
receipt per fight and the one-word label for a late answer are worth
copying. Avoid paid cosmetics and a house margin on model calls.

**AgentKombat.** A 3D arena of turn-based duels: a strategy in plain
English, the player's own key, SOL stakes with a 5% fee. Opens
2026-12-07.
**pvpAI.** English IF/THEN rules compiled into behaviour, one house
model, token betting planned; nothing new since 2025-12.
Take, for both: avoid tokens and betting. Every prompt-battle product
found with a token is pre-launch, stalled or unverifiable (AI Arena,
the older NFT fighter, is a third).

**Prompt Battles.** "Write a prompt. Get a tank AI. Fight." A 1.5B
model in the browser turns the prompt into a function that runs every
frame. A static page with no key, like abarena, and dead after one
push.
Take: compiling the prompt removes the model from the fight, and with
it everything a match could say about models. Avoid.

**CodeClash.** Models edit a codebase each round and the codebases
fight in six code arenas; 1,680 tournaments in the paper.
Take: nothing to play. It shows arenas are an accepted way to compare
models.

**Gladiabots, Screeps.** The two programming games that still matter
for the loop: author, watch, change one thing. Gladiabots does it with
visual rules, Screeps with JavaScript and a CPU cap per tick, the only
game here where thinking is a resource the player pays for.
Take: Screeps charges for compute by rule and sells more of it. In
abarena the charge is the provider's bill.

Also seen: Robocode Tank Royale (v1.4.0 on 2026-10-01), Battlesnake
(run by volunteers since 2026-01), Battlecode (2027 starts 2027-01-04),
DeadNet and OpenRace (a prompt and a key for board games), ARBO: Arena
Tactics (below).

## Auto-battlers

The same loop with a human drafting the build.

| | Opponents | Price | Playing on Steam | State |
|---|---|---|---|---|
| Teamfight Tactics | 8 players, live | free, cosmetics | not on Steam; 33M a month (Riot, 2019) | alive |
| The Bazaar | recorded builds, no timer | free with one hero; $29.99 unlocks | 5,118 | alive; third pricing model in 15 months |
| Mechabellum | live 1v1; recorded armies since 2.0 | $14.99; free edition | 1,167 | alive |
| Backpack Battles | recorded builds; fights of 10–20 s | $14.99 | 1,089 | alive, monthly patches |
| Super Auto Pets | recorded builds, no timer; a live mode | free, paid packs | 212 | slow |
| Dota Underlords | 8 players, live | free | 737 | abandoned: last post 2020-11 |

The three made by small studios all default to recorded opponents: no
queue, no timer, and they hold up with a few hundred to a few thousand
playing at a time. The two
that needed eight live players per lobby needed Riot or Valve.

ARBO: Arena Tactics (ReBlink) is the one commercial auto-battler found
whose units take orders in plain text through an LLM. Unreleased; last
news 2025-10. A case study about it says players struggled to get
units to do what the text said (read from a search snippet only).

## The same bet, not a game

| | Type | How models are combined | What it measured | State |
|---|---|---|---|---|
| [OpenRouter Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router) | product | a fast model picks one model per request | cost | alive; new version 2026-08 |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | paper, open source | a router picks strong or weak per request | cost: up to 85% less at 95% of GPT-4 quality | dead: last push 2024-08; 5,740 stars |
| [Not Diamond](https://notdiamond.ai) | product | a router picks per step | claims 20–40% saved; $0.05 per million tokens routed | alive |
| [Advisor tool](https://claude.com/blog/the-advisor-strategy) (Anthropic) | product, beta | a small executor consults a large advisor mid-task | vendor's numbers: Sonnet with an Opus advisor, +2.7 points at 11.9% less cost than Sonnet alone | alive since 2026-04 |
| [Aider architect mode](https://aider.chat/2024/09/26/architect.html) | open source | a large model plans, a small one edits | 85.0% against 79.7% for the planner alone | slow; 50,281 stars |
| [Minions](https://github.com/HazyResearch/minions) (Stanford) | paper, open source | a cloud model plans, a local one reads | 97.9% of the accuracy at 5.7× less cost | slow; 1,393 stars; continued as OpenJarvis |
| [HLA](https://arxiv.org/abs/2312.15224) (Tsinghua, AAMAS 2024) | paper | slow loop GPT-3.5, fast loop Llama2-13B, real-time Overcooked | action latency 1.07 s against 4.16 s slow-only and 2.30 s fast-only; about 50% higher scores | finished |
| [AgileThinker / RealtimeGym](https://arxiv.org/abs/2511.04898) (Stanford and others) | paper, open source | a reactive thread reads a planning thread's partial reasoning; the game does not wait | reactive / planning / both: Freeway 0.24 / 0.12 / 0.88, Snake 0.37 / 0.04 / 0.45, Overcooked 0.57 / 0.00 / 0.89 | slow; 44 stars |
| [The Latent Bridge](https://arxiv.org/abs/2606.24470) | paper, open source | a 9B model acts at 15 Hz, advised by a slow reasoner | a learned channel between the two beats a text one on 2 of 8 tasks; no slow-only baseline | 2026-06; 5 stars |
| [RealtimeBench](https://arxiv.org/abs/2610.20665) (Peking, Samsung) | paper | a slow model writes instructions for a fast one before play | live, the stronger model scores 1.51 and the faster 13.51; with instructions, 24.19 | 2026-10; no code |
| [Win Fast or Lose Slow](https://arxiv.org/abs/2505.19481) (NeurIPS 2025) | paper | one model, sized and quantized to a latency target | agents 20% faster "consistently outperform" in Street Fighter | dead: last commit 2025-06 |
| [System1-Arena](https://arxiv.org/abs/2610.21244) (UT Austin) | paper, leaderboard | none; ranks 30 models on decision requests, 10 of them decision models | accuracy, with latency and cost beside it | 2026-10 |

Pairing a large model with a small one is now a shipped feature of
coding tools and routers, measured in accuracy and cost. In real time
it is measured in the papers above, in score and latency, and in none
of them in money. None is a place a person can try a pairing: each is a
repo to run or a table to read.

## What this means for abarena

1. **Say the difference first.** A reader who has seen Royale or
   BOTVBOT should learn in the README's first lines what neither has:
   the match does not wait, and a fighter is more than one model.
2. **Step 4's table is the thing to publish.** The same actor with and
   without a planner, over five seeds, in mean place and cost. No paper
   or product found reports a pairing against its parts in money, and
   Royale showed that cost per win is what gets quoted.
3. **Watch RoyaleBench.** If it opens with submissions, "LLM battle
   royale" belongs to the provider abarena calls. Being first matters
   less than being visibly different on the two points above.
4. **Shorten the match.** A battle royale match lasts up to 5 minutes
   in real time, which is 600 actor calls and 15 to 60 planner calls
   per fighter. Backpack Battles resolves a fight in 10 to 20 seconds,
   and Royale forces an ending with a shrinking zone. A shorter match
   makes "change one thing, run again" cheaper in both time and money.
5. **Keep recorded opponents and nothing live.** No queue, ladder or
   account: the small auto-battlers that survive fight stored builds.
   A shared log is abarena's stored build.
6. **The panel is the product.** ARBO's reported trouble is players
   who cannot get a unit to follow their text. What the actor read,
   what it picked and how sure it was is the answer no competitor
   shows; BOTVBOT's FROZE label
   is the same idea for a late answer.
7. **Leave out** tokens and betting, a margin on model calls, paid
   cosmetics, and compiling prompts to code.
8. **At step 4**, System1-Arena's table is a second source for which
   decision models to list.
