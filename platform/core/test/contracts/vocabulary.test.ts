import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// R21.h and the R0.2 exit criterion: nothing in the contracts or the loop names a
// position, a bullet, a facing, hp or a map. One arena's notions leaking into the
// platform is an anti-goal (DESIGN.md §1); the racing and extraction sketches
// (§14, §15) must fit the same contracts. Whole words, any case, code and
// comments alike, so `Map` and `.map(` count too.

const SHOOTER_WORDS = /\b(position|bullet|facing|hp|map)\b/i;
const CORE = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED = ["src/contracts", "src/match"];

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("the platform's vocabulary (R21.h)", () => {
  it("catches each word whole and in any case, and not inside other words", () => {
    for (const line of ["const facing = 0;", "// the position of", "x.map((a) => a)", "new Map()", "HP left", "one Bullet"]) {
      expect(SHOOTER_WORDS.test(line), line).toBe(true);
    }
    for (const line of ["maps: readonly string[]", "xs.flatMap(f)", "new WeakMap()", "what happened", "https://example.com"]) {
      expect(SHOOTER_WORDS.test(line), line).toBe(false);
    }
  });

  it.each(SCANNED)("finds none of them in platform/core/%s", (dir) => {
    const files = filesUnder(join(CORE, dir));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (SHOOTER_WORDS.test(line) ? [`${relative(CORE, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
