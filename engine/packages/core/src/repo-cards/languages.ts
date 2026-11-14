import type { LanguageShare } from "./types.ts";
import { baseName, byPath, isIgnored } from "./paths.ts";

const languageByExtension: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  swift: "Swift",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  m: "Objective-C",
  mm: "Objective-C",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  lua: "Lua",
};

export function languageOf(path: string): string | undefined {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return languageByExtension[name.slice(dot + 1).toLowerCase()];
}

// Ordered by file count, then name, so ties never depend on input order.
export function countLanguages(paths: readonly string[]): LanguageShare[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    if (isIgnored(path)) continue;
    const language = languageOf(path);
    if (language !== undefined) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || byPath(a.name, b.name));
}
