import type { JsonValue } from "../json.ts";
import type { AttachedMcpServer, McpAttachmentPlan, McpToolCatalog, McpToolDefinition } from "./types.ts";

// The method and its constants are described in docs/mcp-tool-budgets.md.
export const mcpBytesPerToken = 4;
export const mcpToolOverheadTokens = 4;

export interface McpServerTokenEstimate {
  readonly serverId: string;
  // Null when the catalog has no tool list for the server yet.
  readonly toolCount: number | null;
  readonly tokens: number | null;
}

export interface McpTokenEstimate {
  // Sum over servers whose tool list is known.
  readonly tokens: number;
  readonly complete: boolean;
  readonly servers: readonly McpServerTokenEstimate[];
}

export interface McpPlanTokenEstimate {
  readonly session: McpTokenEstimate;
  readonly agents: readonly { readonly agent: string; readonly estimate: McpTokenEstimate }[];
}

export function estimateMcpToolTokens(serverId: string, tool: McpToolDefinition): number {
  const payload: Record<string, JsonValue> = { name: `${serverId}/${tool.name}`, input_schema: tool.inputSchema };
  if (tool.description !== undefined) {
    payload.description = tool.description;
  }
  return Math.ceil(utf8Length(canonicalJson(payload)) / mcpBytesPerToken) + mcpToolOverheadTokens;
}

export function estimateMcpToolListTokens(serverId: string, tools: readonly McpToolDefinition[]): number {
  return tools.reduce((sum, tool) => sum + estimateMcpToolTokens(serverId, tool), 0);
}

// The tools of an attached server that its target can see: the catalog's list, cut to the
// attachment's allowlist. Undefined when the catalog does not know the server.
export function visibleMcpTools(server: AttachedMcpServer, catalog: McpToolCatalog): McpToolDefinition[] | undefined {
  const listed = catalog[server.definition.id];
  if (listed === undefined) {
    return undefined;
  }
  const allowed = server.tools;
  return allowed === null ? [...listed] : listed.filter((tool) => allowed.includes(tool.name));
}

export function estimateMcpServersTokens(servers: readonly AttachedMcpServer[], catalog: McpToolCatalog): McpTokenEstimate {
  const estimates = servers.map((server): McpServerTokenEstimate => {
    const serverId = server.definition.id;
    const tools = visibleMcpTools(server, catalog);
    return tools === undefined
      ? { serverId, toolCount: null, tokens: null }
      : { serverId, toolCount: tools.length, tokens: estimateMcpToolListTokens(serverId, tools) };
  });
  return {
    tokens: estimates.reduce((sum, estimate) => sum + (estimate.tokens ?? 0), 0),
    complete: estimates.every((estimate) => estimate.tokens !== null),
    servers: estimates,
  };
}

export function estimateMcpPlanTokens(plan: McpAttachmentPlan, catalog: McpToolCatalog): McpPlanTokenEstimate {
  return {
    session: estimateMcpServersTokens(plan.session, catalog),
    agents: plan.agents.map((agent) => ({ agent: agent.agent, estimate: estimateMcpServersTokens(agent.servers, catalog) })),
  };
}

// JSON with object keys sorted and no whitespace, so the estimate does not depend on key order.
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`);
  return `{${entries.join(",")}}`;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}
