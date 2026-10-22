// The Key section (DESIGN.md §7 item 1, §10 Keys): paste an Anthropic key, save
// it in this browser, clear it. Only the thinker client (v3.2) reads it, to call
// api.anthropic.com; nothing else on the page sends it anywhere.

import { el } from "./dom";
import { hasKey, type Store } from "./state";

const KEY_NOTE = "Stored in this browser only; sent only to api.anthropic.com.";

export function createKeySection(store: Store): HTMLElement {
  const input = el("input", {
    id: "ui-key",
    type: "password",
    autocomplete: "off",
    spellcheck: false,
    placeholder: "sk-ant-…",
    value: store.state.key,
  });
  const save = el("button", { type: "button", className: "ui-button ui-primary", textContent: "Save key" });
  const clear = el("button", { type: "button", className: "ui-button", textContent: "Clear key" });
  const status = el("p", { className: "ui-key-status" });
  status.setAttribute("role", "status");

  const section = el(
    "section",
    { className: "ui-section ui-key" },
    el("h2", { textContent: "Key" }),
    el("label", { htmlFor: input.id, textContent: "Anthropic API key" }),
    el("div", { className: "ui-inline" }, input, save, clear),
    el("p", { className: "ui-note", textContent: KEY_NOTE }),
    status,
  );

  const render = () => {
    const saved = store.state.key;
    const typed = input.value.trim();
    if (typed === saved) {
      status.textContent = hasKey(saved) ? "A key is saved in this browser." : "No key saved: prompted slots are off.";
    } else {
      status.textContent = typed === "" ? "The saved key stays until you press Clear key." : "Not saved yet: press Save key.";
    }
  };

  const saveTyped = () => {
    input.value = input.value.trim();
    store.set({ key: input.value });
  };
  save.addEventListener("click", saveTyped);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveTyped();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    store.set({ key: "" });
  });
  input.addEventListener("input", render);
  store.subscribe(render);
  render();
  return section;
}
