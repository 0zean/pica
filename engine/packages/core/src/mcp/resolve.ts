import type { McpScope } from "@pica/protocol";
import type { ConfigError } from "../config/errors.ts";
import { configError } from "../config/errors.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { buildMcpDefinitions } from "./definitions.ts";
import { importMcpSource } from "./import/index.ts";
import type { McpImportNote, McpLayerInput, McpSourceFormat, ResolvedMcpRegistry, ResolvedMcpServer } from "./types.ts";

// Lowest to highest, the same order as config layers (PLAN.md §4.6): user (global), workspace, repo.
export const mcpScopePrecedence: readonly McpScope[] = ["global", "workspace", "repo"];

// Within one scope, Pica's own file beats files it imports from other tools.
export const mcpFormatPrecedence: readonly McpSourceFormat[] = ["copilot-cli", "mcp-json", "vscode", "pica"];

// A server id defined in a higher-precedence source replaces the lower definition whole.
export function resolveMcpServers(inputs: readonly McpLayerInput[]): Result<ResolvedMcpRegistry, ConfigError> {
  const servers = new Map<string, ResolvedMcpServer>();
  const notes: McpImportNote[] = [];
  for (const input of [...inputs].sort((a, b) => rank(a) - rank(b))) {
    const imported = importMcpSource(input);
    if (imported.issues.length > 0) {
      return err(configError("config.invalid", input.source, imported.issues));
    }
    const definitions = buildMcpDefinitions(input.source, input.scope, imported.entries);
    if (!definitions.ok) {
      return definitions;
    }
    notes.push(...imported.notes);
    const origin = { scope: input.scope, format: input.format, source: input.source };
    for (const definition of definitions.value) {
      const lower = servers.get(definition.id);
      const shadowed = lower === undefined ? [] : [lower.origin, ...lower.shadowed];
      servers.set(definition.id, { definition, origin, shadowed });
    }
  }
  const sorted = [...servers.values()].sort((a, b) => compare(a.definition.id, b.definition.id));
  return ok({ servers: sorted, notes });
}

function rank(input: McpLayerInput): number {
  return mcpScopePrecedence.indexOf(input.scope) * mcpFormatPrecedence.length + mcpFormatPrecedence.indexOf(input.format);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
