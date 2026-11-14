import { lstat, readlink } from "node:fs/promises";
import type { RealPathResolver } from "@pica/core";

// The kernel's own limit on symlinks followed while resolving one path (MAXSYMLINKS on macOS).
const maxLinks = 32;

/**
 * Resolves component by component instead of `fs.realpath`, which normalizes `..` before following
 * links and fails on a missing path or a dangling link — exactly the cases a sandbox must see through.
 */
export const realPath: RealPathResolver = async (absolutePath) => {
  const pending = components(absolutePath);
  let resolved: string[] = [];
  let links = 0;
  // Past a missing component nothing below exists, so the rest is kept as written.
  let missing = false;
  for (let part = pending.shift(); part !== undefined; part = pending.shift()) {
    if (part === "..") {
      resolved.pop();
      continue;
    }
    const candidate = [...resolved, part];
    const entry: Entry = missing || links >= maxLinks ? "other" : await inspect(`/${candidate.join("/")}`);
    missing ||= entry === "missing";
    if (typeof entry === "string") {
      resolved = candidate;
      continue;
    }
    links += 1;
    pending.unshift(...components(entry.link));
    if (entry.link.startsWith("/")) {
      resolved = [];
    }
  }
  return `/${resolved.join("/")}`;
};

function components(path: string): string[] {
  return path.split("/").filter((part) => part !== "" && part !== ".");
}

type Entry = "missing" | "other" | { readonly link: string };

async function inspect(path: string): Promise<Entry> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? { link: await readlink(path) } : "other";
  } catch {
    return "missing";
  }
}
