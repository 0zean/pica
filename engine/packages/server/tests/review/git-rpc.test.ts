import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { ok } from "@pica/core";
import type { PullRequestCreate } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// A-08: the production composition serves the review's `git.*` methods and `github.createPullRequest`.

const makeRepos = join(import.meta.dirname, "../../../testkit/fixtures/git/make-repos.sh");
// Where the app's diff snapshot tests read the fixture repository's diffs from; `PICA_UPDATE_FIXTURES=1` rewrites them.
const appFixtures = join(import.meta.dirname, "../../../../../app/Packages/Review/Tests/ReviewTests/Fixtures");

const env = {
  PATH: process.env["PATH"],
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
};

interface Started {
  readonly client: TestClient;
  readonly home: string;
  readonly created: PullRequestCreate[];
}

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function start(): Promise<Started> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a08-")));
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env,
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-17T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const review = composed.options.review;
  if (review === undefined) throw new Error("the production composition has no review");
  const created: PullRequestCreate[] = [];
  const listener = await startEngine({
    socketPath: join(home, "s"),
    log: silentLogger,
    ...composed.options,
    review: {
      ...review,
      pullRequests: () =>
        Promise.resolve(
          ok({
            create: (request: PullRequestCreate) => {
              created.push(request);
              const url = `https://github.com/${request.repo.owner}/${request.repo.name}/pull/7`;
              return Promise.resolve(ok({ repo: request.repo, number: 7, url }));
            },
            updateBody: () => Promise.resolve(ok(undefined)),
          }),
        ),
    },
  });
  const client = await TestClient.connectAndHello(listener.socketPath);
  stop = async () => {
    client.close();
    await listener.close();
    await composed.close();
    rmSync(home, { recursive: true, force: true });
  };
  return { client, home, created };
}

async function result<T = Record<string, unknown>>(client: TestClient, method: string, params: unknown = {}): Promise<T> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as T;
}

async function failure(client: TestClient, method: string, params: unknown): Promise<{ code: string; reason?: string }> {
  const response = await client.request(method, params);
  if (!("error" in response)) throw new Error(`${method} succeeded: ${JSON.stringify(response)}`);
  const data = (response["error"] as { data: { code: string; details?: { reason?: string } } }).data;
  return { code: data.code, ...(data.details?.reason === undefined ? {} : { reason: data.details.reason }) };
}

function shell(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

// A session writing the repository at `path`, registered the way the app registers one.
async function sessionFor(client: TestClient, path: string): Promise<{ sessionId: string; repoId: string }> {
  const { workspace } = await result<{ workspace: { id: string } }>(client, "workspace.create", { name: "Review" });
  const { repo } = await result<{ repo: { id: string } }>(client, "repo.addPath", { path });
  await result(client, "workspace.pinRepo", { workspaceId: workspace.id, repoId: repo.id });
  const { session } = await result<{ session: { id: string } }>(client, "session.create", {
    workspaceId: workspace.id,
    writeRepoIds: [repo.id],
    referenceRepoIds: [],
  });
  return { sessionId: session.id, repoId: repo.id };
}

const lines = (count: number, edit: (index: number) => string | undefined = () => undefined): string =>
  Array.from({ length: count }, (_, index) => edit(index) ?? `line ${String(index + 1)}`).join("\n") + "\n";

// A repository whose one file has two unstaged hunks, line 2 and line 28, pushing to a bare remote while its
// fetch URL names a GitHub repository.
function twoHunkRepo(home: string): string {
  const root = join(home, "repos");
  mkdirSync(root, { recursive: true });
  shell(root, "init", "--quiet", "--bare", "--initial-branch=main", "remote.git");
  const work = join(root, "atlas");
  shell(root, "init", "--quiet", "--initial-branch=main", "atlas");
  writeFileSync(join(work, "story.txt"), lines(30));
  shell(work, "add", "story.txt");
  shell(work, "commit", "--quiet", "-m", "Start the story");
  shell(work, "remote", "add", "origin", "https://github.com/acme/atlas.git");
  shell(work, "remote", "set-url", "--push", "origin", join(root, "remote.git"));
  writeFileSync(join(work, "story.txt"), lines(30, (index) => (index === 1 ? "line two" : index === 27 ? "line twenty-eight" : undefined)));
  return work;
}

interface FileDiff {
  path: string;
  originalPath: string | null;
  change: string;
  binary: boolean;
  hunks: { header: string; lines: { kind: string; text: string; oldLine: number | null; newLine: number | null }[] }[];
}

const diff = async (client: TestClient, ids: object, staged: boolean): Promise<FileDiff[]> =>
  (await result<{ files: FileDiff[] }>(client, "git.diff", { ...ids, staged })).files;

const changedLines = (file: FileDiff | undefined): string[] =>
  (file?.hunks ?? []).flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "context").map((line) => `${line.kind} ${line.text}`));

describe("A-08 review methods", () => {
  it("reports status and both diffs of the R-01 fixture, with renames, binary, deleted and untracked files", async () => {
    const { client, home } = await start();
    execFileSync(makeRepos, [join(home, "fixtures")], { env, stdio: "pipe" });
    // `repo.addPath` takes only hosted or absolute remotes; the fixture's is relative.
    shell(join(home, "fixtures/work"), "remote", "set-url", "origin", "https://github.com/acme/work.git");
    const ids = await sessionFor(client, join(home, "fixtures/work"));

    const { status } = await result<{ status: { branch: string; upstream: string; ahead: number; entries: unknown[] } }>(
      client,
      "git.status",
      ids,
    );
    expect(status).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1, behind: 0 });
    expect(status.entries).toEqual(
      expect.arrayContaining([
        { path: "new-name.txt", originalPath: "old-name.txt", staged: "renamed", unstaged: null, submodule: false },
        { path: "doomed.txt", originalPath: null, staged: "deleted", unstaged: null, submodule: false },
        { path: "image.bin", originalPath: null, staged: null, unstaged: "modified", submodule: false },
        { path: "untracked file.txt", originalPath: null, staged: null, unstaged: "untracked", submodule: false },
      ]),
    );

    const staged = await diff(client, ids, true);
    const unstaged = await diff(client, ids, false);
    expect(staged.map((file) => [file.change, file.path, file.originalPath])).toEqual([
      ["deleted", "doomed.txt", null],
      ["renamed", "new-name.txt", "old-name.txt"],
    ]);
    expect(staged.find((file) => file.change === "renamed")?.hunks[0]?.header).toBe("@@ -6,3 +6,4 @@ epsilon");
    expect(unstaged.map((file) => [file.change, file.path, file.binary])).toEqual([
      ["modified", "image.bin", true],
      ["modified", "notes.txt", false],
      ["modified", "vendor/lib", false],
      ["untracked", "untracked file.txt", false],
    ]);
    expect(unstaged.find((file) => file.path === "notes.txt")?.hunks[0]?.lines.slice(0, 4)).toEqual([
      { kind: "context", text: "line 1", oldLine: 1, newLine: 1 },
      { kind: "context", text: "line 2 changed", oldLine: 2, newLine: 2 },
      { kind: "context", text: "line 3", oldLine: 3, newLine: 3 },
      { kind: "removed", text: "line 4", oldLine: 4, newLine: null },
    ]);

    const fixtures = { "fixture-staged.json": staged, "fixture-unstaged.json": unstaged };
    for (const [name, files] of Object.entries(fixtures)) {
      const text = `${JSON.stringify({ files }, null, 2)}\n`;
      if (process.env["PICA_UPDATE_FIXTURES"] === "1") writeFileSync(join(appFixtures, name), text);
      // The app's snapshot tests draw these files, so they must be what the engine sends.
      expect(readFileSync(join(appFixtures, name), "utf8")).toBe(text);
    }
  });

  it("stages, unstages and discards single hunks, commits, pushes and opens a pull request", async () => {
    const { client, home, created } = await start();
    const work = twoHunkRepo(home);
    const ids = await sessionFor(client, work);
    const path = "story.txt";

    const before = await diff(client, ids, false);
    expect(before[0]?.hunks.map((hunk) => hunk.header)).toEqual(["@@ -1,5 +1,5 @@", "@@ -25,6 +25,6 @@ line 24"]);

    await result(client, "git.stage", { ...ids, path, hunkIndexes: [1] });
    expect(changedLines((await diff(client, ids, true))[0])).toEqual(["removed line 28", "added line twenty-eight"]);
    expect(changedLines((await diff(client, ids, false))[0])).toEqual(["removed line 2", "added line two"]);

    await result(client, "git.unstage", { ...ids, path, hunkIndexes: [0] });
    expect(await diff(client, ids, true)).toEqual([]);

    await result(client, "git.stage", { ...ids, path, hunkIndexes: [1] });
    await result(client, "git.discard", { ...ids, path, hunkIndexes: [0] });
    expect(await diff(client, ids, false)).toEqual([]);
    expect(readFileSync(join(work, path), "utf8")).toBe(lines(30, (index) => (index === 27 ? "line twenty-eight" : undefined)));

    const { commit } = await result<{ commit: { sha: string; subject: string; author: string } }>(client, "git.commit", {
      ...ids,
      message: "Name line 28\n\nWith words.",
    });
    expect(commit).toMatchObject({ subject: "Name line 28", author: "Pica Test" });
    expect(shell(work, "rev-parse", "HEAD").trim()).toBe(commit.sha);
    expect(await failure(client, "git.commit", { ...ids, message: "Again" })).toEqual({
      code: "invalid_state",
      reason: "git.nothing_to_commit",
    });

    expect(await failure(client, "github.createPullRequest", { ...ids, title: "Early", body: "" })).toEqual({
      code: "invalid_state",
      reason: "review.not_pushed",
    });
    shell(work, "switch", "--quiet", "-c", "pica/line-28");
    await result(client, "git.push", ids);
    const status = await result<{ status: { branch: string; upstream: string; ahead: number } }>(client, "git.status", ids);
    expect(status.status).toMatchObject({ branch: "pica/line-28", upstream: "origin/pica/line-28", ahead: 0 });
    expect(shell(join(home, "repos/remote.git"), "rev-parse", "pica/line-28").trim()).toBe(commit.sha);

    const opened = await result(client, "github.createPullRequest", { ...ids, title: "Name line 28", body: "Why", base: "main" });
    expect(opened).toEqual({
      pullRequest: { number: 7, url: "https://github.com/acme/atlas/pull/7", head: "pica/line-28", base: "main" },
    });
    expect(created).toEqual([
      { repo: { owner: "acme", name: "atlas" }, head: "pica/line-28", base: "main", title: "Name line 28", body: "Why" },
    ]);
  });

  it("stages and discards whole files, including untracked ones", async () => {
    const { client, home } = await start();
    const work = twoHunkRepo(home);
    const ids = await sessionFor(client, work);
    writeFileSync(join(work, "new.txt"), "fresh\n");

    await result(client, "git.stage", { ...ids, path: "new.txt" });
    expect((await diff(client, ids, true)).map((file) => [file.change, file.path])).toEqual([["added", "new.txt"]]);
    await result(client, "git.unstage", { ...ids, path: "new.txt" });
    expect((await diff(client, ids, false)).map((file) => [file.change, file.path])).toEqual([
      ["modified", "story.txt"],
      ["untracked", "new.txt"],
    ]);
    await result(client, "git.discard", { ...ids, path: "new.txt" });
    await result(client, "git.discard", { ...ids, path: "story.txt" });
    expect(await diff(client, ids, false)).toEqual([]);
    expect(readFileSync(join(work, "story.txt"), "utf8")).toBe(lines(30));
  });

  it("refuses repos the session does not write and hunks of files that cannot be split", async () => {
    const { client, home } = await start();
    const work = twoHunkRepo(home);
    const ids = await sessionFor(client, work);
    const other = join(home, "repos/other");
    shell(join(home, "repos"), "init", "--quiet", "--initial-branch=main", "other");
    shell(other, "remote", "add", "origin", "https://github.com/acme/other.git");
    const { repo } = await result<{ repo: { id: string } }>(client, "repo.addPath", { path: other });

    expect(await failure(client, "git.status", { sessionId: ids.sessionId, repoId: repo.id })).toEqual({
      code: "invalid_params",
      reason: "review.repo_not_in_session",
    });
    writeFileSync(join(work, "new.txt"), "fresh\n");
    await result(client, "git.stage", { ...ids, path: "new.txt" });
    expect(await failure(client, "git.unstage", { ...ids, path: "new.txt", hunkIndexes: [0] })).toEqual({
      code: "invalid_params",
      reason: "git.invalid_argument",
    });
    expect(await failure(client, "git.stage", { ...ids, path: "story.txt", hunkIndexes: [2] })).toEqual({
      code: "invalid_params",
      reason: "git.invalid_argument",
    });
  });
});
