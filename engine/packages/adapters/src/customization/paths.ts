import { join } from "node:path";

// The Copilot runtime's own user folders (`~/.copilot`), which it reads in every session.
export function userSkillsDir(homeDir: string): string {
  return join(homeDir, ".copilot", "skills");
}

export function userInstructionsFile(homeDir: string): string {
  return join(homeDir, ".copilot", "copilot-instructions.md");
}

// Beside the workspace's `mcp.jsonc` (A-13).
export function workspaceAgentsDir(homeDir: string, workspaceId: string): string {
  return join(homeDir, "Library", "Application Support", "Pica", "workspaces", workspaceId, "agents");
}
