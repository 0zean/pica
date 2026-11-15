import { join } from "node:path";
import type { McpImportFilePlatform } from "@pica/core";
import { copilotCliMcpConfigPath, projectMcpJsonPath, vscodeMcpConfigPath } from "./mcp-paths.ts";

// M-07: where other agent platforms keep MCP servers on macOS. Each path is from the platform's own
// documentation, cited beside its format in core/src/mcp/import/formats.ts. Codex
// (`~/.codex/config.toml`) is not read yet: it is TOML (PLAN.md M-07).
export interface McpImportFileLocation {
  readonly platform: McpImportFilePlatform;
  readonly file: string;
  // The project directory for a project file.
  readonly root?: string;
}

export function mcpImportFileLocations(homeDir: string, repoRoot?: string): McpImportFileLocation[] {
  const appSupport = join(homeDir, "Library", "Application Support");
  const locations: McpImportFileLocation[] = [
    { platform: "claude-desktop", file: join(appSupport, "Claude", "claude_desktop_config.json") },
    { platform: "claude-code", file: join(homeDir, ".claude.json") },
    { platform: "cursor", file: join(homeDir, ".cursor", "mcp.json") },
    { platform: "windsurf", file: join(homeDir, ".codeium", "windsurf", "mcp_config.json") },
    { platform: "vscode", file: join(appSupport, "Code", "User", "mcp.json") },
    { platform: "vscode", file: join(appSupport, "Code - Insiders", "User", "mcp.json") },
    { platform: "gemini-cli", file: join(homeDir, ".gemini", "settings.json") },
    { platform: "copilot-cli", file: copilotCliMcpConfigPath(homeDir) },
  ];
  if (repoRoot !== undefined) {
    locations.push(
      { platform: "mcp-json", file: projectMcpJsonPath(repoRoot), root: repoRoot },
      { platform: "vscode", file: vscodeMcpConfigPath(repoRoot), root: repoRoot },
      { platform: "cursor", file: join(repoRoot, ".cursor", "mcp.json"), root: repoRoot },
      { platform: "gemini-cli", file: join(repoRoot, ".gemini", "settings.json"), root: repoRoot },
    );
  }
  return locations;
}
