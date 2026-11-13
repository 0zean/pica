import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const builtinAgentsDir = fileURLToPath(new URL("./builtin", import.meta.url));

export function userAgentsDir(homeDir: string): string {
  return join(homeDir, "Library", "Application Support", "Pica", "agents");
}

export function repoAgentsDir(repoRoot: string): string {
  return join(repoRoot, ".pica", "agents");
}

export function githubAgentsDir(repoRoot: string): string {
  return join(repoRoot, ".github", "agents");
}
