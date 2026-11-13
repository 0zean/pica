import { join } from "node:path";
import { parseArgs } from "node:util";
import { findAppViolations } from "./app-graph.ts";
import { findEngineViolations } from "./engine-imports.ts";
import type { Violation } from "./violation.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

const { values } = parseArgs({
  options: {
    engine: { type: "string" },
    app: { type: "string" },
  },
});

const checkBoth = values.engine === undefined && values.app === undefined;
const enginePackages = values.engine ?? (checkBoth ? join(repoRoot, "engine", "packages") : undefined);
const appPackages = values.app ?? (checkBoth ? join(repoRoot, "app", "Packages") : undefined);

const violations: Violation[] = [
  ...(enginePackages === undefined ? [] : findEngineViolations(enginePackages)),
  ...(appPackages === undefined ? [] : findAppViolations(appPackages)),
];

for (const violation of violations) {
  console.error(`${violation.file}: ${violation.message}`);
}
if (violations.length > 0) {
  console.error(`lint-arch: ${String(violations.length)} violation(s)`);
  process.exitCode = 1;
}
