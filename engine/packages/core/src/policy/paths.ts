// Lexical POSIX path handling only: core does no I/O, so symlinks are the sandbox's concern (R-07).

export function resolvePath(cwd: string, path: string): string {
  const joined = path.startsWith("/") ? path : `${cwd}/${path}`;
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
