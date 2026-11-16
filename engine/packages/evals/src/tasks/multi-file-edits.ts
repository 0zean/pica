import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { allOf, fail, filesUnder, modulesLoad, pass, readText, runNodeTests } from "../check-helpers.ts";
import type { CheckResult } from "../check-helpers.ts";
import { fixtureFile, fixtureFiles } from "../fixture-repos.ts";
import type { EvalTask } from "./task.ts";

function rewrite(workdir: string, path: string, change: (text: string) => string): void {
  const file = join(workdir, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
}

function hasNo(workdir: string, files: readonly string[], text: string): CheckResult {
  const left = files.filter((file) => readText(workdir, file)?.includes(text) === true);
  return left.length === 0 ? pass(`no ${text} left`) : fail(`${text} is still in ${String(left.length)} files, such as ${left.slice(0, 3).join(", ")}`);
}

// The import of `src/logger.mjs` as written from `file`.
function loggerSpecifier(file: string): string {
  const path = relative(dirname(file), "src/logger.mjs");
  return path.startsWith(".") ? path : `./${path}`;
}

const licenseLine = "// SPDX-License-Identifier: Apache-2.0";
const ledgerModules = (): string[] => fixtureFiles("ledger-service", "src", ".mjs");
const toolkitModules = (): string[] => fixtureFiles("web-toolkit", "src", ".mjs");
// The ledger modules that log, which the logger task changes: every one but the logger itself.
const loggingModules = (): string[] =>
  ledgerModules().filter((file) => file !== "src/logger.mjs" && fixtureFile("ledger-service", file).includes("console.log("));

// Multi-file mechanical edits: the same change across many files, with nothing broken.
export const multiFileEditTasks: readonly EvalTask[] = [
  {
    id: "rename-fmt-cents",
    category: "multi-file-edit",
    repo: "ledger-service",
    prompt: "Rename fmtCents to formatCents everywhere in src/ and test/, keeping behaviour the same. The tests must still pass.",
    check: ({ workdir }) => {
      const files = [...filesUnder(workdir, "src", ".mjs"), ...filesUnder(workdir, "test", ".mjs")];
      return allOf(
        "fmtCents is renamed to formatCents everywhere, every module loads, and the tests pass",
        () => hasNo(workdir, files, "fmtCents"),
        () => (readText(workdir, "src/money.mjs")?.includes("export function formatCents(") === true ? pass("exported") : fail("src/money.mjs does not export formatCents")),
        () => modulesLoad(workdir, ledgerModules()),
        () => runNodeTests(workdir),
      );
    },
    solve: (workdir) => {
      const files = [...filesUnder(workdir, "src", ".mjs"), ...filesUnder(workdir, "test", ".mjs")];
      for (const path of files) {
        rewrite(workdir, path, (text) => text.replaceAll("fmtCents", "formatCents"));
      }
      return `Renamed fmtCents to formatCents in ${String(files.length)} files.`;
    },
  },
  {
    id: "console-to-logger",
    category: "multi-file-edit",
    repo: "ledger-service",
    prompt:
      "In src/, replace every console.log call outside src/logger.mjs with logger.info, importing logger from " +
      "src/logger.mjs (by a relative path) in each file you change. Leave src/logger.mjs as it is.",
    check: ({ workdir }) => {
      const others = filesUnder(workdir, "src", ".mjs").filter((file) => file !== "src/logger.mjs");
      return allOf(
        "console.log is replaced by logger.info, every module loads, and the tests pass",
        () => hasNo(workdir, others, "console.log"),
        () => {
          const missing = loggingModules().filter((file) => {
            const text = readText(workdir, file) ?? "";
            const specifier = loggerSpecifier(file).replace(/[.]/g, "\\.");
            return !(text.includes("logger.info(") && new RegExp(`import\\s*\\{\\s*logger\\s*\\}\\s*from\\s*["']${specifier}["']`).test(text));
          });
          return missing.length === 0 ? pass("imports logger") : fail(`no logger import or call in ${String(missing.length)} files, such as ${missing.slice(0, 3).join(", ")}`);
        },
        () => modulesLoad(workdir, ledgerModules()),
        () => runNodeTests(workdir),
      );
    },
    solve: (workdir) => {
      const files = loggingModules();
      for (const path of files) {
        rewrite(workdir, path, (text) => `import { logger } from "${loggerSpecifier(path)}";\n${text.replaceAll("console.log(", "logger.info(")}`);
      }
      return `Replaced console.log with logger.info in ${String(files.length)} files.`;
    },
  },
  {
    id: "license-headers",
    category: "multi-file-edit",
    repo: "web-toolkit",
    prompt: `Add the line \`${licenseLine}\` as the first line of every .mjs file in src/, changing nothing else.`,
    check: ({ workdir }) => {
      const files = toolkitModules();
      const wrong = files.filter((file) => readText(workdir, file) !== `${licenseLine}\n${fixtureFile("web-toolkit", file)}`);
      return allOf(
        "every module starts with the license line and is otherwise unchanged",
        () => (wrong.length === 0 ? pass("headers") : fail(`header missing or file changed in ${String(wrong.length)} files, such as ${wrong.slice(0, 3).join(", ")}`)),
        () => modulesLoad(workdir, files),
      );
    },
    solve: (workdir) => {
      const files = toolkitModules();
      for (const path of files) {
        rewrite(workdir, path, (text) => `${licenseLine}\n${text}`);
      }
      return `Added the SPDX line to ${String(files.length)} modules.`;
    },
  },
];
