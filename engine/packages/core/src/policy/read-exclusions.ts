import { isInside, resolvePath } from "./paths.ts";
import type { PolicyContext } from "./types.ts";

// `routing.delegation.read.exclude`: an absolute pattern matches the resolved path; a relative one
// matches the path relative to whichever session root contains it.
export function isExcludedRead(path: string, context: PolicyContext): boolean {
  const { exclude } = context.config.routing.delegation.read;
  if (exclude.length === 0) {
    return false;
  }
  const absolute = resolvePath(context.cwd, path);
  const relative = [...context.writeRoots, ...context.referenceRoots]
    .filter((root) => isInside(absolute, root))
    .map((root) => absolute.slice(root.length).replace(/^\//, ""));
  return exclude.some((pattern) => {
    const matcher = globPattern(pattern);
    return pattern.startsWith("/") ? matcher.test(absolute) : relative.some((candidate) => matcher.test(candidate));
  });
}

// `**` spans directories, `*` and `?` stay within one path segment.
export function globPattern(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}
