// v0.6 thinker spike page (disposable, may go in P4): paste a key, send a sample
// perception to the thinker, see the parsed Plan or the fault (DESIGN.md §5.4-§5.6).
// The key lives in localStorage and goes only to api.anthropic.com (§7, §10).
import { makeAnthropicThinker } from "@decision-arena/models";
import { THINKER_MODEL } from "@decision-arena/core";
import { applyResult, initialSpikeState, type SpikeState } from "./spike-thinker-state";

const KEY_STORAGE = "decision-arena:v1:anthropic-key";

// A stand-in for the harness prompt v3.4 writes.
const SAMPLE_SYSTEM = `You are the thinker for agent a0 in a top-down 2D battle royale: the last agent alive wins.
Units: meters, y down; angles in degrees clockwise from +x; a bearing is relative to your facing, positive to the right.
A fast doer model controls your agent every 0.5 s (move, turn, fire, target) and reads only your plan text.
Each call gives you your perception, the events since your last call, your current plan and your scratchpad.
Answer with JSON only:
- text: the new plan for the doer, one or two short imperative sentences, under 300 characters.
- scratchpad: your private notes for your next call, under 500 characters.`;

const SAMPLE_PERCEPTION = JSON.stringify(
  {
    tick: 400,
    self: { pos: [22.5, 61], facing: -30, hp: 72, kills: 0, secondsLeft: 280 },
    visible: [{ id: "a3", bearing: -12, dist: 38, moving: true }],
    heard: [{ kind: "shot", bearing: 140, dist: "far" }],
    incoming: [{ bearing: 95 }],
    events: ["hit for 20 from bearing 95", "shot heard far at bearing 140", "a3 seen moving at 38 m"],
    plan: "Hold the east wall, engage anyone crossing the gap, retreat north under 40 HP.",
    scratchpad: "Spawned south-west. a3 likes the gap.",
  },
  null,
  2,
);

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`spike page: #${id} is missing`);
  return element as T;
}

const keyInput = byId<HTMLInputElement>("key");
const systemInput = byId<HTMLTextAreaElement>("system");
const perceptionInput = byId<HTMLTextAreaElement>("perception");
const maxTokensInput = byId<HTMLInputElement>("max-tokens");
const runButton = byId<HTMLButtonElement>("run");
const stoppedBanner = byId<HTMLParagraphElement>("stopped");
const planOutput = byId<HTMLPreElement>("plan");
const logOutput = byId<HTMLPreElement>("log");

let state: SpikeState = initialSpikeState;
let running = false;

function render(): void {
  runButton.disabled = running || state.stopped !== null;
  stoppedBanner.hidden = state.stopped === null;
  stoppedBanner.textContent = state.stopped === null ? "" : `Stopped: ${state.stopped}. Change the key to run again.`;
  planOutput.textContent = state.plan === null ? "(no plan yet)" : JSON.stringify(state.plan, null, 2);
  logOutput.textContent = state.log.join("\n");
}

async function runSpike(): Promise<void> {
  const apiKey = keyInput.value.trim();
  if (apiKey === "") {
    state = { ...state, log: [...state.log, "paste a key first"] };
    render();
    return;
  }
  const maxTokens = Math.max(1, Math.floor(Number(maxTokensInput.value) || 600));
  running = true;
  render();
  try {
    const started = performance.now();
    const result = await makeAnthropicThinker({ apiKey, maxTokens }).complete({
      system: systemInput.value,
      messages: [{ role: "user", content: perceptionInput.value }],
    });
    state = applyResult(state, result, Math.round(performance.now() - started));
  } finally {
    running = false;
    render();
  }
}

keyInput.value = localStorage.getItem(KEY_STORAGE) ?? "";
systemInput.value = SAMPLE_SYSTEM;
perceptionInput.value = SAMPLE_PERCEPTION;
byId("model").textContent = THINKER_MODEL;

keyInput.addEventListener("input", () => {
  const key = keyInput.value.trim();
  if (key === "") localStorage.removeItem(KEY_STORAGE);
  else localStorage.setItem(KEY_STORAGE, key);
  // A new key may cure an auth fault, so it lifts the stop.
  state = { ...state, stopped: null };
  render();
});
runButton.addEventListener("click", () => void runSpike());

render();
