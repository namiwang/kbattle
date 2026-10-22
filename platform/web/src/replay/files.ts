// Replay files (DESIGN.md §7 item 6; principle 7: the match is one file): read
// a MatchLog from text or a File and say why it did not open, and save the
// loaded one to disk. Validation is MatchLogSchema (§5.3) plus the one thing
// the viewer needs beyond it, a map it has. A good result is the schema's
// output, never the raw JSON.

import { MAP_IDS, MatchLogSchema, type MatchLog } from "@decision-arena/core";
import { formatIssuePath, type FileError } from "./errors";

export type OpenResult = { ok: true; log: MatchLog } | { ok: false; error: FileError };

/** Parses and validates a replay file's text. Never throws. Synchronous: a 5 MB log blocks for a while. */
export function parseMatchLogText(text: string): OpenResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { kind: "json", message: error instanceof Error ? error.message : String(error) } };
  }
  const parsed = MatchLogSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message }));
    return { ok: false, error: { kind: "schema", issues } };
  }
  const { mapId } = parsed.data.config;
  if (!MAP_IDS.includes(mapId)) {
    const message = `Unknown map "${mapId}"; this viewer has ${MAP_IDS.join(", ")}`;
    return { ok: false, error: { kind: "schema", issues: [{ path: "config.mapId", message }] } };
  }
  return { ok: true, log: parsed.data };
}

/** Reads a file (upload or drop) and parses it like parseMatchLogText. */
export async function openMatchLogFile(file: File): Promise<OpenResult> {
  return parseMatchLogText(await file.text());
}

/** The name Download gives a log: `decision-arena-<mapId>-<seed>.json`. */
export function matchLogFileName(log: MatchLog): string {
  return `decision-arena-${log.config.mapId}-${log.seed}.json`;
}

/** The single .json file of a drop or a file picker, or a sentence saying why there is none to open. */
export function pickJsonFile(files: ArrayLike<File>): { ok: true; file: File } | { ok: false; message: string } {
  const file = files[0];
  if (!file) return { ok: false, message: "No file to open." };
  if (files.length > 1) return { ok: false, message: `Open one replay file at a time (got ${files.length} files).` };
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    return { ok: false, message: `"${file.name}" is not a .json file.` };
  }
  return { ok: true, file };
}

// The browser reads the Blob after click() returns, so the URL cannot be revoked at once
// (FileSaver.js waits 40 s for the same reason).
const REVOKE_AFTER_MS = 40_000;

/** Saves `log` as compact JSON (no pretty print) to `decision-arena-<mapId>-<seed>.json`, through a Blob URL. */
export function downloadMatchLog(log: MatchLog): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(log)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = matchLogFileName(log);
  link.hidden = true;
  document.body.append(link); // Firefox only follows a link that is in the document
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
