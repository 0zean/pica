import type { ToolTarget } from "../policy/index.ts";
import type { McpToolDefinition } from "./types.ts";

// The policy target for a call to `serverId/toolName`. A tool is read-class only when its server
// marks it `readOnlyHint: true`; an unknown tool counts as write-class.
export function mcpToolTarget(serverId: string, toolName: string, definition: McpToolDefinition | undefined): ToolTarget {
  return { kind: "mcp", server: serverId, tool: toolName, readOnly: definition?.annotations?.readOnlyHint === true };
}
