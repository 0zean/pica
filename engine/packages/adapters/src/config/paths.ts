import { join } from "node:path";

// PLAN.md §4.6.
export function userConfigPath(homeDir: string): string {
  return join(homeDir, "Library", "Application Support", "Pica", "config.jsonc");
}

export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, ".pica", "config.jsonc");
}
