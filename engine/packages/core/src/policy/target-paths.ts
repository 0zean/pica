import type { ToolTarget } from "./types.ts";

/** The filesystem locations a call touches, unresolved. Shell commands count their working directory. */
export function targetPaths(target: ToolTarget): readonly string[] {
  switch (target.kind) {
    case "read":
    case "write":
      return [target.path];
    case "search":
      return target.paths;
    case "shell":
      return [target.cwd];
    case "mcp":
    case "other":
      return [];
  }
}
