import type { JsonValue } from "../json.ts";

// The patch text an `apply_patch` call carries. The hook gives the raw string (S-04); the session
// event log wraps it as `{ value }`. Anything else has no patch text to read.
export function patchText(args: JsonValue): string | undefined {
  if (typeof args === "string") {
    return args;
  }
  if (args === null || typeof args !== "object" || isArray(args)) {
    return undefined;
  }
  const value = args["value"] ?? args["input"] ?? args["patch"];
  return typeof value === "string" ? value : undefined;
}

const creatingHeader = /^\*\*\* (?:Add File|Move to): (.+)$/;

// The paths a patch creates: each `*** Add File:` and each `*** Move to:` destination, in order.
export function patchCreatedPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const path = creatingHeader.exec(line)?.[1]?.trim();
    if (path !== undefined && path !== "") {
      paths.push(path);
    }
  }
  return paths;
}

// `Array.isArray` does not narrow a readonly array out of a union.
function isArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
