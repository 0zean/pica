import type { PolicyContext } from "./types.ts";

// Lexical POSIX path handling. Symlinks are resolved outside core (sandbox/) and arrive as
// `PolicyContext.realPaths`, keyed by the unnormalized absolute path.

export function resolvePath(cwd: string, path: string): string {
  const joined = joinPath(cwd, path);
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

export function isInside(path: string, root: string): boolean {
  const prefix = root === "/" ? "/" : `${root}/`;
  return path === root || path.startsWith(prefix);
}

export function isInsideAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInside(path, root));
}

export function joinPath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : `${cwd}/${path}`;
}

export function realPath(path: string, context: Pick<PolicyContext, "realPaths">): string {
  return context.realPaths?.get(path) ?? resolvePath("/", path);
}
