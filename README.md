# Decision Arena

Player-authored agents, run by language models of different speeds, play
games against scripted bots in the browser. Humans write the agents and
watch the replay. The first arena is a top-down battle royale; the code
is mid-way through the v4.0 restructure: the packages sit under
`platform/`, and the shooter still lives in `platform/core` until
milestones R0.3 and R0.4 move it to `kits/shooter` and
`arenas/battle-royale`.

- Design: [DESIGN.md](DESIGN.md) (what and why; arenas in §13–§15)
- Plan: [PLAN.md](PLAN.md) (milestones with exit criteria and a log)
- Issues: [ISSUES.md](ISSUES.md) (uncertainties, defects, decisions)

## Packages

| Path | Package | Role |
|------|---------|------|
| `platform/core/` | `@kbattle/core` | Types, deterministic sim, bots, match loop. Pure TypeScript, no I/O. |
| `platform/models/` | `@kbattle/brain` | Thinker and doer drivers, provider adapters. |
| `platform/web/` | `@kbattle/web` | Vite app. |
| `platform/worker/` | `@kbattle/worker` | Cloudflare Worker: serves `platform/web/dist`, `POST /decide`. |

The workspace also takes `kits/*` and `arenas/*`, empty until R0.3 and R0.4.
`core` and `models` are consumed as TypeScript source; their `build` is a typecheck.

## Commands

Node 22+ and pnpm 11.

```sh
pnpm install
pnpm build       # all packages: typecheck core/models, vite build, wrangler dry-run bundle
pnpm test        # vitest in every package
pnpm lint        # eslint in every package
pnpm typecheck   # tsc --noEmit in every package
pnpm dev         # builds web, then Vite on :5173 and wrangler dev on :8787
```

One package: `pnpm --filter <core|brain|web|worker> <script>`.
`pnpm --filter worker dev` serves `platform/web/dist`, so build web first.
