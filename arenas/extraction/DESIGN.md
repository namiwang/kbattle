# Extraction arena — sketch

Status: one-page sketch, 2026-10-22, written as the controller's call (DESIGN.md row 46) from the RaidRank research (`research/ai-extraction-fps/en`), so the contracts are checked against a second shooter arena. Not scheduled for implementation.

## The game

The shooter kit's world with two additions on the map: loot spots, each holding a value, and extraction points. Agents spawn around the edge, collect value by standing on loot spots, and must reach an extraction point before the time limit to keep it. Dying loses everything. An extracted agent leaves the world. Ranking: extracted value, then alive at the end, then kills; per-agent results `{ outcome: extracted | dead | timed_out, value, extractTick | null }`.

## Actions

The shooter's questions (`move`, `turn`, `fire`, `target`) with two extra turn options the arena adds to `turn`'s criteria: `face_loot` (nearest loot spot) and `face_extract` (nearest extraction point). The planner's plan text decides when to stop looting and leave.

## Perception

The shooter's observation plus `objective { carried, nearestLoot { bearing, dist, value } | null, nearestExtract { bearing, dist }, extractOpen: boolean }`. Static text: the map, the loot and extraction layout, the time limit.

## What it needs from the platform and the kit

- Kit map format with optional `features` (loot spots, extraction points) so battle royale maps stay valid.
- `active(state)` excludes extracted agents; `ended` returns `results`.
- Events `Loot { tick, agent, value }` and `Extract { tick, agent, value }` in the arena's event union; the renderer draws loot and extraction markers.
- Bots: `bot/looter` (loot then extract) and `bot/camper` at an extraction point.

## What it must not need

Changes to the platform loop, the log envelope or the replay shell. Its renderer reuses the kit's map, agents, bullets and overlay parts.
