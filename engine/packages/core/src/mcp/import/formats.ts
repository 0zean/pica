import type { ForeignMcpFormat } from "./foreign.ts";
import { rewriteEnvVariables, rewriteVsCodeVariables } from "./variables.ts";
import type { VsCodeVariableContext } from "./variables.ts";

// `.vscode/mcp.json` (VS Code). `inputs` declares prompts; their answers are keychain secrets here.
export function vscodeMcpFormat(context: VsCodeVariableContext): ForeignMcpFormat {
  return {
    serversKey: "servers",
    topLevelKeys: new Set(["inputs"]),
    typeAliases: {},
    entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers"]),
    rewrite: (text) => rewriteVsCodeVariables(text, context),
  };
}

// `.mcp.json` at a repository root (project-scoped MCP servers).
export const mcpJsonFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: {},
  entryKeys: new Set(["type", "command", "args", "env", "url", "headers"]),
  rewrite: rewriteEnvVariables,
};

// `~/.copilot/mcp-config.json` (GitHub Copilot CLI). `tools: ["*"]` means every tool.
export const copilotCliMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: { local: "stdio" },
  entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers", "tools"]),
  rewrite: rewriteEnvVariables,
};
