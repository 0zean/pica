import { joinPath } from "../policy/paths.ts";
import { shellPaths } from "../policy/shell-paths.ts";
import { targetPaths } from "../policy/target-paths.ts";
import type { PolicyContext, ToolCall } from "../policy/types.ts";

/**
 * Port: the path with every symlink resolved, walking components as the OS does (so `..` after a
 * symlink climbs from its target). A missing tail is kept as written. Never throws.
 */
export type RealPathResolver = (absolutePath: string) => Promise<string>;

/** The policy context with `realPaths` filled for every path `decide` will check on this call. */
export async function withRealPaths(
  call: ToolCall,
  context: PolicyContext,
  resolve: RealPathResolver,
): Promise<PolicyContext> {
  const paths = new Set(pathsToResolve(call, context));
  const entries = await Promise.all([...paths].map(async (path) => [path, await resolve(path)] as const));
  return { ...context, realPaths: new Map(entries) };
}

function pathsToResolve(call: ToolCall, context: PolicyContext): string[] {
  const { target } = call;
  const paths = [...context.writeRoots, ...context.referenceRoots];
  paths.push(...targetPaths(target).map((path) => joinPath(context.cwd, path)));
  if (target.kind === "shell") {
    for (const entry of shellPaths(target.command, joinPath(context.cwd, target.cwd))) {
      if (entry.path !== undefined) {
        paths.push(entry.path);
      }
    }
  }
  return paths;
}
