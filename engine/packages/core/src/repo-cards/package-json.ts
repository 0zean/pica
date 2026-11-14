import type { JsonValue } from "../json.ts";

export interface PackageJson {
  readonly scripts: ReadonlyMap<string, string>;
  readonly entries: readonly string[];
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOf(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (isRecord(value)) return Object.values(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
  return [];
}

function exportsRoot(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (!isRecord(value)) return [];
  const root = value["."];
  if (typeof root === "string") return [root];
  if (!isRecord(root)) return [];
  return ["import", "require", "default"].flatMap((key) => stringsOf(root[key]));
}

function relative(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

export function parsePackageJson(text: string): PackageJson | undefined {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const scripts = new Map<string, string>();
  const rawScripts = parsed["scripts"];
  if (isRecord(rawScripts)) {
    for (const [name, command] of Object.entries(rawScripts)) {
      if (typeof command === "string") scripts.set(name, command);
    }
  }
  const entries = [
    ...stringsOf(parsed["bin"]),
    ...stringsOf(parsed["main"]),
    ...stringsOf(parsed["module"]),
    ...exportsRoot(parsed["exports"]),
  ].map(relative);
  return { scripts, entries };
}
