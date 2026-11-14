import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PicaConfig } from "@pica/protocol";
import { decide, withBeforeCommitHooks, type GitService, type HookRunReport, type PolicyContext } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitCliService, createShellHookRunner } from "../../src/index.ts";

const makeRepos = join(import.meta.dirname, "../../../testkit/fixtures/git/make-repos.sh");

const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
};

const neverFires = (): (() => void) => () => undefined;

let root: string;
let work: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pica-hook-commit-"));
  execFileSync(makeRepos, [join(root, "fixtures")], { env, stdio: "pipe" });
  work = join(root, "fixtures/work");
  writeFileSync(join(work, "notes.md"), "changed\n");
  execFileSync("git", ["add", "notes.md"], { cwd: work, env });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function head(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: work, env, encoding: "utf8" }).trim();
}

function gitWithHooks(beforeCommit: unknown[], reports: HookRunReport[] = []): GitService {
  const settings = PicaConfig.parse({ hooks: { beforeCommit } }).hooks;
  const context: Omit<PolicyContext, "cwd" | "writeRoots" | "referenceRoots"> = {
    config: PicaConfig.parse({}),
    managed: [],
    commandDenyList: [],
  };
  return withBeforeCommitHooks(
    createGitCliService({ env }),
    {
      runner: createShellHookRunner({ env, timer: neverFires }),
      settings: () => settings,
      decide: (call, scope) => decide(call, { ...context, ...scope }),
    },
    (report) => reports.push(report),
  );
}

describe("beforeCommit hooks", () => {
  it("block the commit when a hook exits non-zero and surface its output", async () => {
    const before = head();
    const reports: HookRunReport[] = [];
    const git = gitWithHooks(
      [
        { name: "lint", command: 'echo "src/a.ts:3 unused import"; echo "lint: 1 error" >&2; exit 1' },
        { name: "never reached", command: "touch reached" },
      ],
      reports,
    );
    const result = await git.commit(work, { message: "Change notes" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "git.hook_blocked",
        message: 'commit blocked: hook "lint" exited with code 1',
        stderr: "src/a.ts:3 unused import\nlint: 1 error\n",
        exitCode: 1,
      },
    });
    expect(head()).toBe(before);
    expect(reports[0]?.results).toHaveLength(1);
  });

  it("let the commit through when every hook passes, with the message in the environment", async () => {
    const before = head();
    const git = gitWithHooks([{ command: 'test "$PICA_COMMIT_MESSAGE" = "Change notes" && test "$PICA_REPO" -ef .' }]);
    const result = await git.commit(work, { message: "Change notes" });
    expect(result).toMatchObject({ ok: true });
    expect(head()).not.toBe(before);
  });
});
