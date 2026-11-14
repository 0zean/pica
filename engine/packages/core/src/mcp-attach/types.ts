import type { McpServerDef } from "@pica/protocol";
import type { JsonObject } from "../json.ts";

// Servers attach to the whole session or to one agent, never globally (PLAN.md §5.3, "MCP fan-in").
export type McpAttachmentTarget =
  | { readonly kind: "session" }
  | { readonly kind: "agent"; readonly agent: string };

export interface McpAttachment {
  readonly serverId: string;
  readonly target: McpAttachmentTarget;
  // Narrows the server's own allowlist; null keeps it.
  readonly tools: readonly string[] | null;
}

export interface AttachedMcpServer {
  readonly definition: McpServerDef;
  // Sorted tool names the target may call; null means every tool the server offers.
  readonly tools: readonly string[] | null;
}

export interface AgentMcpServers {
  readonly agent: string;
  // Sorted by server id.
  readonly servers: readonly AttachedMcpServer[];
}

export interface McpAttachmentPlan {
  // Sorted by server id.
  readonly session: readonly AttachedMcpServer[];
  // One entry per known agent, sorted by agent name.
  readonly agents: readonly AgentMcpServers[];
}

// A tool as an MCP server lists it in `tools/list`.
export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly annotations?: McpToolAnnotations;
}

// MCP tool annotations (spec 2025-03-26 and later). Hints only; see docs/mcp-permissions.md.
export interface McpToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

// Tool lists by server id, from M-06's health checks or a fixture.
export type McpToolCatalog = Readonly<Record<string, readonly McpToolDefinition[]>>;
