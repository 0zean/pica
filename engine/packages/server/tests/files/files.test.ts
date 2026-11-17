import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// A-09: the production composition answers `files.*` over a real git checkout.

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

interface Started {
  readonly client: TestClient;
  readonly workspaceId: string;
  readonly repoId: string;
  readonly root: string;
}

function write(root: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function makeRepo(home: string): string {
  const root = join(home, "atlas");
  mkdirSync(root);
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  };
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "https://git.example.com/acme/atlas.git");
  write(root, ".gitignore", "build/\n*.log\n");
  write(root, "README.md", "# Atlas\n");
  write(root, "src/main.ts", "export const main = 1;\n");
  write(root, "src/session/timeline-row.ts", "row\n");
  write(root, "src/session/composer.ts", "composer\n");
  write(root, "build/out.js", "ignored\n");
  write(root, "debug.log", "ignored\n");
  write(root, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  // Untracked but not ignored: listed too.
  write(root, "notes/todo.md", "- [ ] ship\n");
  symlinkSync("/etc/hosts", join(root, "hosts-link"));
  return root;
}

async function start(): Promise<Started> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a09-")));
  const root = makeRepo(home);
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: {},
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  stop = async () => {
    client.close();
    await listener.close();
    await composed.close();
    rmSync(home, { recursive: true, force: true });
  };
  const { workspace } = (await result(client, "workspace.create", { name: "Acme" })) as { workspace: { id: string } };
  const { repo } = (await result(client, "repo.addPath", { path: root })) as { repo: { id: string } };
  await result(client, "workspace.pinRepo", { workspaceId: workspace.id, repoId: repo.id });
  return { client, workspaceId: workspace.id, repoId: repo.id, root };
}

async function result(client: TestClient, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as Record<string, unknown>;
}

async function failure(client: TestClient, method: string, params: unknown): Promise<{ code: string; reason: string }> {
  const response = await client.request(method, params);
  if (!("error" in response)) throw new Error(`${method} succeeded: ${JSON.stringify(response)}`);
  const data = (response["error"] as { data: { code: string; details: { reason: string } } }).data;
  return { code: data.code, reason: data.details.reason };
}

describe("A-09 files methods", () => {
  it("lists a directory's children, directories first, without ignored files or .git", async () => {
    const { client, repoId } = await start();
    const { entries } = (await result(client, "files.list", { repoId, directory: "" })) as {
      entries: { path: string; kind: string; sizeBytes: number | null }[];
    };
    expect(entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ["notes", "directory"],
      ["src", "directory"],
      [".gitignore", "file"],
      ["README.md", "file"],
      ["hosts-link", "symlink"],
      ["logo.png", "file"],
    ]);
    expect(entries.find((entry) => entry.path === "README.md")?.sizeBytes).toBe(8);
    expect(entries.find((entry) => entry.path === "src")?.sizeBytes).toBeNull();

    const nested = (await result(client, "files.list", { repoId, directory: "src/session" })) as { entries: { path: string }[] };
    expect(nested.entries.map((entry) => entry.path)).toEqual(["src/session/composer.ts", "src/session/timeline-row.ts"]);
  });

  it("refuses a missing directory and paths outside the repo", async () => {
    const { client, repoId } = await start();
    expect(await failure(client, "files.list", { repoId, directory: "nope" })).toEqual({ code: "not_found", reason: "files.not_found" });
    expect(await failure(client, "files.list", { repoId, directory: "../" })).toEqual({ code: "invalid_params", reason: "files.outside_repo" });
    // A symlink is read as what it points to, so one leading out of the repo is refused.
    expect(await failure(client, "files.read", { repoId, path: "hosts-link" })).toEqual({ code: "invalid_params", reason: "files.outside_repo" });
    expect(await failure(client, "files.list", { repoId: "missing", directory: "" })).toEqual({ code: "not_found", reason: "files.repo_not_found" });
  });

  it("reads a text file and refuses a binary one", async () => {
    const { client, repoId } = await start();
    expect(await result(client, "files.read", { repoId, path: "src/main.ts" })).toEqual({
      text: "export const main = 1;\n",
      truncated: false,
      sizeBytes: 23,
    });
    expect(await failure(client, "files.read", { repoId, path: "logo.png" })).toEqual({ code: "invalid_state", reason: "files.binary" });
  });

  it("quick-opens across the workspace's repos", async () => {
    const { client, workspaceId, repoId } = await start();
    const { hits } = (await result(client, "files.quickOpen", { workspaceId, query: "sesrow", limit: 10 })) as {
      hits: { repoId: string; path: string; score: number }[];
    };
    expect(hits.map((hit) => [hit.repoId, hit.path])).toEqual([[repoId, "src/session/timeline-row.ts"]]);
    const ignored = (await result(client, "files.quickOpen", { workspaceId, query: "out.js", limit: 10 })) as { hits: unknown[] };
    expect(ignored.hits).toEqual([]);
    expect(await failure(client, "files.quickOpen", { workspaceId: "missing", query: "a", limit: 10 })).toEqual({
      code: "not_found",
      reason: "files.workspace_not_found",
    });
  });
});
