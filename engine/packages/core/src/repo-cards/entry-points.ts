import { languageOf } from "./languages.ts";
import type { PackageJson } from "./package-json.ts";
import { baseName, byDepthThenPath, depth, isIgnored, segments } from "./paths.ts";

interface EntryInputs {
  readonly paths: readonly string[];
  readonly files: ReadonlyMap<string, string>;
  readonly packageJson: PackageJson | undefined;
}

const rootStems = new Set(["main", "index", "app", "cli", "server", "manage"]);

function isConventionalEntry(path: string): boolean {
  const parts = segments(path);
  const name = baseName(path);
  const stem = name.slice(0, name.lastIndexOf("."));
  if (languageOf(path) === undefined) return false;
  if (parts.length === 1) return rootStems.has(stem);
  if (parts.length === 2 && parts[0] === "src") return rootStems.has(stem) || name === "lib.rs";
  if (parts.length === 3 && parts[0] === "cmd") return name === "main.go";
  if (parts.length === 3 && parts[0] === "Sources") return name === "main.swift";
  if (name === "__main__.py") return depth(path) <= 3;
  if (parts[0] === "src" && parts[1] === "main") return stem === "Main" || stem === "Application";
  return false;
}

// `[project.scripts]` (PEP 621) and `[tool.poetry.scripts]` tables: `name = "module:function"`.
export function pythonScripts(pyproject: string): string[] {
  const scripts: string[] = [];
  let inScripts = false;
  for (const line of pyproject.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inScripts = trimmed === "[project.scripts]" || trimmed === "[tool.poetry.scripts]";
      continue;
    }
    const match = inScripts ? /^["']?([\w.-]+)["']?\s*=\s*["']([^"']+)["']/.exec(trimmed) : null;
    if (match?.[1] !== undefined && match[2] !== undefined) scripts.push(`${match[2]} (${match[1]})`);
  }
  return scripts;
}

export function swiftExecutables(manifest: string): string[] {
  return [...manifest.matchAll(/\.executableTarget\(\s*name:\s*"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [`${match[1]} (executable target)`],
  );
}

// Declared entry points first, in manifest order; then conventional files, shallowest first.
export function detectEntryPoints(inputs: EntryInputs): string[] {
  const declared = [
    ...(inputs.packageJson?.entries ?? []),
    ...pythonScripts(inputs.files.get("pyproject.toml") ?? ""),
    ...swiftExecutables(inputs.files.get("Package.swift") ?? ""),
  ];
  const conventional = inputs.paths
    .filter((path) => !isIgnored(path) && isConventionalEntry(path))
    .sort(byDepthThenPath);
  return [...new Set([...declared, ...conventional])];
}
