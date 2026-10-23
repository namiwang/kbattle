// Helpers for the contract tests: issue paths instead of whole zod errors, so a
// test names the field it expects a schema to reject.

import type * as z from "zod";

/** The path of every issue; [] when the value parses. */
export function issuePaths(schema: z.ZodType, value: unknown): PropertyKey[][] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

/** A copy without `key`. JSON has no undefined: a missing key is how a field is absent. */
export function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

/** The boundary round trip: parse, serialize, parse again. */
export function roundTrip<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));
}
