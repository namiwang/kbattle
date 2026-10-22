import { describe, expect, it } from "vitest";
import { formatFileError, formatIssuePath, MAX_ISSUES_SHOWN, type FileError } from "../../src/replay/errors";

describe("formatIssuePath", () => {
  it("writes a zod path the way code would: indexes in brackets, keys after dots", () => {
    expect(formatIssuePath(["events", 12, "kind"])).toBe("events[12].kind");
    expect(formatIssuePath(["events", 3, "answers", "move", "probabilities", "forward"])).toBe(
      "events[3].answers.move.probabilities.forward",
    );
    expect(formatIssuePath(["config", "slots", 0, "kind"])).toBe("config.slots[0].kind");
    expect(formatIssuePath(["seed"])).toBe("seed");
  });

  it("quotes keys that are not identifiers", () => {
    expect(formatIssuePath(["probabilities", "two words"])).toBe('probabilities["two words"]');
    expect(formatIssuePath(["a-b", "c"])).toBe('["a-b"].c');
  });

  it("is empty for the file itself (the root)", () => {
    expect(formatIssuePath([])).toBe("");
  });
});

describe("formatFileError", () => {
  it("says a JSON error is not JSON and quotes the parser", () => {
    const text = formatFileError({ kind: "json", message: "Unexpected end of JSON input" });
    expect(text).toBe("The file is not valid JSON:\nUnexpected end of JSON input");
  });

  it("lists every schema issue on its own line as `path: message`", () => {
    const error: FileError = {
      kind: "schema",
      issues: [
        { path: "events[12].kind", message: "Invalid discriminator value" },
        { path: "seed", message: "seed must equal config.seed" },
      ],
    };
    expect(formatFileError(error).split("\n")).toEqual([
      "The file is JSON but not a Decision Arena replay (2 problems):",
      "events[12].kind: Invalid discriminator value",
      "seed: seed must equal config.seed",
    ]);
  });

  it("counts one problem in the singular and names the root `(root)`", () => {
    const text = formatFileError({
      kind: "schema",
      issues: [{ path: "", message: "Invalid input: expected object, received array" }],
    });
    expect(text.split("\n")).toEqual([
      "The file is JSON but not a Decision Arena replay (1 problem):",
      "(root): Invalid input: expected object, received array",
    ]);
  });

  it(`shows at most ${MAX_ISSUES_SHOWN} issues and counts the rest`, () => {
    const issues = Array.from({ length: MAX_ISSUES_SHOWN + 7 }, (_, i) => ({
      path: `events[${i}].tick`,
      message: "Invalid input: expected number, received string",
    }));
    const lines = formatFileError({ kind: "schema", issues }).split("\n");
    expect(lines[0]).toBe(`The file is JSON but not a Decision Arena replay (${MAX_ISSUES_SHOWN + 7} problems):`);
    expect(lines).toHaveLength(1 + MAX_ISSUES_SHOWN + 1);
    expect(lines[MAX_ISSUES_SHOWN]).toBe(`events[${MAX_ISSUES_SHOWN - 1}].tick: Invalid input: expected number, received string`);
    expect(lines.at(-1)).toBe("…and 7 more.");
  });
});
