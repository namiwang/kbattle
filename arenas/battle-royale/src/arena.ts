// The battle royale arena (DESIGN.md §5.2, §13; rulings R19, R24): the shooter
// that exists today, the shooter kit's world, step and perception wrapped into
// the platform's Arena contract. It owns the rules the kit does not: the config
// (seed, length, map), the actor's questions and defaults, how answers become an
// action (R9), its events and Tick payload (exactly the version-1 log's), who is
// still asked (the living), the ending (one alive or time up) and the ranking
// (R11), the planner's static and observation texts, and the bots.

import { TICK_MS, type Answer, type Answers, type Arena } from "@decision-arena/core";
import {
  actionFromAnswers,
  getMap,
  MAP_IDS,
  PERCEPTION_WINDOW_TICKS,
  perceive,
  spawnWorld,
  step,
  type Action,
  type ActionAnswers,
  type MapSpec,
  type Observation,
  type WorldState,
} from "@decision-arena/kit-shooter";
import { botModel } from "./bots";
import { configSchema, type BattleRoyaleConfig } from "./config";
import { BattleRoyaleEventSchema, spawnEvents, tickData, TickDataSchema, type BattleRoyaleEvent, type TickData } from "./events";
import { actorQuestions, DEFAULTS } from "./questions";
import { rankAgents } from "./ranking";
import { observationText, staticText } from "./text";

/** The battle royale's types for the platform (the Arena type bag, R21.c). */
export type BattleRoyaleTypes = {
  Config: BattleRoyaleConfig;
  State: WorldState;
  Obs: Observation;
  Action: Action;
  Event: BattleRoyaleEvent;
  TickData: TickData;
};

/**
 * The arena over the kit's bundled maps and `extraMaps` (hand-made worlds for
 * tests; their ids follow the bundled ones in `maps` and in the config's enum).
 */
export function createBattleRoyale(extraMaps: readonly MapSpec[] = []): Arena<BattleRoyaleTypes> {
  const extra = Object.fromEntries(extraMaps.map((map) => [map.id, map]));
  const maps = [...MAP_IDS, ...extraMaps.map((map) => map.id)];
  const mapOf = (id: string): MapSpec => (Object.hasOwn(extra, id) ? extra[id]! : getMap(id));
  // The actor decides once per perception window, so each shot, hit and near miss
  // reaches exactly one decision of every agent that perceives it (R15).
  const interval = PERCEPTION_WINDOW_TICKS;

  return {
    id: "battle-royale",
    title: "Battle royale",
    modes: ["solo"],
    maps,
    config: configSchema(maps),
    tickMs: TICK_MS,
    actorIntervalTicks: interval,

    spawn(config, agents, rng) {
      const state = spawnWorld({ map: mapOf(config.mapId), agents, durationTicks: config.durationTicks, rng });
      return { state, events: spawnEvents(state) };
    },
    perceive: (state, agent) => perceive(state, agent),
    questions: (obs) => actorQuestions(obs),
    // R9: anything missing or unknown is no action, never the previous one.
    actionFrom: (answers, obs) =>
      actionFromAnswers(
        actionAnswers(answers),
        obs.visible.map((v) => v.id),
      ),
    step: (state, actions) => step(state, actions),
    tick: tickData,
    tickData: TickDataSchema,
    events: BattleRoyaleEventSchema,
    active: (state) => state.agents.filter((agent) => agent.alive).map((agent) => agent.id),
    ended(state) {
      const alive = state.agents.filter((agent) => agent.alive).length;
      if (alive > 1 && state.tick < state.durationTicks) return null;
      return { ranking: rankAgents(state.agents) };
    },
    staticText: (config) => staticText(mapOf(config.mapId), config.durationTicks),
    observationText,
    bots: {
      wanderer: (seed, slot) => botModel("wanderer", seed, slot, interval),
      camper: (seed, slot) => botModel("camper", seed, slot, interval),
    },
    defaults: DEFAULTS,
  };
}

/** The battle royale on the kit's maps, map-1 and map-2. */
export const battleRoyale = createBattleRoyale();

/** The answers the kit's actionFromAnswers reads, each only when it has the type its question asked for. */
function actionAnswers(answers: Answers): ActionAnswers {
  const pick = (answer: Answer | undefined) => (answer?.type === "choice" ? answer : undefined);
  const fire = answers.fire;
  return { move: pick(answers.move), turn: pick(answers.turn), fire: fire?.type === "noul" ? fire : undefined, target: pick(answers.target) };
}
