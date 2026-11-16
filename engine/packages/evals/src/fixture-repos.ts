import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ledgerReports, moneyAppendix, servicesDoc, toolkitAppendix, toolkitModules } from "./generated-modules.ts";
import { errorCodesModule, schemaSql, settlementLog } from "./large-files.ts";

export type FixtureRepoName = "ledger-service" | "web-toolkit";

// `fixtures/evals/<repo>` at the root of the Pica checkout.
export const fixturesRoot = join(import.meta.dirname, "..", "..", "..", "..", "fixtures", "evals");

export function fixtureDir(name: FixtureRepoName): string {
  return join(fixturesRoot, name);
}

// Each generator gets the committed file at its path ("" when there is none) and returns the file.
type Generator = (committed: string) => string;

const constant = (generate: () => string): Generator => () => generate();
const appended = (appendix: () => string): Generator => (committed) => committed + appendix();
const each = (files: Record<string, string>): Record<string, Generator> =>
  Object.fromEntries(Object.entries(files).map(([path, content]) => [path, () => content]));

const generatedFiles: Readonly<Record<FixtureRepoName, Readonly<Record<string, Generator>>>> = {
  "ledger-service": {
    "db/schema.sql": constant(schemaSql),
    "logs/settlement.log": constant(settlementLog),
    "src/generated/error-codes.mjs": constant(errorCodesModule),
    "src/money.mjs": appended(moneyAppendix),
    ...each(ledgerReports()),
  },
  "web-toolkit": {
    "docs/services.md": constant(servicesDoc),
    "src/slug.mjs": appended(() => toolkitAppendix("slug", 240)),
    "src/retry.mjs": appended(() => toolkitAppendix("retry", 240)),
    ...each(toolkitModules()),
  },
};

// A file of a fixture repo as `writeFixtureFiles` writes it.
export function fixtureFile(name: FixtureRepoName, path: string): string {
  const committed = join(fixtureDir(name), path);
  const generate = generatedFiles[name][path];
  const text = existsSync(committed) ? readFileSync(committed, "utf8") : "";
  return generate === undefined ? text : generate(text);
}

// Git with no user or system config, so a commit is the same on every machine.
export const isolatedGitEnv: Readonly<Record<string, string>> = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Evals",
  GIT_AUTHOR_EMAIL: "evals@pica.test",
  GIT_COMMITTER_NAME: "Pica Evals",
  GIT_COMMITTER_EMAIL: "evals@pica.test",
  GIT_AUTHOR_DATE: "2026-11-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-01T00:00:00Z",
};

// The paths of a fixture repo's files under `dir` ending in `extension`, committed or generated, sorted.
export function fixtureFiles(name: FixtureRepoName, dir: string, extension: string): string[] {
  const committedDir = join(fixtureDir(name), dir);
  const committed = existsSync(committedDir)
    ? readdirSync(committedDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(fixtureDir(name), join(entry.parentPath, entry.name)))
    : [];
  const generated = Object.keys(generatedFiles[name]).filter((path) => path.startsWith(`${dir}/`));
  return [...new Set([...committed, ...generated])].filter((path) => path.endsWith(extension)).sort();
}

// Writes the files of a fixture repo at `dest`, without git.
export function writeFixtureFiles(name: FixtureRepoName, dest: string): void {
  cpSync(fixtureDir(name), dest, { recursive: true });
  for (const path of Object.keys(generatedFiles[name])) {
    const file = join(dest, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fixtureFile(name, path));
  }
}

// A working copy the engine can register: the fixture's files committed on `main`, with an
// `origin` remote, since a repo's identity is its remote URL (PLAN.md §4.4). Nothing is fetched.
export function materializeRepo(name: FixtureRepoName, dest: string): void {
  writeFixtureFiles(name, dest);
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dest, env: { ...process.env, ...isolatedGitEnv }, stdio: "pipe" });
  };
  git("init", "--quiet", "--initial-branch=main");
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture");
  git("remote", "add", "origin", `https://github.com/pica-evals/${name}.git`);
}
