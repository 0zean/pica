import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface CheckResult {
  readonly passed: boolean;
  readonly detail: string;
}

export function pass(detail: string): CheckResult {
  return { passed: true, detail };
}

export function fail(detail: string): CheckResult {
  return { passed: false, detail };
}

// The first failing check, or a pass naming what was checked.
export function allOf(passed: string, ...checks: (() => CheckResult)[]): CheckResult {
  for (const check of checks) {
    const result = check();
    if (!result.passed) return result;
  }
  return pass(passed);
}

export function readText(workdir: string, path: string): string | undefined {
  const file = join(workdir, path);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

export function readJson(workdir: string, path: string): unknown {
  const text = readText(workdir, path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Paths relative to `workdir` of the files under `dir` ending in `extension`, sorted.
export function filesUnder(workdir: string, dir: string, extension: string): string[] {
  const root = join(workdir, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(workdir, join(entry.parentPath, entry.name)))
    .sort();
}

// `node --test` over the given files, or over the default test directories when none are given.
export function runNodeTests(workdir: string, files: readonly string[] = []): CheckResult {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  delete env["NODE_TEST_CONTEXT"];
  const run = spawnSync(process.execPath, ["--test", ...files], { cwd: workdir, env, encoding: "utf8", timeout: 60_000 });
  const output = `${run.stdout}${run.stderr}`.trim();
  return run.status === 0 ? pass("node --test passed") : fail(`node --test failed: ${lastLines(output)}`);
}

// Whether every module loads, so an edit left no broken import behind.
export function modulesLoad(workdir: string, files: readonly string[]): CheckResult {
  const imports = files.map((file) => `await import(${JSON.stringify(`./${file}`)});`).join("");
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", imports], { cwd: workdir, env, encoding: "utf8", timeout: 60_000 });
  return run.status === 0 ? pass("modules load") : fail(`a module does not load: ${lastLines(`${run.stdout}${run.stderr}`)}`);
}

// The number of `test(` and `it(` calls, a floor on how many cases a test file has.
export function countTestCases(text: string): number {
  return (text.match(/\b(?:test|it)\s*\(/g) ?? []).length;
}

// Runs `check` against a copy of `workdir` in which `path` holds `content` instead.
export function withMutant(workdir: string, path: string, content: string, check: (copy: string) => CheckResult): CheckResult {
  const copy = mkdtempSync(join(tmpdir(), "pica-mutant-"));
  try {
    cpSync(workdir, copy, { recursive: true, filter: (source) => !source.startsWith(join(workdir, ".git")) });
    writeFileSync(join(copy, path), content);
    return check(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// The new tests must pass on the code and fail on a broken copy of it, so they test something.
export function testsCatchMutant(workdir: string, testFile: string, minCases: number, mutant: { path: string; content: string }): CheckResult {
  return allOf(
    `${testFile} has at least ${String(minCases)} cases, passes, and fails on a broken ${mutant.path}`,
    () => {
      const text = readText(workdir, testFile);
      if (text === undefined) return fail(`${testFile} does not exist`);
      const cases = countTestCases(text);
      return cases >= minCases ? pass("enough cases") : fail(`${testFile} has ${String(cases)} cases, wanted ${String(minCases)}`);
    },
    () => runNodeTests(workdir, [testFile]),
    () => {
      const broken = withMutant(workdir, mutant.path, mutant.content, (copy) => runNodeTests(copy, [testFile]));
      return broken.passed ? fail(`${testFile} still passes with a broken ${mutant.path}`) : pass("catches the mutant");
    },
  );
}

// Whether `answer` names `expected` as a whole word.
export function answerNames(answer: string, expected: string): CheckResult {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`);
  return pattern.test(answer) ? pass(`the answer names ${expected}`) : fail(`the answer does not name ${expected}`);
}

function lastLines(text: string): string {
  return text.split("\n").slice(-6).join(" | ");
}
