import type { McpServerDef } from "@pica/protocol";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { mcpAttachmentError } from "./errors.ts";
import type { McpAttachmentError, McpAttachmentIssue } from "./errors.ts";
import type { AttachedMcpServer, McpAttachment, McpAttachmentPlan, McpAttachmentTarget } from "./types.ts";

// Builds what each part of a session may see. A server reaches the session or an agent only
// through an attachment; attaching the same server twice to one target joins the tool lists.
export function attachMcpServers(
  servers: readonly McpServerDef[],
  agents: readonly string[],
  attachments: readonly McpAttachment[],
): Result<McpAttachmentPlan, McpAttachmentError> {
  const definitions = new Map(servers.map((server) => [server.id, server]));
  const knownAgents = new Set(agents);
  const issues: McpAttachmentIssue[] = [];
  const byTarget = new Map<string, Map<string, AttachedMcpServer>>();
  for (const attachment of attachments) {
    const target = targetLabel(attachment.target);
    const checked = checkAttachment(attachment, definitions.get(attachment.serverId), knownAgents);
    if (!checked.ok) {
      issues.push({ serverId: attachment.serverId, target, ...checked.error });
      continue;
    }
    const definition = checked.value;
    const attached = byTarget.get(target) ?? new Map<string, AttachedMcpServer>();
    const tools = joinTools(attached.get(definition.id)?.tools, effectiveTools(definition, attachment.tools));
    attached.set(definition.id, { definition, tools });
    byTarget.set(target, attached);
  }
  if (issues.length > 0) {
    return err(mcpAttachmentError(issues));
  }
  return ok({
    session: sortedServers(byTarget.get(targetLabel({ kind: "session" }))),
    agents: [...knownAgents].sort().map((agent) => ({
      agent,
      servers: sortedServers(byTarget.get(targetLabel({ kind: "agent", agent }))),
    })),
  });
}

type Problem = Pick<McpAttachmentIssue, "code" | "message">;

function checkAttachment(
  attachment: McpAttachment,
  definition: McpServerDef | undefined,
  knownAgents: ReadonlySet<string>,
): Result<McpServerDef, Problem> {
  if (attachment.target.kind === "agent" && !knownAgents.has(attachment.target.agent)) {
    return err({ code: "mcp_attach.unknown_agent", message: `no agent named "${attachment.target.agent}"` });
  }
  if (definition === undefined) {
    return err({ code: "mcp_attach.unknown_server", message: "no MCP server with this id is defined" });
  }
  if (attachment.tools === null) {
    return ok(definition);
  }
  if (attachment.tools.length === 0) {
    return err({ code: "mcp_attach.empty_allowlist", message: "a tool allowlist must name at least one tool" });
  }
  const allowed = definition.toolAllowlist;
  const outside = allowed === null ? [] : attachment.tools.filter((tool) => !allowed.includes(tool));
  if (outside.length > 0) {
    return err({
      code: "mcp_attach.tool_not_allowed",
      message: `not in the server's tool allowlist: ${[...new Set(outside)].sort().join(", ")}`,
    });
  }
  return ok(definition);
}

export function targetLabel(target: McpAttachmentTarget): string {
  return target.kind === "session" ? "session" : `agent:${target.agent}`;
}

function effectiveTools(definition: McpServerDef, requested: readonly string[] | null): readonly string[] | null {
  const tools = requested ?? definition.toolAllowlist;
  return tools === null ? null : [...new Set(tools)].sort();
}

function joinTools(
  current: readonly string[] | null | undefined,
  added: readonly string[] | null,
): readonly string[] | null {
  if (current === undefined) {
    return added;
  }
  if (current === null || added === null) {
    return null;
  }
  return [...new Set([...current, ...added])].sort();
}

function sortedServers(attached: ReadonlyMap<string, AttachedMcpServer> | undefined): AttachedMcpServer[] {
  return [...(attached?.values() ?? [])].sort((a, b) => compare(a.definition.id, b.definition.id));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
