// The Mind section (DESIGN.md §7 item 2, row 13): the thinker system prompt and
// one instruction per doer question. Four of the five questions: escalate's
// instruction is fixed by Decision Arena (§5.4), so Prompts has no field for it. A blank
// instruction uses the default (ISSUES I-005), which the field shows as its placeholder.

import { ACTOR_INTERVAL_TICKS, TICK_MS } from "@decision-arena/core";
import { MOVE_CHOICES, PromptsSchema, TURN_CHOICES, type Prompts } from "@decision-arena/core/legacy";
import { DEFAULT_PROMPTS } from "./defaults";
import { el, showText } from "./dom";
import type { Store } from "./state";

type Question = keyof Prompts["doerInstructions"];

const THINKER_MAX = PromptsSchema.shape.thinkerSystem.maxLength ?? 8000;
const DOER_MAX = PromptsSchema.shape.doerInstructions.shape.move.maxLength ?? 500;
const DOER_SECONDS = (ACTOR_INTERVAL_TICKS * TICK_MS) / 1000;

const oneOf = (choices: readonly string[]) => `${choices.slice(0, -1).join(", ")} or ${choices.at(-1)}`;

const QUESTIONS: readonly { id: Question; label: string; answers: string }[] = [
  { id: "move", label: "Move", answers: `Picks ${oneOf(MOVE_CHOICES)}.` },
  { id: "turn", label: "Turn", answers: `Picks ${oneOf(TURN_CHOICES)}.` },
  { id: "fire", label: "Fire", answers: "Answers yes or no." },
  { id: "target", label: "Target", answers: "Picks a visible enemy, or none." },
];

export function createMindSection(store: Store): HTMLElement {
  const reset = el("button", { type: "button", className: "ui-button", textContent: "Reset to defaults" });
  const thinker = el("textarea", {
    id: "ui-thinker",
    maxLength: THINKER_MAX,
    rows: 8,
    placeholder: DEFAULT_PROMPTS.thinkerSystem,
  });
  const count = el("span", { id: "ui-thinker-count", className: "ui-count" });
  thinker.setAttribute("aria-describedby", "ui-thinker-hint ui-thinker-count");

  const doer = new Map<Question, HTMLInputElement>();
  const rows = QUESTIONS.map(({ id, label, answers }) => {
    const input = el("input", {
      id: `ui-doer-${id}`,
      type: "text",
      maxLength: DOER_MAX,
      autocomplete: "off",
      placeholder: DEFAULT_PROMPTS.doerInstructions[id],
    });
    input.setAttribute("aria-describedby", `ui-doer-${id}-answers`);
    doer.set(id, input);
    return el(
      "div",
      { className: "ui-doer-row" },
      el("label", { htmlFor: input.id, textContent: label }),
      el("div", { className: "ui-doer-field" }, input, el("p", { id: `ui-doer-${id}-answers`, className: "ui-hint", textContent: answers })),
    );
  });

  const section = el(
    "section",
    { className: "ui-section ui-mind" },
    el("div", { className: "ui-section-head" }, el("h2", { textContent: "Mind" }), reset),
    el("p", {
      className: "ui-lead",
      textContent:
        "Your agent runs on two models. The thinker, an LLM on your key, writes a short plan now and then. " +
        `The doer, a fast decision model, acts on that plan and on what the agent perceives every ${DOER_SECONDS} s.`,
    }),
    el(
      "div",
      { className: "ui-field" },
      el("div", { className: "ui-label-row" }, el("label", { htmlFor: thinker.id, textContent: "Thinker system prompt" }), count),
      thinker,
      el("p", {
        id: "ui-thinker-hint",
        className: "ui-hint",
        textContent: "Decision Arena puts its own harness first (the rules, what the agent perceives, the reply format); you write the strategy.",
      }),
    ),
    el(
      "fieldset",
      { className: "ui-doer" },
      el("legend", { textContent: "Doer instructions" }),
      ...rows,
      el("p", {
        className: "ui-hint",
        textContent:
          "A blank field uses the default. A fifth question, escalate (“the plan no longer fits the situation”), " +
          "is fixed by Decision Arena: a yes calls the thinker for a new plan.",
      }),
    ),
  );

  const read = (): Prompts => ({
    thinkerSystem: thinker.value,
    doerInstructions: {
      move: doer.get("move")?.value ?? "",
      turn: doer.get("turn")?.value ?? "",
      fire: doer.get("fire")?.value ?? "",
      target: doer.get("target")?.value ?? "",
    },
  });

  const render = () => {
    const { prompts } = store.state;
    showText(thinker, prompts.thinkerSystem);
    for (const [id, input] of doer) showText(input, prompts.doerInstructions[id]);
    count.textContent = `${thinker.value.length} / ${THINKER_MAX}`;
  };

  const save = () => store.set({ prompts: read() });
  thinker.addEventListener("input", save);
  for (const input of doer.values()) input.addEventListener("input", save);
  reset.addEventListener("click", () => store.set({ prompts: DEFAULT_PROMPTS }));
  store.subscribe(render);
  render();
  return section;
}
