// Writes the sim goldens in kits/shooter/fixtures/golden/ from the scenarios in
// test/sim/golden-scenarios.ts. Deterministic: a rerun rewrites the same bytes.
//
//   pnpm --filter kit-shooter exec tsx scripts/make-goldens.ts
//
// Run it only to change a golden on purpose, then review the diff. The tests
// regenerate every trace and compare it with these files; they never write them.

import { mkdirSync, writeFileSync } from "node:fs";
import { formatGolden, GOLDEN_DIR, GOLDENS } from "../test/sim/golden-scenarios";

mkdirSync(GOLDEN_DIR, { recursive: true });
for (const [name, make] of Object.entries(GOLDENS)) {
  const text = formatGolden(make());
  writeFileSync(new URL(name, GOLDEN_DIR), text);
  console.log(`fixtures/golden/${name}: ${text.length} bytes`);
}
