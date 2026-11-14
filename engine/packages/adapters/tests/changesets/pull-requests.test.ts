import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChangeSet, openChangeSetPullRequests, type ChangeSet, type PullRequestClient } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitCliService, createGitHubPullRequestClient, createGitWorktreeService } from "../../src/index.ts";
import { startStubGitHub, stubHost, type RecordedRequest, type StubGitHub, type StubRoute } from "../github/stub-github.ts";
import { commitAll, gitEnv, shell, value } from "../worktrees/fixture.ts";
import { makeChangeSetFixture, type ChangeSetFixture } from "./fixture.ts";

let fixture: ChangeSetFixture;
let stub: StubGitHub | undefined;
const git = createGitCliService({ env: gitEnv });
const worktrees = createGitWorktreeService({ env: gitEnv, now: () => 0 });
const options = { title: "Rename user id", description: "Renames `userId` to `accountId`.", remote: "origin" };

beforeEach(() => {
  fixture = makeChangeSetFixture();
});

afterEach(async () => {
  await stub?.close();
  stub = undefined;
  fixture.cleanup();
});

async function changeSetWithCommits(): Promise<ChangeSet> {
  const changeSet = value(await createChangeSet(worktrees, { slug: "rename-user-id", repos: fixture.repos }));
  for (const member of changeSet.members) {
    writeFileSync(join(member.worktree.path, "CHANGE.md"), `${member.github.name}\n`);
    commitAll(member.worktree.path, "Rename user id", 1_700_000_100);
  }
  return changeSet;
}

function created(number: number, name: string): StubRoute {
  return () => ({ status: 201, body: { number, html_url: `https://ghe.example.test/acme/${name}/pull/${String(number)}` } });
}

function client(server: StubGitHub): PullRequestClient {
  return createGitHubPullRequestClient({ host: stubHost(server), provider: "pat", token: "t0k" });
}

function bodyOf(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
}

describe("openChangeSetPullRequests (R-10)", () => {
  it("creates both pull requests against a stub API and each body links the other", async () => {
    stub = await startStubGitHub({
      "POST /api/v3/repos/acme/api/pulls": created(11, "api"),
      "POST /api/v3/repos/acme/web/pulls": created(42, "web"),
      "PATCH /api/v3/repos/acme/api/pulls/11": () => ({ body: {} }),
      "PATCH /api/v3/repos/acme/web/pulls/42": () => ({ body: {} }),
    });
    const changeSet = await changeSetWithCommits();

    const result = await openChangeSetPullRequests({ git, pullRequests: client(stub) }, changeSet, options);

    expect(result.complete).toBe(true);
    expect(result.outcomes.map((outcome) => [outcome.status, outcome.status === "opened" ? outcome.pullRequest.number : null])).toEqual([
      ["opened", 11],
      ["opened", 42],
    ]);
    const posts = stub.requests.filter((request) => request.method === "POST");
    expect(posts.map((request) => bodyOf(request))).toEqual([
      { title: options.title, head: "pica/rename-user-id", base: "main", body: options.description },
      { title: options.title, head: "pica/rename-user-id", base: "main", body: options.description },
    ]);
    expect(stub.requests.every((request) => request.authorization === "Bearer t0k")).toBe(true);

    const apiBody = String(bodyOf(stub.requests.find((r) => r.path.endsWith("/acme/api/pulls/11"))).body);
    const webBody = String(bodyOf(stub.requests.find((r) => r.path.endsWith("/acme/web/pulls/42"))).body);
    expect(apiBody).toContain(options.description);
    expect(apiBody).toContain("[acme/web#42](https://ghe.example.test/acme/web/pull/42)");
    expect(apiBody).toContain("acme/api#11 (this pull request)");
    expect(webBody).toContain("[acme/api#11](https://ghe.example.test/acme/api/pull/11)");
    expect(webBody).toContain("acme/web#42 (this pull request)");

    for (const repo of fixture.repos) {
      expect(shell(join(fixture.root, `${repo.github.name}.git`), "branch", "--list", "--format=%(refname:short)", "pica/*").trim()).toBe("pica/rename-user-id");
    }
  });

  it("reports partial state when the second pull request fails, without rolling back the first", async () => {
    stub = await startStubGitHub({
      "POST /api/v3/repos/acme/api/pulls": created(11, "api"),
      "POST /api/v3/repos/acme/web/pulls": () => ({ status: 422, body: { message: "Validation Failed" } }),
    });
    const changeSet = await changeSetWithCommits();

    const result = await openChangeSetPullRequests({ git, pullRequests: client(stub) }, changeSet, options);

    expect(result.complete).toBe(false);
    expect(result.outcomes).toEqual([
      {
        repo: fixture.repos[0]?.repo,
        status: "opened",
        pullRequest: { repo: { owner: "acme", name: "api" }, number: 11, url: "https://ghe.example.test/acme/api/pull/11" },
      },
      {
        repo: fixture.repos[1]?.repo,
        status: "create_failed",
        error: { code: "github_request_failed", message: "ghe.example.test answered HTTP 422: Validation Failed" },
      },
    ]);
    expect(stub.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /api/v3/repos/acme/api/pulls",
      "POST /api/v3/repos/acme/web/pulls",
    ]);
    expect(shell(join(fixture.root, "api.git"), "branch", "--list", "--format=%(refname:short)", "pica/*").trim()).toBe("pica/rename-user-id");
    expect(shell(fixture.repos[0]?.repo ?? "", "branch", "--list", "--format=%(refname:short)", "pica/*").trim()).toBe("pica/rename-user-id");
  });

  it("skips the repositories after a failed push and keeps the earlier pull request", async () => {
    stub = await startStubGitHub({
      "POST /api/v3/repos/acme/api/pulls": created(11, "api"),
    });
    const changeSet = await changeSetWithCommits();
    shell(fixture.repos[1]?.repo ?? "", "remote", "set-url", "origin", join(fixture.root, "missing.git"));
    const third = makeChangeSetFixture(["docs"]);
    try {
      const withThird = value(await createChangeSet(worktrees, { slug: "rename-user-id", repos: third.repos }));
      const all: ChangeSet = { ...changeSet, members: [...changeSet.members, ...withThird.members] };

      const result = await openChangeSetPullRequests({ git, pullRequests: client(stub) }, all, options);

      expect(result.complete).toBe(false);
      expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["opened", "push_failed", "skipped"]);
      expect(stub.requests).toHaveLength(1);
    } finally {
      third.cleanup();
    }
  });
});
