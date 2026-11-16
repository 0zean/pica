import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Violation } from "./violation.ts";

// PLAN.md §4.3. Features holds one target per feature; feature targets never depend on each other.
const allowedPackageDependencies: Readonly<Record<string, readonly string[]>> = {
  PicaProtocol: [],
  EngineClient: ["PicaProtocol"],
  DesignSystem: [],
  // A-01: launch, engine supervision and the app-wide store; the same footing as a feature.
  AppShell: ["EngineClient", "PicaProtocol", "DesignSystem"],
  Features: ["EngineClient", "PicaProtocol", "DesignSystem"],
};

const featuresPackage = "Features";

interface Manifest {
  readonly name: string;
  readonly dependencies: readonly { readonly fileSystem?: readonly { readonly path: string }[] }[];
  readonly targets: readonly Target[];
}

interface Target {
  readonly name: string;
  readonly type: string;
  readonly path?: string | null;
  readonly dependencies: readonly TargetDependency[];
}

interface TargetDependency {
  readonly byName?: readonly [string, unknown];
  readonly target?: readonly [string, unknown];
}

export function findAppViolations(packagesDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const entry of readdirSync(packagesDir).sort()) {
    const packageDir = join(packagesDir, entry);
    if (!existsSync(join(packageDir, "Package.swift"))) {
      continue;
    }
    const manifest = readManifest(packageDir);
    violations.push(...checkPackageDependencies(packageDir, manifest));
    if (manifest.name === featuresPackage) {
      violations.push(...checkFeatureTargets(packageDir, manifest));
    }
  }
  return violations;
}

function readManifest(packageDir: string): Manifest {
  const json = execFileSync("swift", ["package", "dump-package", "--package-path", packageDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(json) as Manifest;
}

function checkPackageDependencies(packageDir: string, manifest: Manifest): Violation[] {
  const file = join(packageDir, "Package.swift");
  const allowed = allowedPackageDependencies[manifest.name];
  if (allowed === undefined) {
    return [{ file, message: `package ${manifest.name} has no layering rule; add it to app-graph.ts` }];
  }
  const localDependencies = manifest.dependencies.flatMap((dependency) =>
    (dependency.fileSystem ?? []).map((local) => basename(local.path)),
  );
  return localDependencies
    .filter((dependency) => !allowed.includes(dependency))
    .map((dependency) => ({ file, message: `${manifest.name} must not depend on ${dependency}` }));
}

function checkFeatureTargets(packageDir: string, manifest: Manifest): Violation[] {
  const features = manifest.targets.filter((target) => target.type === "regular");
  const featureNames = new Set(features.map((feature) => feature.name));
  const violations: Violation[] = [];
  for (const feature of features) {
    const file = join(packageDir, "Package.swift");
    for (const dependency of feature.dependencies) {
      const name = dependency.byName?.[0] ?? dependency.target?.[0];
      if (name !== undefined && featureNames.has(name)) {
        violations.push({ file, message: `feature ${feature.name} must not depend on feature ${name}` });
      }
    }
    violations.push(...checkFeatureImports(packageDir, feature, featureNames));
  }
  return violations;
}

function checkFeatureImports(
  packageDir: string,
  feature: Target,
  featureNames: ReadonlySet<string>,
): Violation[] {
  const sourceDir = join(packageDir, feature.path ?? join("Sources", feature.name));
  if (!existsSync(sourceDir)) {
    return [];
  }
  const violations: Violation[] = [];
  for (const path of readdirSync(sourceDir, { recursive: true, encoding: "utf8" })) {
    if (!path.endsWith(".swift")) {
      continue;
    }
    const file = join(sourceDir, path);
    for (const imported of swiftImports(readFileSync(file, "utf8"))) {
      if (imported !== feature.name && featureNames.has(imported)) {
        violations.push({ file, message: `feature ${feature.name} must not import feature ${imported}` });
      }
    }
  }
  return violations;
}

function swiftImports(source: string): string[] {
  const pattern = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*import\s+(?:(?:struct|class|enum|protocol|typealias|func|var|let)\s+)?(\w+)/gm;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}
