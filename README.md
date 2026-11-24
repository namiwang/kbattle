# abarena

An auto battle arena. Build an agent out of models of different sizes,
a small fast one to act and a large slow one to plan, field it in an
arena and watch the match play itself in the browser.

- [DESIGN.md](DESIGN.md): what it is and how it works
- [PLAN.md](PLAN.md): what is built and what is next

## Run

Node 22.18+ and pnpm.

```sh
pnpm install
pnpm test     # vitest
pnpm build    # typecheck
pnpm match    # a match of 16 bots, prints the ranking; `pnpm match log.json` also writes the log
```
