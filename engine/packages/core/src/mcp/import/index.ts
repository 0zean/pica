import type { ConfigIssue } from "../../config/errors.ts";
import type { McpLayerInput, McpServerEntryInput } from "../types.ts";
import { importForeign, isRecord } from "./foreign.ts";
import type { ForeignImport } from "./foreign.ts";
import { copilotCliMcpFormat, mcpJsonFormat, vscodeMcpFormat } from "./formats.ts";

// Reads any supported source into Pica entries. Pica's own file needs no conversion.
export function importMcpSource(input: McpLayerInput): ForeignImport {
  switch (input.format) {
    case "pica":
      return picaEntries(input.value);
    case "vscode":
      return importForeign(vscodeMcpFormat(vscodeContext(input)), input.source, input.value);
    case "mcp-json":
      return importForeign(mcpJsonFormat, input.source, input.value);
    case "copilot-cli":
      return importForeign(copilotCliMcpFormat, input.source, input.value);
  }
}

function vscodeContext(input: McpLayerInput): { root?: string; home?: string } {
  return {
    ...(input.root === undefined ? {} : { root: input.root }),
    ...(input.home === undefined ? {} : { home: input.home }),
  };
}

const picaTopLevelKeys = new Set(["$schema", "servers"]);

function picaEntries(value: unknown): ForeignImport {
  if (!isRecord(value)) {
    return { entries: [], notes: [], issues: [{ keyPath: "", message: "expected an object" }] };
  }
  const issues: ConfigIssue[] = Object.keys(value)
    .filter((key) => !picaTopLevelKeys.has(key))
    .map((key) => ({ keyPath: key, message: "unknown key" }));
  const servers = value["servers"];
  if (servers === undefined) {
    return { entries: [], notes: [], issues };
  }
  if (!isRecord(servers)) {
    return { entries: [], notes: [], issues: [...issues, { keyPath: "servers", message: "expected an object" }] };
  }
  const entries: McpServerEntryInput[] = [];
  for (const [id, entry] of Object.entries(servers)) {
    if (isRecord(entry)) {
      entries.push({ id, keyPath: ["servers", id], entry });
    } else {
      issues.push({ keyPath: `servers.${id}`, message: "expected an object" });
    }
  }
  return { entries, notes: [], issues };
}
