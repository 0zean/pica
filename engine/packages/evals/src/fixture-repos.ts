import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorCodesModule, schemaSql, settlementLog } from "./large-files.ts";

export type FixtureRepoName = "ledger-service" | "web-toolkit";

// `fixtures/evals/<repo>` at the root of the Pica checkout.
export const fixturesRoot = join(import.meta.dirname, "..", "..", "..", "..", "fixtures", "evals");

export function fixtureDir(name: FixtureRepoName): string {
  return join(fixturesRoot, name);
}

const generatedFiles: Readonly<Record<FixtureRepoName, Readonly<Record<string, () => string>>>> = {
  "ledger-service": {
    "db/schema.sql": schemaSql,
    "logs/settlement.log": settlementLog,
    "src/generated/error-codes.mjs": errorCodesModule,
  },
  "web-toolkit": {},
};

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

// Writes the files of a fixture repo at `dest`, without git.
export function writeFixtureFiles(name: FixtureRepoName, dest: string): void {
  cpSync(fixtureDir(name), dest, { recursive: true });
  for (const [path, generate] of Object.entries(generatedFiles[name])) {
    const file = join(dest, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generate());
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
