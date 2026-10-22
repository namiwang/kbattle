// Readable errors for replay files (DESIGN.md §7 item 6): why a file did not
// open, as a few lines of text, and the dismissible `.replay-error` box that
// shows them. zod issue paths are written the way code reads them:
// `events[12].kind`.

/** Why a replay file did not open: it is not JSON, or it is JSON but not a MatchLog. */
export type FileError =
  | { kind: "json"; message: string }
  | { kind: "schema"; issues: { path: string; message: string }[] };

/** Issues listed one per line; the rest are only counted (a wrong file can have thousands). */
export const MAX_ISSUES_SHOWN = 20;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A zod issue path as code would write it: ["events", 12, "kind"] → `events[12].kind`. The root is "". */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else if (typeof key === "string" && IDENTIFIER.test(key)) out += out === "" ? key : `.${key}`;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

/** The error as plain lines: what kind of failure, then the parser's message or one `path: message` per issue. */
export function formatFileError(error: FileError): string {
  if (error.kind === "json") return `The file is not valid JSON:\n${error.message}`;
  const { issues } = error;
  const lines = issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => `${issue.path || "(root)"}: ${issue.message}`);
  if (issues.length > MAX_ISSUES_SHOWN) lines.push(`…and ${issues.length - MAX_ISSUES_SHOWN} more.`);
  const count = issues.length === 1 ? "1 problem" : `${issues.length} problems`;
  return [`The file is JSON but not a kbattle replay (${count}):`, ...lines].join("\n");
}

export interface ErrorBox {
  readonly element: HTMLElement;
  /** Shows `title` over `detail` (kept as written, line breaks included), replacing what was shown. */
  show(title: string, detail: string): void;
  hide(): void;
}

/** A hidden alert box with a title, preformatted detail and a Dismiss button. */
export function createErrorBox(): ErrorBox {
  const element = document.createElement("div");
  element.className = "replay-error";
  element.setAttribute("role", "alert");
  element.hidden = true;

  const head = document.createElement("div");
  head.className = "replay-error-head";
  const title = document.createElement("strong");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "replay-error-dismiss";
  dismiss.textContent = "Dismiss";
  head.append(title, dismiss);
  const detail = document.createElement("pre");
  element.append(head, detail);

  const hide = () => {
    element.hidden = true;
  };
  dismiss.addEventListener("click", hide);

  return {
    element,
    show(titleText, detailText) {
      title.textContent = titleText;
      detail.textContent = detailText;
      element.hidden = false;
    },
    hide,
  };
}
