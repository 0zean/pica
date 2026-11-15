// True when `path` is `prefix` or a key path below it.
export function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

// `/Users/me/.cursor/mcp.json` → `~/.cursor/mcp.json`, so recorded origins carry no home directory.
export function homeRelative(path: string, home: string | undefined): string {
  if (home === undefined || home === "" || home === "/") {
    return path;
  }
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  return path === base ? "~" : path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}
