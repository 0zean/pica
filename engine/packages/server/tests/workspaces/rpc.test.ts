import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStore } from "@pica/adapters";
import {
  createWorkspaceService,
  defaultDiscoveryFilter,
  err,
  ok,
  repoRegistryError,
  resolveGitHubHost,
  type DiscoveryResult,
  type GitHubRestClient,
  type Store,
} from "@pica/core";
import { afterEach, describe, expect, it } from "vitest";
import { silentLogger, startEngine, type SocketListener } from "../../src/index.ts";
import { TestClient, type JsonObject } from "../helpers.ts";

const host = resolveGitHubHost({ host: "github.com" });

const teamClient: GitHubRestClient = {
  host,
  get: () =>
    Promise.resolve(
      ok({
        status: "ok" as const,
        etag: '"v1"',
        link: null,
        body: ["billing", "ledger"].map((name) => ({
          full_name: `acme/${name}`,
          html_url: `https://github.com/acme/${name}`,
          clone_url: `https://github.com/acme/${name}.git`,
          default_branch: "main",
        })),
      }),
    ),
};

interface Running {
  readonly client: TestClient;
  readonly store: Store;
  stop(): Promise<void>;
}

let running: Running | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(discover: () => DiscoveryResult<GitHubRestClient> = () => Promise.resolve(ok(teamClient))): Promise<Running> {
  const dir = await mkdtemp(join(tmpdir(), "picad-workspaces-"));
  const opened = openSqliteStore(join(dir, "pica.db"));
  if (!opened.ok) throw new Error(opened.error.message);
  const store = opened.value;
  let next = 0;
  const workspaces = createWorkspaceService({
    workspaces: store.workspaces,
    repos: store.repos,
    discovery: { client: discover, filter: defaultDiscoveryFilter },
    clone: () => Promise.resolve(err(repoRegistryError("repo.clone_failed", "not in this test"))),
    newId: () => `id-${String((next += 1))}`,
    clock: () => "2026-11-14T00:00:00.000Z",
  });
  const engine: SocketListener = await startEngine({ socketPath: join(dir, "run", "picad.sock"), log: silentLogger, workspaces });
  const client = await TestClient.connectAndHello(engine.socketPath);
  return {
    client,
    store,
    stop: async () => {
      client.close();
      await engine.close();
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

describe("workspace RPC", () => {
  it("lists a synced team's repos as available", async () => {
    running = await start();
    const { client } = running;
    const { workspace } = (await call(client, "workspace.create", { name: "Payments" })) as { workspace: { id: string } };
    const { source } = await call(client, "workspace.addSource", {
      workspaceId: workspace.id,
      kind: "team",
      org: "acme",
      selector: "platform",
    });
    expect(source).toEqual({ id: "id-2", kind: "team", org: "acme", selector: "platform", lastSyncedAt: null });

    const synced = await call(client, "workspace.sync", { workspaceId: workspace.id });
    const { repos } = await call(client, "repo.list", { workspaceId: workspace.id });

    expect(synced).toEqual({ added: ["id-3", "id-4"], removed: [] });
    expect(repos).toEqual([
      { id: "id-3", remoteUrl: "https://github.com/acme/billing", localPath: null, managed: true, defaultBranch: "main", cloneState: "available" },
      { id: "id-4", remoteUrl: "https://github.com/acme/ledger", localPath: null, managed: true, defaultBranch: "main", cloneState: "available" },
    ]);
    const changed = client.notifications().filter((message) => message["method"] === "workspace.changed");
    expect(changed.length).toBeGreaterThanOrEqual(3);
  });

  it("maps overrides onto the workspace config layer and keeps its other keys", async () => {
    running = await start();
    const { client, store } = running;
    const { workspace } = (await call(client, "workspace.create", { name: "Payments" })) as { workspace: { id: string } };
    const current = store.workspaces.get(workspace.id);
    if (!current.ok) throw new Error(current.error.message);
    store.workspaces.save({ ...current.value, settingsOverrides: { permissions: { mode: "auto" }, budget: { sessionCredits: 50 } } });

    const updated = await call(client, "workspace.update", {
      id: workspace.id,
      overrides: { routingProfile: "strict", dailyCredits: 500 },
    });

    expect(updated["workspace"]).toMatchObject({ overrides: { routingProfile: "strict", dailyCredits: 500 } });
    const saved = store.workspaces.get(workspace.id);
    expect(saved.ok ? saved.value.settingsOverrides : undefined).toEqual({
      permissions: { mode: "auto" },
      routing: { profile: "strict" },
      budget: { sessionCredits: 50, workspaceDailyCredits: 500 },
    });

    const cleared = await call(client, "workspace.update", { id: workspace.id, overrides: {} });
    expect(cleared["workspace"]).toMatchObject({ overrides: {} });
    const after = store.workspaces.get(workspace.id);
    expect(after.ok ? after.value.settingsOverrides : undefined).toEqual({ permissions: { mode: "auto" }, budget: { sessionCredits: 50 } });
  });

  it("passes a GitHub auth error and its fix through to the client", async () => {
    const fix = { kind: "sign_in" as const, label: "Sign in to github.com" };
    running = await start(() => Promise.resolve(err({ code: "auth_required" as const, message: "Sign in to GitHub", fix })));
    const { client } = running;
    const { workspace } = (await call(client, "workspace.create", { name: "Payments" })) as { workspace: { id: string } };
    await call(client, "workspace.addSource", { workspaceId: workspace.id, kind: "team", org: "acme", selector: "platform" });

    const response = await client.request("workspace.sync", { workspaceId: workspace.id });

    expect(response["error"]).toMatchObject({ data: { code: "auth_required", fix, details: { reason: "workspace.discovery_failed" } } });
  });

  it("answers not found for an unknown workspace", async () => {
    running = await start();
    const response = await running.client.request("workspace.get", { id: "missing" });
    expect(response["error"]).toMatchObject({ data: { code: "not_found" } });
  });
});
