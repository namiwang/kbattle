// The contracts of DESIGN.md: what a model is asked, what an agent and an arena are, what a match leaves.

/** One thing a model is asked. A choice has 2 to 26 options with lower-case ids. */
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> } // option id → what picking it means
  | { type: "text"; instructions: string; maxChars: number };

export type Reply = {
  answers: Record<string, string>; // the option id, or the text
  probabilities?: Record<string, Record<string, number>>; // per choice question, when the model gives them
  usage?: { input_tokens: number; output_tokens: number; cost?: number }; // cost in dollars, when the provider says
};

/** Anything that answers questions: a decision model, a chat model or a script. One that cannot answer throws. */
export interface Model {
  ask(req: { state: unknown; questions: Record<string, Question>; signal: AbortSignal }): Promise<Reply>;
}

/** One fighter's build: a model id per job, and one prompt. */
export type Agent = { actor: string; planner?: string; prompt?: string };

export type Config = { seed: number; map: string };

/** A game: a world, rules, an ending. The match loop calls it and never reads its state. */
export interface Arena<State, Obs> {
  id: string;
  maps: string[];
  tickMs: number; // match time per tick
  actEvery: number; // ticks between decisions
  questions: Record<string, Question>; // what every actor is asked at a decision
  defaultPrompt: string; // what a new agent starts with on the page
  bots: Record<string, (seed: number, index: number) => Model>;

  rules(config: Config): string; // what a planner is told: the map, the rules
  spawn(config: Config, agents: string[]): State;
  perceive(state: State, agent: string): Obs; // pure
  /** The next tick. An agent without answers, and a question without one, keeps doing what it was doing. */
  step(state: State, answers: Record<string, Record<string, string>>): State;
  snapshot(state: State): unknown; // what the replay draws a tick from
  active(state: State): string[]; // agents still asked
  ended(state: State): string[] | null; // the ranking, best first
}

export type MatchLog = { version: 1; arena: string; config: Config; agents: Agent[]; events: Event[] };

/** In the order things happened. A call is logged at the tick its answer took effect. */
export type Event =
  | { kind: "Tick"; tick: number; snapshot: unknown }
  | {
      kind: "Call";
      tick: number;
      agent: string;
      job: "actor" | "planner";
      askedTick?: number; // when it was asked, if earlier than tick
      observation?: unknown; // what the arena showed the agent
      answers?: Record<string, string>;
      probabilities?: Record<string, Record<string, number>>;
      usage?: { input_tokens: number; output_tokens: number; cost?: number };
      ms?: number; // wall time of the call; real-time matches only
      error?: string; // why it failed
    }
  | { kind: "End"; tick: number; ranking: string[]; error?: string };
