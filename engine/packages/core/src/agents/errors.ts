export type AgentErrorCode = "agents.read_failed" | "agents.parse_error" | "agents.invalid";

export interface AgentIssue {
  readonly file: string;
  readonly field: string;
  readonly message: string;
}

export interface AgentError {
  readonly code: AgentErrorCode;
  readonly message: string;
  readonly issues: readonly AgentIssue[];
}

export function agentError(code: AgentErrorCode, issues: readonly AgentIssue[]): AgentError {
  const lines = issues.map((issue) => `${issue.file}: ${issue.field || "(file)"}: ${issue.message}`);
  return { code, issues, message: lines.join("\n") };
}
