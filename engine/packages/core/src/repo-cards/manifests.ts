import { baseName, byDepthThenPath, depth, isIgnored } from "./paths.ts";

const manifestNames = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "go.mod",
  "go.work",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "Package.swift",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "Gemfile",
  "composer.json",
  "Makefile",
]);

const maxManifestDepth = 3;

// GitHub's precedence order for CODEOWNERS.
export const codeownersPaths = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;

const rootFilesRead = ["package.json", "pyproject.toml", "setup.cfg", "requirements.txt", "Package.swift", "Makefile"];

export function findManifests(paths: readonly string[]): string[] {
  return paths
    .filter((path) => depth(path) <= maxManifestDepth && !isIgnored(path) && manifestNames.has(baseName(path)))
    .sort(byDepthThenPath);
}

// The files whose contents a card needs, in a fixed order.
export function cardInputFiles(paths: readonly string[]): string[] {
  const present = new Set(paths);
  return [...rootFilesRead, ...codeownersPaths].filter((path) => present.has(path));
}
