const ignoredSegments = new Set([
  "node_modules",
  "vendor",
  "third_party",
  "third-party",
  "dist",
  "build",
  "out",
  "Pods",
  ".build",
  ".venv",
  "venv",
  "__pycache__",
]);

export function byPath(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function segments(path: string): readonly string[] {
  return path.split("/");
}

export function baseName(path: string): string {
  const parts = segments(path);
  return parts[parts.length - 1] ?? path;
}

export function depth(path: string): number {
  return segments(path).length;
}

export function isIgnored(path: string): boolean {
  return segments(path).some((segment) => ignoredSegments.has(segment));
}

// Shallow paths first, then by path, so the most relevant entries survive truncation.
export function byDepthThenPath(a: string, b: string): number {
  return depth(a) - depth(b) || byPath(a, b);
}
