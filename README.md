# Decision Arena

Player-authored agents, run by language models of different speeds, play
games against scripted bots in the browser. Humans write the agents and
watch the replay. The first arena is a top-down battle royale; the code
is mid-way through the v4.0 restructure: the platform packages sit under
`platform/`, the shooter engine moved to `kits/shooter` in R0.3, and R0.4
builds the battle royale arena on it in `arenas/battle-royale`.

- Design: [DESIGN.md](DESIGN.md) (what and why; arenas in §13–§15)
- Plan: [PLAN.md](PLAN.md) (milestones with exit criteria and a log)
- Issues: [ISSUES.md](ISSUES.md) (uncertainties, defects, decisions)

## Packages

| Path | Package | Role |
|------|---------|------|
| `platform/core/` | `@decision-arena/core` | Platform: seeded RNG, rounding, clock and cadence constants; the version-1 schemas, log helpers and types under `@decision-arena/core/legacy`. Pure TypeScript, no I/O. |
| `platform/models/` | `@decision-arena/models` | Thinker and doer drivers, provider adapters. |
| `platform/web/` | `@decision-arena/web` | Vite app. |
| `platform/worker/` | `@decision-arena/worker` | Cloudflare Worker: serves `platform/web/dist`, `POST /decide`. |
| `kits/shooter/` | `@decision-arena/kit-shooter` | The 2D shooter engine: geometry, deterministic sim, perception, bots, maps; the version-1 match loop until R0.5. |

The workspace also takes `arenas/*`, empty until R0.4.
`core`, `kit-shooter` and `models` are consumed as TypeScript source; their `build` is a typecheck.

## Commands

Node 22+ and pnpm 11.

```sh
pnpm install
pnpm build       # all packages: typecheck core/kit-shooter/models, vite build, wrangler dry-run bundle
pnpm test        # vitest in every package
pnpm lint        # eslint in every package
pnpm typecheck   # tsc --noEmit in every package
pnpm dev         # builds web, then Vite on :5173 and wrangler dev on :8787
```

One package: `pnpm --filter <core|kit-shooter|models|web|worker> <script>`.
`pnpm --filter worker dev` serves `platform/web/dist`, so build web first.

## History

Decision Arena was called kbattle until DESIGN v4.0 (2026-10-22). The v3.0
design is `git show bae7c0f:DESIGN.md`; the v3.0 plan lived in `plan/` until
commit 8c831a9.
