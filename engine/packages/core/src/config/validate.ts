import { PicaConfig } from "@pica/protocol";
import type { JsonObject } from "../json.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { configError } from "./errors.ts";
import type { ConfigError, ConfigIssue } from "./errors.ts";

// Returns the layer exactly as written, not the parsed output: the parsed output fills in
// defaults, which would hide every lower layer when merged.
export function validateLayer(file: string, value: unknown): Result<JsonObject, ConfigError> {
  const parsed = PicaConfig.safeParse(value);
  if (parsed.success) {
    return ok(value as JsonObject);
  }
  return err(configError("config.invalid", file, schemaIssues(parsed.error.issues)));
}

// Structural, so core needs no direct zod import.
interface SchemaIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[];
}

export function schemaIssues(zodIssues: readonly SchemaIssue[], prefix: readonly string[] = []): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const issue of zodIssues) {
    const path = [...prefix, ...issue.path.map(String)];
    if (issue.code === "unrecognized_keys" && issue.keys !== undefined) {
      for (const key of issue.keys) {
        issues.push({ keyPath: [...path, key].join("."), message: "unknown key" });
      }
    } else {
      issues.push({ keyPath: path.join("."), message: issue.message });
    }
  }
  return issues;
}
