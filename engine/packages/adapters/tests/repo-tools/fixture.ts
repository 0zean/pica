import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRepoTools, ok, type Repo, type RepoTools } from "@pica/core";
import { createGitRepoFiles, realPath } from "../../src/index.ts";
import { shell } from "../worktrees/fixture.ts";

export interface RepoToolsFixture {
  readonly root: string;
  readonly repos: readonly Repo[];
  tools(repos?: readonly Repo[]): RepoTools;
  cleanup(): void;
}

// Three repos (acme/api, acme/docs, acme/web) with "needle" in tracked, untracked, ignored,
// binary and symlinked files, plus a secret outside every repo.
export function makeRepoToolsFixture(): RepoToolsFixture {
  const root = mkdtempSync(join(tmpdir(), "pica-repo-tools-"));
  write(root, "outside/secret.txt", "needle secret\n");
  const api = repo(root, "api", {
    "src/b.ts": "const a = 1;\nexport const needle = 2;\n\n\n// Needle again\n",
    "src/a.ts": "needle();\n",
    "README.md": "# api\n",
    ".gitignore": "dist/\n",
  });
  write(api.localPath, "dist/bundle.js", "needle in build output\n");
  write(api.localPath, "notes.md", "untracked needle\n");
  writeFileSync(join(api.localPath, "logo.bin"), Buffer.from("needle\0\x01\x02", "binary"));
  symlinkSync(join(root, "outside/secret.txt"), join(api.localPath, "escape.txt"));
  symlinkSync(join(root, "outside"), join(api.localPath, "linkdir"));
  symlinkSync("src/a.ts", join(api.localPath, "alias.ts"));
  const web = repo(root, "web", { "index.ts": "import { needle } from 'api';\n", "z/deep.ts": "NEEDLE\n" });
  const docs = repo(root, "docs", { "guide.md": "No match here.\nA needle.\n" });
  const repos: readonly Repo[] = [web.entity, api.entity, docs.entity];
  return {
    root,
    repos,
    tools: (only = repos) =>
      createRepoTools({
        repos: () => Promise.resolve(ok(only)),
        files: createGitRepoFiles(),
        realPath,
      }),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function repo(root: string, name: string, files: Readonly<Record<string, string>>): { readonly localPath: string; readonly entity: Repo } {
  const localPath = join(root, name);
  mkdirSync(localPath);
  shell(localPath, "init", "--quiet", "--initial-branch=main");
  for (const [path, content] of Object.entries(files)) {
    write(localPath, path, content);
  }
  shell(localPath, "add", ".");
  shell(localPath, "commit", "--quiet", "-m", "Initial commit");
  return {
    localPath,
    entity: {
      id: `repo-${name}`,
      remoteUrl: `https://github.com/acme/${name}.git`,
      localPath,
      managed: true,
      defaultBranch: "main",
      cloneState: "ready",
    },
  };
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
