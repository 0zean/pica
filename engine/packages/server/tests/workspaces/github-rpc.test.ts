import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStore } from "@pica/adapters";
import { afterEach, describe, expect, it } from "vitest";
import { gitHubOptions, silentLogger, startEngine, workspaceOptions } from "../../src/index.ts";
import { TestClient, type JsonObject } from "../helpers.ts";
import { fakeGitHubSsoUrl, startFakeGitHub, type FakeGitHubMode } from "../processes/fake-github.ts";

interface Running {
  readonly client: TestClient;
  stop(): Promise<void>;
}

let running: Running | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

// The production composition of discovery and the GitHub methods, against `fake-picad`'s stub server.
async function start(mode: FakeGitHubMode = "signed-in"): Promise<Running> {
  const dir = await mkdtemp(join(tmpdir(), "picad-github-"));
  const opened = openSqliteStore(join(dir, "pica.db"));
  if (!opened.ok) throw new Error(opened.error.message);
  const store = opened.value;
  const fake = await startFakeGitHub(() => mode);
  const github = gitHubOptions(fake.access);
  let next = 0;
  const engine = await startEngine({
    socketPath: join(dir, "run", "picad.sock"),
    log: silentLogger,
    ...workspaceOptions({ store, dataDir: dir, env: {}, newId: () => `id-${String((next += 1))}` }, github),
    github,
  });
  const client = await TestClient.connectAndHello(engine.socketPath);
  return {
    client,
    stop: async () => {
      client.close();
      await engine.close();
      await fake.stub.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as JsonObject;
}

async function failure(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("error" in response)) throw new Error(`${method} answered ${JSON.stringify(response)}`);
  return (response["error"] as { data: JsonObject }).data;
}

describe("github RPC (A-12)", () => {
  it("reports the signed-in account on the configured host", async () => {
    running = await start();
    expect(await call(running.client, "github.authStatus", {})).toEqual({
      host: "ghe.example.test",
      signedIn: true,
      provider: "gh",
      login: "octo",
      scopes: ["repo", "read:org"],
    });
  });

  it("lists teams by organization and name, and a team's repos", async () => {
    running = await start();
    const { teams } = await call(running.client, "github.listTeams", {});
    expect(teams).toEqual([
      { org: "acme", slug: "payments", name: "Payments" },
      { org: "acme", slug: "platform", name: "Platform" },
      { org: "vault-corp", slug: "vault", name: "Vault" },
    ]);
    const { repos } = await call(running.client, "github.listTeamRepos", { org: "acme", teamSlug: "platform" });
    expect((repos as { fullName: string }[]).map((repo) => repo.fullName)).toEqual(["acme/atlas", "acme/beacon"]);
  });

  it("imports a team as a source whose repos are available", async () => {
    running = await start();
    const { client } = running;
    const { workspace } = (await call(client, "workspace.create", { name: "Platform" })) as { workspace: { id: string } };
    await call(client, "workspace.addSource", { workspaceId: workspace.id, kind: "team", org: "acme", selector: "platform" });
    await call(client, "workspace.sync", { workspaceId: workspace.id });
    const { repos } = await call(client, "repo.list", { workspaceId: workspace.id });
    expect(repos).toEqual([
      expect.objectContaining({ remoteUrl: "https://ghe.example.test/acme/atlas", cloneState: "available", localPath: null }),
      expect.objectContaining({ remoteUrl: "https://ghe.example.test/acme/beacon", cloneState: "available", localPath: null }),
    ]);
  });

  it("answers an SSO-protected team with the authorization URL as its fix, from the browser and from a sync", async () => {
    running = await start();
    const { client } = running;
    const fix = { kind: "open_url", label: "Authorize for single sign-on", target: fakeGitHubSsoUrl };
    expect(await failure(client, "github.listTeamRepos", { org: "vault-corp", teamSlug: "vault" })).toMatchObject({
      code: "auth_sso_required",
      fix,
    });
    const { workspace } = (await call(client, "workspace.create", { name: "Vault" })) as { workspace: { id: string } };
    await call(client, "workspace.addSource", { workspaceId: workspace.id, kind: "team", org: "vault-corp", selector: "vault" });
    expect(await failure(client, "workspace.sync", { workspaceId: workspace.id })).toMatchObject({ code: "auth_sso_required", fix });
  });

  it("answers signed out as not signed in, and team listing as auth_required with a sign-in fix", async () => {
    running = await start("signed-out");
    const { client } = running;
    expect(await call(client, "github.authStatus", { host: "ghe.example.test" })).toEqual({
      host: "ghe.example.test",
      signedIn: false,
      provider: null,
      login: null,
      scopes: [],
    });
    expect(await failure(client, "github.listTeams", {})).toMatchObject({
      code: "auth_required",
      fix: { kind: "sign_in", label: "Sign in to ghe.example.test", target: "ghe.example.test" },
    });
  });

  it("refuses a host the engine is not set up for", async () => {
    running = await start();
    expect(await failure(running.client, "github.listTeams", { host: "github.com" })).toMatchObject({
      code: "invalid_params",
      details: { reason: "github.unknown_host", host: "ghe.example.test" },
    });
  });
});
