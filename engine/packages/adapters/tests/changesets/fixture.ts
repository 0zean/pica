import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChangeSetRepo } from "@pica/core";
import { shell } from "../worktrees/fixture.ts";

export interface ChangeSetFixture {
  readonly root: string;
  // Repositories named `api` and `web`, each on `main` with one commit and a bare `origin`.
  readonly repos: readonly ChangeSetRepo[];
  cleanup(): void;
}

export function makeChangeSetFixture(names: readonly string[] = ["api", "web"]): ChangeSetFixture {
  const root = mkdtempSync(join(tmpdir(), "pica-changesets-"));
  const repos = names.map((name): ChangeSetRepo => {
    const repo = join(root, name);
    mkdirSync(repo);
    shell(repo, "init", "--quiet", "--initial-branch=main");
    writeFileSync(join(repo, "README.md"), `${name}\n`);
    shell(repo, "add", "README.md");
    shell(repo, "commit", "--quiet", "-m", "Initial commit");
    shell(root, "init", "--quiet", "--bare", `${name}.git`);
    shell(repo, "remote", "add", "origin", join(root, `${name}.git`));
    return {
      repo,
      github: { owner: "acme", name },
      baseBranch: "main",
      worktreePath: join(root, "worktrees", name),
    };
  });
  return {
    root,
    repos,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
