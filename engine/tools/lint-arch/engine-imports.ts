import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { Violation } from "./violation.ts";

// PLAN.md §4.3. Only `server` and `cli` construct adapters, so only they may import them.
const allowedWorkspaceImports: Readonly<Record<string, readonly string[]>> = {
  protocol: [],
  core: ["protocol"],
  adapters: ["protocol", "core"],
  testkit: ["protocol", "core"],
  server: ["protocol", "core", "adapters"],
  cli: ["protocol", "core", "adapters", "server"],
  evals: ["protocol", "core", "testkit", "server"],
};

const packagesWithoutIo = new Set(["protocol", "core"]);
const packagesWithoutThirdParty = new Set(["core"]);

export function findEngineViolations(packagesDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const packageName of readdirSync(packagesDir).sort()) {
    const srcDir = join(packagesDir, packageName, "src");
    if (!(packageName in allowedWorkspaceImports)) {
      violations.push({
        file: join(packagesDir, packageName),
        message: `package "${packageName}" has no layering rule; add it to engine-imports.ts`,
      });
      continue;
    }
    for (const file of listTypeScriptFiles(srcDir)) {
      for (const specifier of importSpecifiers(file)) {
        const message = checkImport(packageName, srcDir, file, specifier);
        if (message !== undefined) {
          violations.push({ file, message });
        }
      }
    }
  }
  return violations;
}

function checkImport(
  packageName: string,
  srcDir: string,
  file: string,
  specifier: string,
): string | undefined {
  if (specifier.startsWith(".")) {
    return checkRelativeImport(packageName, srcDir, file, specifier);
  }
  if (specifier.startsWith("@pica/")) {
    const target = specifier.slice("@pica/".length).split("/")[0] ?? "";
    const allowed = allowedWorkspaceImports[packageName] ?? [];
    return allowed.includes(target)
      ? undefined
      : `${packageName} must not import @pica/${target}`;
  }
  if (isBuiltin(specifier)) {
    return packagesWithoutIo.has(packageName)
      ? `${packageName} must not import the Node module "${specifier}"`
      : undefined;
  }
  return packagesWithoutThirdParty.has(packageName)
    ? `${packageName} must not import the third-party module "${specifier}"`
    : undefined;
}

function checkRelativeImport(
  packageName: string,
  srcDir: string,
  file: string,
  specifier: string,
): string | undefined {
  const target = resolve(dirname(file), specifier);
  const packageDir = dirname(srcDir);
  if (!isInside(target, packageDir)) {
    return `relative import "${specifier}" leaves package ${packageName}; import it by package name`;
  }
  if (packageName !== "adapters") {
    return undefined;
  }
  const fromAdapter = adapterName(srcDir, file);
  const toAdapter = adapterName(srcDir, target);
  if (fromAdapter !== undefined && toAdapter !== undefined && fromAdapter !== toAdapter) {
    return `adapter "${fromAdapter}" must not import adapter "${toAdapter}"`;
  }
  return undefined;
}

// An adapter is a top-level directory under adapters/src; files directly in src belong to none.
function adapterName(srcDir: string, path: string): string | undefined {
  const parts = relative(srcDir, path).split(sep);
  return parts.length > 1 && parts[0] !== ".." ? parts[0] : undefined;
}

function isInside(path: string, dir: string): boolean {
  const fromDir = relative(dir, path);
  return fromDir !== "" && !fromDir.startsWith("..");
}

function importSpecifiers(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return info.importedFiles.map((imported) => imported.fileName);
}

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .sort()
    .map((path) => join(dir, path));
}
