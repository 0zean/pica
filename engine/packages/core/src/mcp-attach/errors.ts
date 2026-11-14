export type McpAttachmentIssueCode =
  | "mcp_attach.unknown_server"
  | "mcp_attach.unknown_agent"
  | "mcp_attach.tool_not_allowed"
  | "mcp_attach.empty_allowlist"
  | "mcp_attach.not_in_managed_allowlist";

export interface McpAttachmentIssue {
  readonly code: McpAttachmentIssueCode;
  readonly serverId: string;
  // "session" or "agent:<name>".
  readonly target: string;
  readonly message: string;
  // Set when a managed policy refused the attachment, e.g. "managed:org-mcp".
  readonly policy?: string;
}

export interface McpAttachmentError {
  readonly code: "mcp_attach.invalid";
  readonly message: string;
  readonly issues: readonly McpAttachmentIssue[];
}

export function mcpAttachmentError(issues: readonly McpAttachmentIssue[]): McpAttachmentError {
  const lines = issues.map((issue) => `${issue.target}: ${issue.serverId}: ${issue.message}`);
  return { code: "mcp_attach.invalid", issues, message: lines.join("\n") };
}
