import type { McpImportNote } from "@pica/protocol";
import { importForeign, isRecord } from "../mcp/import/foreign.ts";
import type { ForeignImport } from "../mcp/import/foreign.ts";
import { pastedMcpFormat } from "../mcp/import/formats.ts";
import { err, ok } from "../result.ts";
import { isWithin } from "./key-paths.ts";
import type { Result } from "../result.ts";

export interface PastedMcpServers {
  readonly imported: ForeignImport;
  // Turns a key path in the wrapped value back into one in the text the user pasted.
  readonly relabel: (keyPath: string) => string;
}

// Keys that make an object one server entry rather than a map of them.
const entryKeys = ["command", "url", "serverUrl", "httpUrl", "type"];

// Accepts `{ "mcpServers": {…} }`, `{ "servers": {…} }` (VS Code), a bare `{ "<name>": {…} }` map,
// one entry with `name` given (or a `name` field in it), and the same without the outer braces.
// A malformed snippet fails with the key path of the problem; "" is the snippet itself.
export function parseMcpSnippet(text: string, name?: string): Result<PastedMcpServers, McpImportNote> {
  const value = parseJson(text);
  if (!value.ok) {
    return value;
  }
  if (!isRecord(value.value)) {
    return err({ keyPath: "", message: "expected a JSON object of MCP servers or one server entry" });
  }
  const snippet = value.value;
  for (const key of ["mcpServers", "servers"]) {
    if (snippet[key] !== undefined) {
      return found({ imported: importForeign(pastedMcpFormat(key), "paste", snippet), relabel: (path) => path });
    }
  }
  if (entryKeys.some((key) => snippet[key] !== undefined && !isRecord(snippet[key]))) {
    return singleEntry(snippet, name);
  }
  const strip = (path: string): string => (path.startsWith("mcpServers.") ? path.slice("mcpServers.".length) : "");
  return found({ imported: importForeign(pastedMcpFormat("mcpServers"), "paste", { mcpServers: snippet }), relabel: strip });
}

function singleEntry(snippet: Readonly<Record<string, unknown>>, given: string | undefined): Result<PastedMcpServers, McpImportNote> {
  const { name: field, ...entry } = snippet;
  const name = given ?? (typeof field === "string" && field !== "" ? field : undefined);
  if (name === undefined) {
    return err({ keyPath: "", message: "a single server entry needs a name; pass one with the snippet" });
  }
  const prefix = `mcpServers.${name}`;
  const relabel = (path: string): string =>
    path === prefix ? "" : path.startsWith(`${prefix}.`) ? path.slice(prefix.length + 1) : path;
  return found({ imported: importForeign(pastedMcpFormat("mcpServers"), "paste", { mcpServers: { [name]: entry } }), relabel });
}

function found(pasted: PastedMcpServers): Result<PastedMcpServers, McpImportNote> {
  const fileIssue = pasted.imported.issues.find((issue) =>
    pasted.imported.entries.every((entry) => !isWithin(issue.keyPath, entry.keyPath.join("."))),
  );
  if (fileIssue !== undefined) {
    return err({ keyPath: pasted.relabel(fileIssue.keyPath), message: fileIssue.message });
  }
  if (pasted.imported.entries.length === 0 && pasted.imported.issues.length === 0) {
    return err({ keyPath: "", message: "the snippet has no MCP servers" });
  }
  return ok(pasted);
}

// A copied `"name": { … }` member has no braces around it; it is accepted with them added.
function parseJson(text: string): Result<unknown, McpImportNote> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (thrown) {
    try {
      return ok(JSON.parse(`{${text}}`) as unknown);
    } catch {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return err({ keyPath: "", message: `not valid JSON: ${message}` });
    }
  }
}
