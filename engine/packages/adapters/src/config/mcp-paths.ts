import { join } from "node:path";
import type { McpScope } from "@pica/protocol";
import type { McpSourceFormat } from "@pica/core";

// Pica's own MCP files sit beside config.jsonc (PLAN.md §4.6).
export function userMcpConfigPath(homeDir: string): string {
  return join(homeDir, "Library", "Application Support", "Pica", "mcp.jsonc");
}

// M-07: a workspace's servers, written by `mcp.import` at workspace scope.
export function workspaceMcpConfigPath(homeDir: string, workspaceId: string): string {
  return join(homeDir, "Library", "Application Support", "Pica", "workspaces", workspaceId, "mcp.jsonc");
}

export function repoMcpConfigPath(repoRoot: string): string {
  return join(repoRoot, ".pica", "mcp.jsonc");
}

export function vscodeMcpConfigPath(repoRoot: string): string {
  return join(repoRoot, ".vscode", "mcp.json");
}

export function projectMcpJsonPath(repoRoot: string): string {
  return join(repoRoot, ".mcp.json");
}

export function copilotCliMcpConfigPath(homeDir: string): string {
  return join(homeDir, ".copilot", "mcp-config.json");
}

export interface McpFileSource {
  readonly scope: McpScope;
  readonly format: McpSourceFormat;
  readonly file: string;
  readonly root?: string;
  readonly home?: string;
}

// Every file a session rooted in `repoRoot` reads, global first. With `workspaceId`, the
// workspace's own `mcp.jsonc` too; callers may also add workspace definitions as a value source.
export function mcpFileSources(homeDir: string, repoRoot?: string, workspaceId?: string): McpFileSource[] {
  const sources: McpFileSource[] = [
    { scope: "global", format: "copilot-cli", file: copilotCliMcpConfigPath(homeDir), home: homeDir },
    { scope: "global", format: "pica", file: userMcpConfigPath(homeDir), home: homeDir },
  ];
  if (workspaceId !== undefined) {
    sources.push({ scope: "workspace", format: "pica", file: workspaceMcpConfigPath(homeDir, workspaceId), home: homeDir });
  }
  if (repoRoot !== undefined) {
    sources.push(
      { scope: "repo", format: "mcp-json", file: projectMcpJsonPath(repoRoot), root: repoRoot, home: homeDir },
      { scope: "repo", format: "vscode", file: vscodeMcpConfigPath(repoRoot), root: repoRoot, home: homeDir },
      { scope: "repo", format: "pica", file: repoMcpConfigPath(repoRoot), root: repoRoot, home: homeDir },
    );
  }
  return sources;
}
