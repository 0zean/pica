import type { Result } from "../result.ts";
import { err, ok } from "../result.ts";

// The part of a protocol (zod) schema core relies on; core cannot import zod itself (PLAN.md §4.3).
export interface Schema {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: unknown }
    | {
        readonly success: false;
        readonly error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] };
      };
}

export function checkPayload(schema: Schema, value: unknown): Result<unknown, string> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });
  return err(issues.join("; "));
}
