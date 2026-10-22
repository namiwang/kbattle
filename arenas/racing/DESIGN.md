# Racing arena — sketch

Status: one-page sketch, 2026-10-22, written as the controller's call (DESIGN.md row 46) so the platform contracts are checked against a game that shares nothing with the shooter. Not scheduled for implementation.

## The game

Cars on a closed 2D track. A map is a centerline polyline with a width; cars start on a grid. Each car has position, heading, speed. A match is N laps or a time limit. Ranking: laps completed, then distance along the track, then finish time; per-agent results `{ laps, finishTick | null, bestLapTicks }`.

## Actions

Two choice questions per decision: `throttle: gas | coast | brake` and `steer: left | straight | right`. The sim integrates: acceleration, drag, a grip limit so a fast car slides wide in a curve, and wall contact that scrubs speed. No weapons. Cars collide softly (a bump slows both).

## Perception

`self { speed, headingToTrack (deg), offCenter (m, signed), lap, progress (0–1) }`, `ahead: { curvature, distance }[]` for the next three track segments, `cars: { id, bearing, dist, closing }[]` within 30 m, `secondsLeft`. Static text: the lap count and the track's turn list ("turn 1 at 120 m: tight right").

## What it needs from the platform

- Its own `tickMs` (50) and `actorIntervalTicks` (5: steering needs faster hands than shooting).
- `Tick.data` of car poses, arena-defined.
- `active(state)`: every car until it finishes; finished cars stop being asked.
- `ended` with `results` per car.
- Bots: `bot/follower` (holds the centerline at a safe speed) and `bot/racer` (brakes before tight turns, overtakes on straights).
- Renderer: track from the map, cars as arrows, lap counter in the agent panel.

## What it must not need

Anything about bullets, line of sight or hearing, or the shooter's `Observation` shape; the planner's digest must work from a racing observation without changes.
