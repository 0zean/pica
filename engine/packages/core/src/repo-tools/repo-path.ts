import { err, ok, type Result } from "../result.ts";
import { repoToolError, type RepoToolError } from "./errors.ts";

// A path relative to a repo root, normalized; "" is the root itself. Absolute paths and paths that
// climb above the root are refused before anything touches the filesystem.
export function repoRelativePath(path: string): Result<string, RepoToolError> {
  if (path.startsWith("/") || path.startsWith("~")) {
    return err(outside(path));
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return err(outside(path));
      continue;
    }
    parts.push(part);
  }
  return ok(parts.join("/"));
}

export function joinRepoPath(root: string, relative: string): string {
  const base = root.replace(/\/+$/, "");
  return relative === "" ? base : `${base}/${relative}`;
}

export function outside(path: string): RepoToolError {
  return repoToolError("repo_tools.outside_workspace", `"${path}" is outside the workspace repos`);
}
