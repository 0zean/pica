import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allOf, fail, filesUnder, modulesLoad, pass, readText, runNodeTests } from "../check-helpers.ts";
import type { CheckResult } from "../check-helpers.ts";
import { fixtureDir } from "../fixture-repos.ts";
import type { EvalTask } from "./task.ts";

function rewrite(workdir: string, path: string, change: (text: string) => string): void {
  const file = join(workdir, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
}

function hasNo(workdir: string, files: readonly string[], text: string): CheckResult {
  const left = files.filter((file) => readText(workdir, file)?.includes(text) === true);
  return left.length === 0 ? pass(`no ${text} left`) : fail(`${text} is still in ${left.join(", ")}`);
}

const ledgerModules = ["src/invoice.mjs", "src/logger.mjs", "src/money.mjs", "src/statement.mjs"];
const toolkitModules = ["src/headers.mjs", "src/query.mjs", "src/retry.mjs", "src/slug.mjs"];
const licenseLine = "// SPDX-License-Identifier: Apache-2.0";
const loggerImport = 'import { logger } from "./logger.mjs";\n';

// Multi-file mechanical edits: the same change across several files, with nothing broken.
export const multiFileEditTasks: readonly EvalTask[] = [
  {
    id: "rename-fmt-cents",
    category: "multi-file-edit",
    repo: "ledger-service",
    prompt: "Rename fmtCents to formatCents everywhere in src/ and test/, keeping behaviour the same. The tests must still pass.",
    check: ({ workdir }) => {
      const files = [...filesUnder(workdir, "src", ".mjs"), ...filesUnder(workdir, "test", ".mjs")];
      return allOf(
        "fmtCents is renamed to formatCents everywhere and the tests pass",
        () => hasNo(workdir, files, "fmtCents"),
        () => (readText(workdir, "src/money.mjs")?.includes("export function formatCents(") === true ? pass("exported") : fail("src/money.mjs does not export formatCents")),
        () => runNodeTests(workdir),
      );
    },
    solve: (workdir) => {
      for (const path of ["src/money.mjs", "src/invoice.mjs", "src/statement.mjs", "test/invoice.test.mjs"]) {
        rewrite(workdir, path, (text) => text.replaceAll("fmtCents", "formatCents"));
      }
      return "Renamed fmtCents to formatCents in four files.";
    },
  },
  {
    id: "console-to-logger",
    category: "multi-file-edit",
    repo: "ledger-service",
    prompt:
      "In src/, replace every console.log call outside src/logger.mjs with logger.info, importing logger from ./logger.mjs " +
      "in each file you change. Leave src/logger.mjs as it is.",
    check: ({ workdir }) => {
      const changed = ["src/invoice.mjs", "src/statement.mjs"];
      const others = filesUnder(workdir, "src", ".mjs").filter((file) => file !== "src/logger.mjs");
      return allOf(
        "console.log is replaced by logger.info, every module loads, and the tests pass",
        () => hasNo(workdir, others, "console.log"),
        () => {
          const missing = changed.filter((file) => {
            const text = readText(workdir, file) ?? "";
            return !(text.includes("logger.info(") && /import\s*\{\s*logger\s*\}\s*from\s*["']\.\/logger\.mjs["']/.test(text));
          });
          return missing.length === 0 ? pass("imports logger") : fail(`no logger import or call in ${missing.join(", ")}`);
        },
        () => modulesLoad(workdir, ledgerModules),
        () => runNodeTests(workdir),
      );
    },
    solve: (workdir) => {
      for (const path of ["src/invoice.mjs", "src/statement.mjs"]) {
        rewrite(workdir, path, (text) => loggerImport + text.replaceAll("console.log(", "logger.info("));
      }
      return "Replaced console.log with logger.info in src/invoice.mjs and src/statement.mjs.";
    },
  },
  {
    id: "license-headers",
    category: "multi-file-edit",
    repo: "web-toolkit",
    prompt: `Add the line \`${licenseLine}\` as the first line of every .mjs file in src/, changing nothing else.`,
    check: ({ workdir }) => {
      const wrong = toolkitModules.filter((file) => {
        const original = readFileSync(join(fixtureDir("web-toolkit"), file), "utf8");
        return readText(workdir, file) !== `${licenseLine}\n${original}`;
      });
      return allOf(
        "every module starts with the license line and is otherwise unchanged",
        () => (wrong.length === 0 ? pass("headers") : fail(`header missing or file changed: ${wrong.join(", ")}`)),
        () => modulesLoad(workdir, toolkitModules),
      );
    },
    solve: (workdir) => {
      for (const path of toolkitModules) {
        rewrite(workdir, path, (text) => `${licenseLine}\n${text}`);
      }
      return "Added the SPDX line to four modules.";
    },
  },
];
