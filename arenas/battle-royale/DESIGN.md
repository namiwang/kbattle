# Battle royale arena — design

Status: carved from DESIGN.md v3.0 §6 on 2026-10-22; the shooter specifics that the platform design (../../DESIGN.md) no longer carries. Numbers marked ASSUMED are placeholders to tune (ISSUES I-017 among them). Rulings R1–R18 in the execution ledger refined these rules; the code under core/src/sim is the current truth until it moves to kits/shooter.

## Rules

### Conventions (row 24)

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

### World and rules

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


### What this arena owns under v4.0

- Config: the platform's slots plus `mapId`, `seed`, `durationTicks`; mode `solo`.
- Questions: `move`, `turn`, `fire`, `target` as in v3.0 §5.4, with the fixed criteria texts; `target` omitted when nothing is visible.
- Events: `Spawn`, `Shot`, `Hit`, `Death`; `Tick.data` = agent rows `[id, x, y, facing, hp]`, bullet rows, and `near` rows.
- Ending: last agent alive or `durationTicks`; ranking survival, kills, HP (ties by slot, ISSUES I-023).
- Bots: `bot/wanderer`, `bot/camper`.
- Renderer: map, agents, bullet trails, follow camera, vision-cone overlay, incoming-fire ticks, state rebuilt from `Tick.data` for the agent panel.
- Static text for the planner: the map's obstacles and the rules in a few lines (DESIGN.md row 48).
