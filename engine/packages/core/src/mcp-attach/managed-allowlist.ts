import type { McpServerDef } from "@pica/protocol";
import type { ManagedMcpAllowlist, ManagedMcpServer } from "../policy/index.ts";
import type { McpAttachmentIssue } from "./errors.ts";

type Problem = Pick<McpAttachmentIssue, "code" | "message" | "policy">;

export function managedAllowlistProblem(definition: McpServerDef, allowlist: ManagedMcpAllowlist): Problem | undefined {
  const policy = `managed:${allowlist.id}`;
  const entry = allowlist.servers.find((server) => server.id === definition.id);
  if (entry === undefined) {
    return { code: "mcp_attach.not_in_managed_allowlist", policy, message: `not on the managed MCP allowlist (policy ${policy})` };
  }
  if (!pinMatches(entry, definition)) {
    return {
      code: "mcp_attach.not_in_managed_allowlist",
      policy,
      message: `endpoint differs from the managed MCP allowlist entry (policy ${policy})`,
    };
  }
  return undefined;
}

function pinMatches(entry: ManagedMcpServer, definition: McpServerDef): boolean {
  const { transport } = definition;
  if (transport.type === "stdio") {
    return entry.url === undefined && (entry.command === undefined || entry.command === transport.command);
  }
  return entry.command === undefined && (entry.url === undefined || entry.url === transport.url);
}
