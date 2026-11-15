import type { ConfigIssue } from "../../config/errors.ts";
import type { McpImportNote, McpServerEntryInput } from "../types.ts";
import { mcpServerIdPattern } from "../definitions.ts";

// What differs between the foreign formats; the conversion to Pica's entry shape is shared.
export interface ForeignMcpFormat {
  readonly serversKey: string;
  readonly topLevelKeys: ReadonlySet<string>;
  readonly typeAliases: Readonly<Record<string, "stdio" | "http" | "sse">>;
  readonly entryKeys: ReadonlySet<string>;
  // Rewrites the format's variables into Pica's syntax, or returns an issue message.
  readonly rewrite: (text: string, keyPath: string, notes: NoteSink) => string | { readonly issue: string };
  // Maps a format's own field names onto the shared ones (`serverUrl` → `url`) before conversion.
  // Keys it consumes must be absent from its result; keys it leaves are converted as usual.
  readonly normalize?: (raw: Readonly<Record<string, unknown>>, keyPath: string, notes: NoteSink) => Record<string, unknown>;
  // Settings files with many unrelated keys (Gemini CLI, `~/.claude.json`) get no note for each.
  readonly quietTopLevel?: boolean;
}

export type NoteSink = (keyPath: string, message: string) => void;

export interface ForeignImport {
  readonly entries: readonly McpServerEntryInput[];
  readonly notes: readonly McpImportNote[];
  readonly issues: readonly ConfigIssue[];
}

const stringFields = ["command", "cwd", "url"] as const;
const recordFields = ["env", "headers"] as const;

export function importForeign(format: ForeignMcpFormat, source: string, value: unknown): ForeignImport {
  const notes: McpImportNote[] = [];
  const issues: ConfigIssue[] = [];
  const note: NoteSink = (keyPath, message) => notes.push({ source, keyPath, message });
  if (!isRecord(value)) {
    return { entries: [], notes, issues: [{ keyPath: "", message: "expected an object" }] };
  }
  for (const key of Object.keys(value)) {
    if (key !== format.serversKey && !format.topLevelKeys.has(key) && format.quietTopLevel !== true) {
      note(key, "ignored: not an MCP server setting");
    }
  }
  const servers = value[format.serversKey];
  if (servers === undefined) {
    return { entries: [], notes, issues };
  }
  if (!isRecord(servers)) {
    return { entries: [], notes, issues: [{ keyPath: format.serversKey, message: "expected an object" }] };
  }
  const entries: McpServerEntryInput[] = [];
  const ids = new Map<string, string>();
  for (const [key, raw] of Object.entries(servers)) {
    const keyPath = [format.serversKey, key];
    const id = serverId(key);
    const clash = ids.get(id);
    if (clash !== undefined) {
      issues.push({ keyPath: keyPath.join("."), message: `server id "${id}" is also used by "${clash}"` });
      continue;
    }
    ids.set(id, key);
    if (!isRecord(raw)) {
      issues.push({ keyPath: keyPath.join("."), message: "expected an object" });
      continue;
    }
    const normalized = format.normalize === undefined ? raw : format.normalize(raw, keyPath.join("."), note);
    const entry = convertEntry(format, normalized, keyPath, note, issues);
    entries.push({ id, keyPath, entry: id === key ? entry : { name: key, ...entry } });
  }
  return { entries, notes, issues };
}

// Foreign server names are free text; Pica ids are not (definitions.ts).
export function serverId(name: string): string {
  if (mcpServerIdPattern.test(name)) {
    return name;
  }
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").replace(/-+$/, "");
  return slug === "" ? "server" : slug;
}

function convertEntry(
  format: ForeignMcpFormat,
  raw: Readonly<Record<string, unknown>>,
  keyPath: readonly string[],
  note: NoteSink,
  issues: ConfigIssue[],
): Record<string, unknown> {
  const path = (...rest: string[]): string => [...keyPath, ...rest].join(".");
  const rewrite = (value: unknown, at: string): unknown => {
    if (typeof value !== "string") {
      return value;
    }
    const result = format.rewrite(value, at, note);
    if (typeof result === "string") {
      return result;
    }
    issues.push({ keyPath: at, message: result.issue });
    return value;
  };

  const entry: Record<string, unknown> = { type: entryType(format, raw) };
  const copies = (field: string): boolean => format.entryKeys.has(field) && raw[field] !== undefined;
  for (const field of stringFields) {
    if (copies(field)) {
      entry[field] = rewrite(raw[field], path(field));
    }
  }
  const args = raw["args"];
  if (copies("args")) {
    entry["args"] = Array.isArray(args) ? args.map((arg: unknown, index) => rewrite(arg, path("args", String(index)))) : args;
  }
  for (const field of recordFields) {
    const record = raw[field];
    if (copies(field)) {
      entry[field] = isRecord(record)
        ? Object.fromEntries(Object.entries(record).map(([key, item]) => [key, rewrite(item, path(field, key))]))
        : record;
    }
  }
  if (copies("tools")) {
    const tools = raw["tools"];
    if (!(Array.isArray(tools) && tools.includes("*"))) {
      entry["tools"] = tools;
    }
  }
  for (const key of Object.keys(raw)) {
    if (!format.entryKeys.has(key)) {
      note(path(key), "ignored: Pica has no equivalent setting");
    }
  }
  return entry;
}

function entryType(format: ForeignMcpFormat, raw: Readonly<Record<string, unknown>>): unknown {
  const type = raw["type"];
  if (typeof type === "string") {
    return format.typeAliases[type] ?? type;
  }
  if (type !== undefined) {
    return type;
  }
  if (raw["command"] !== undefined) {
    return "stdio";
  }
  return raw["url"] !== undefined ? "http" : undefined;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
