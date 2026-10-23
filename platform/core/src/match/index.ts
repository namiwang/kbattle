// The match loop over the platform contracts (DESIGN.md §5.2, §5.5; ruling R22),
// and replaying a recorded match (R22.k).

export { actorIntervalOf, runMatch, tickMsOf, type RunMatchDeps } from "./run";
export { makeReplayingModel, replayMatch, type RecordedMatch, type ReplayingModel } from "./replay";
