import { MatchLogSchema } from "@decision-arena/core";
import { describe, expect, it } from "vitest";
import unknownKindText from "../../../core/fixtures/bad/unknown-event-kind.json?raw";
import sampleText from "../../../core/fixtures/sample-log.json?raw";
import { matchLogFileName, openMatchLogFile, parseMatchLogText, pickJsonFile } from "../../src/replay/files";

const sample = MatchLogSchema.parse(JSON.parse(sampleText));
const jsonFile = (text: string, name = "replay.json", type = "application/json") => new File([text], name, { type });

describe("parseMatchLogText", () => {
  it("parses the sample log into the MatchLog the schema gives", () => {
    expect(parseMatchLogText(sampleText)).toEqual({ ok: true, log: sample });
  });

  it("reports text that is not JSON as kind `json`, with the parser's message", () => {
    const result = parseMatchLogText('{ "version": 1, ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("json");
    let parserMessage = "";
    try {
      JSON.parse('{ "version": 1, ');
    } catch (error) {
      parserMessage = (error as Error).message;
    }
    expect(result.error).toEqual({ kind: "json", message: parserMessage });
  });

  it("reports an empty file as kind `json`", () => {
    expect(parseMatchLogText("")).toMatchObject({ ok: false, error: { kind: "json" } });
  });

  it("reports a schema failure as kind `schema`, with the issue path (bad/unknown-event-kind.json)", () => {
    expect(parseMatchLogText(unknownKindText)).toEqual({
      ok: false,
      error: {
        kind: "schema",
        issues: [{ path: "events[5].kind", message: expect.stringContaining("Invalid discriminator value") }],
      },
    });
  });

  it("reports every issue, in zod's order", () => {
    const result = parseMatchLogText("{}");
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "schema") throw new Error("expected a schema error");
    expect(result.error.issues.map((i) => i.path)).toEqual(["version", "config", "seed", "prompts", "events"]);
  });

  it("reports JSON that is not an object as one issue at the root", () => {
    expect(parseMatchLogText("[]")).toEqual({
      ok: false,
      error: { kind: "schema", issues: [{ path: "", message: "Invalid input: expected object, received array" }] },
    });
  });

  it("reports a map this viewer does not have at config.mapId", () => {
    const text = JSON.stringify({ ...sample, config: { ...sample.config, mapId: "map-9" } });
    expect(parseMatchLogText(text)).toEqual({
      ok: false,
      error: { kind: "schema", issues: [{ path: "config.mapId", message: expect.stringContaining('"map-9"') }] },
    });
  });

  it("round-trips: JSON.stringify of a parsed log parses back deep-equal (what Download saves)", () => {
    const saved = JSON.stringify(sample);
    expect(saved).not.toContain("\n");
    expect(parseMatchLogText(saved)).toEqual({ ok: true, log: sample });
  });
});

describe("openMatchLogFile", () => {
  it("reads a File and parses it", async () => {
    await expect(openMatchLogFile(jsonFile(sampleText, "sample-log.json"))).resolves.toEqual({ ok: true, log: sample });
  });

  it("reports a broken file the same way as the text parser", async () => {
    await expect(openMatchLogFile(jsonFile("nope"))).resolves.toMatchObject({ ok: false, error: { kind: "json" } });
  });
});

describe("matchLogFileName", () => {
  it("is decision-arena-<mapId>-<seed>.json", () => {
    expect(matchLogFileName(sample)).toBe("decision-arena-map-1-1.json");
    expect(matchLogFileName({ ...sample, seed: 42, config: { ...sample.config, seed: 42 } })).toBe("decision-arena-map-1-42.json");
  });
});

describe("pickJsonFile", () => {
  it("takes the one .json file, whatever its type or the case of the extension", () => {
    const file = jsonFile("{}", "Replay.JSON", "");
    expect(pickJsonFile([file])).toEqual({ ok: true, file });
  });

  it("takes a file typed application/json without the extension", () => {
    const file = jsonFile("{}", "replay");
    expect(pickJsonFile([file])).toEqual({ ok: true, file });
  });

  it("refuses several files", () => {
    expect(pickJsonFile([jsonFile("{}"), jsonFile("{}")])).toEqual({
      ok: false,
      message: "Open one replay file at a time (got 2 files).",
    });
  });

  it("refuses a file that is not .json", () => {
    expect(pickJsonFile([jsonFile("x", "photo.png", "image/png")])).toEqual({
      ok: false,
      message: '"photo.png" is not a .json file.',
    });
  });

  it("refuses nothing", () => {
    expect(pickJsonFile([])).toEqual({ ok: false, message: "No file to open." });
  });
});
