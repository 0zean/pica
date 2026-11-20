import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, redirectingFetch, scenarioSchema, sequentialIds, startStubMcpServer, steppingClock } from "@pica/testkit";
import type { StubMcpServer } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";

// A-13 over `picad`'s production composition: servers written to `mcp.jsonc`, health against a stub
// MCP server, attachments to workspaces and sessions, and the cache-reset guard on live sessions.

const token = "stub-pat-0123456789";
const patRef = "keychain:github/github.com/pat";

interface Running {
  readonly home: string;
  readonly client: TestClient;
  readonly runtime: FakeRuntime;
  readonly stub: StubMcpServer;
  readonly workspaceId: string;
  readonly repoId: string;
  stop(): Promise<void>;
}

let running: Running | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as JsonObject;
}

async function failure(client: TestClient, method: string, params: unknown): Promise<{ message: string; code: unknown; details: JsonObject }> {
  const response = await client.request(method, params);
  const error = response["error"] as { message: string; data: { code: unknown; details: JsonObject } } | undefined;
  if (error === undefined) throw new Error(`${method} succeeded: ${JSON.stringify(response)}`);
  return { message: error.message, code: error.data.code, details: error.data.details };
}

// Answers each `secrets.get` the way the app's Keychain broker does.
function answerSecrets(client: TestClient, stored: ReadonlyMap<string, string>): void {
  void (async () => {
    for (;;) {
      const request = await client.next((message) => message["method"] === "secrets.get");
      const { secretRef } = request["params"] as { secretRef: string };
      const value = stored.get(secretRef);
      const reply =
        value === undefined
          ? { jsonrpc: "2.0", id: request["id"], error: { code: -32000, message: "no item", data: { code: "secret_unresolved" } } }
          : { jsonrpc: "2.0", id: request["id"], result: { value } };
      client.sendRaw(`${JSON.stringify(reply)}\n`);
    }
  })();
}

async function start(): Promise<Running> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a13-")));
  const repo = join(home, "src", "api");
  mkdirSync(repo, { recursive: true });
  const env = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PATH: process.env["PATH"] };
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repo, env });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/api.git"], { cwd: repo, env });
  const stub = await startStubMcpServer({
    tools: [
      { name: "search_code", description: "Search code.", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
      { name: "get_issue", inputSchema: { type: "object" } },
    ],
    bearerToken: token,
  });
  const runtime = new FakeRuntime({
    scenario: scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] }),
    clock: steppingClock("2026-11-20T10:00:00.000Z"),
    ids: sequentialIds(),
  });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env,
    log: silentLogger,
    runtime,
    managedPolicy: new ManagedPolicyLoader([]),
    mcpFetch: redirectingFetch({ "https://api.githubcopilot.com": stub.url }),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  answerSecrets(client, new Map([[patRef, token]]));
  const { workspace } = (await call(client, "workspace.create", { name: "Mine" })) as { workspace: { id: string } };
  const { repo: added } = (await call(client, "repo.addPath", { path: repo })) as { repo: { id: string } };
  return {
    home,
    client,
    runtime,
    stub,
    workspaceId: workspace.id,
    repoId: added.id,
    stop: async () => {
      client.close();
      await listener.close();
      await composed.close();
      await stub.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function addGitHubPreset(client: TestClient): Promise<JsonObject> {
  const { server } = (await call(client, "mcp.renderPreset", { presetId: "github", parameters: { auth: "pat" } })) as { server: JsonObject };
  return (await call(client, "mcp.add", { server }));
}

async function healthy(client: TestClient, serverId: string): Promise<JsonObject> {
  const message = await client.next((m) => {
    const status = (m["params"] as { status?: JsonObject } | undefined)?.status;
    return m["method"] === "mcp.statusChanged" && status?.["serverId"] === serverId && status["state"] === "healthy";
  });
  return (message["params"] as { status: JsonObject }).status;
}

async function newSession(run: Running): Promise<string> {
  const { session } = (await call(run.client, "session.create", { workspaceId: run.workspaceId, writeRepoIds: [run.repoId], referenceRepoIds: [] })) as {
    session: { id: string };
  };
  return session.id;
}

describe("A-13 MCP management in the production composition", () => {
  it("adds a preset to mcp.jsonc and reports it healthy against the stub, reading the PAT from the app", async () => {
    running = await start();
    const { client, home } = running;
    await addGitHubPreset(client);
    const status = await healthy(client, "github");
    expect(status).toMatchObject({ tools: ["get_issue", "search_code"], lastError: null });
    expect(status["toolDefinitionTokens"]).toBeGreaterThan(0);
    expect(running.stub.authorizations).toContain(`Bearer ${token}`);
    const file = readFileSync(join(home, "Library", "Application Support", "Pica", "mcp.jsonc"), "utf8");
    expect(file).toContain("${secret:keychain:github/github.com/pat}");
    expect(file).not.toContain(token);
    const { servers } = (await call(client, "mcp.list", {})) as { servers: { id: string; scope: string }[] };
    expect(servers.map((server) => [server.id, server.scope])).toEqual([["github", "global"]]);
  });

  it("refuses a second server with the same id and an inline secret, naming the reference rule", async () => {
    running = await start();
    const { client } = running;
    await addGitHubPreset(client);
    const { server } = (await call(client, "mcp.renderPreset", { presetId: "github", parameters: { auth: "pat" } })) as { server: JsonObject };
    expect((await failure(client, "mcp.add", { server })).code).toBe("already_exists");
    const inline = { ...server, id: "inline", transport: { type: "http", url: "https://example.com/mcp", headers: { Authorization: `Bearer ghp_${"a".repeat(36)}` } } };
    const refused = await failure(client, "mcp.add", { server: inline });
    expect(refused.code).toBe("config_invalid");
    expect(refused.message).toContain("secret");
    expect(refused.message).not.toContain("a".repeat(36));
  });

  it("starts a new session with its workspace's servers, secrets substituted for the runtime only", async () => {
    running = await start();
    const { client, runtime, workspaceId } = running;
    await addGitHubPreset(client);
    await call(client, "mcp.attach", { serverId: "github", workspaceId });
    const sessionId = await newSession(running);
    expect(runtime.sessionOptions(sessionId)?.mcpServers).toEqual({
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: `Bearer ${token}` }, tools: ["*"] },
    });
    const { attachments } = (await call(client, "mcp.attachments", { sessionId })) as { attachments: JsonObject[] };
    expect(attachments).toEqual([{ serverId: "github", agent: null }]);
  });

  it("starts a session with no servers when none is attached", async () => {
    running = await start();
    await addGitHubPreset(running.client);
    const sessionId = await newSession(running);
    expect(running.runtime.sessionOptions(sessionId)?.mcpServers).toBeUndefined();
  });

  it("asks before changing a live session's servers, then reopens its runtime with them", async () => {
    running = await start();
    const { client, runtime } = running;
    await addGitHubPreset(client);
    await healthy(client, "github");
    const sessionId = await newSession(running);
    const refused = await failure(client, "mcp.attach", { serverId: "github", sessionId });
    expect(refused.code).toBe("cache_reset_unconfirmed");
    expect(refused.details["toolDefinitionTokens"]).toBeGreaterThan(0);
    expect(((await call(client, "mcp.attachments", { sessionId })) as { attachments: unknown[] }).attachments).toEqual([]);
    expect(runtime.sessionOptions(sessionId)?.mcpServers).toBeUndefined();

    const attached = (await call(client, "mcp.attach", { serverId: "github", sessionId, acknowledgeCacheReset: true }));
    expect(attached["toolDefinitionTokens"]).toBeGreaterThan(0);
    expect(Object.keys(runtime.sessionOptions(sessionId)?.mcpServers ?? {})).toEqual(["github"]);

    expect((await failure(client, "mcp.detach", { serverId: "github", sessionId })).code).toBe("cache_reset_unconfirmed");
    await call(client, "mcp.detach", { serverId: "github", sessionId, acknowledgeCacheReset: true });
    expect(runtime.sessionOptions(sessionId)?.mcpServers).toBeUndefined();
  });

  it("edits and removes a server, detaching it everywhere", async () => {
    running = await start();
    const { client, workspaceId, home } = running;
    const { server } = (await addGitHubPreset(client)) as { server: JsonObject };
    await call(client, "mcp.update", { server: { ...server, name: "GitHub (work)", toolAllowlist: ["search_code"] } });
    const { servers } = (await call(client, "mcp.list", {})) as { servers: JsonObject[] };
    expect(servers[0]).toMatchObject({ name: "GitHub (work)", toolAllowlist: ["search_code"] });
    await call(client, "mcp.attach", { serverId: "github", workspaceId });
    await call(client, "mcp.remove", { id: "github" });
    expect(((await call(client, "mcp.list", {})) as { servers: unknown[] }).servers).toEqual([]);
    expect(((await call(client, "mcp.attachments", { workspaceId })) as { attachments: unknown[] }).attachments).toEqual([]);
    expect(existsSync(join(home, "Library", "Application Support", "Pica", "mcp-attachments.json"))).toBe(true);
  });

  it("keeps a workspace's own servers to that workspace", async () => {
    running = await start();
    const { client, workspaceId } = running;
    const local = { id: "docs", name: "Docs", transport: { type: "stdio", command: "docs-mcp", args: [], env: {}, cwd: null }, toolAllowlist: null, scope: "workspace" };
    expect((await failure(client, "mcp.add", { server: local })).code).toBe("invalid_params");
    await call(client, "mcp.add", { server: local, workspaceId });
    expect(((await call(client, "mcp.list", { workspaceId })) as { servers: JsonObject[] }).servers.map((s) => s["id"])).toEqual(["docs"]);
    expect(((await call(client, "mcp.list", {})) as { servers: unknown[] }).servers).toEqual([]);
  });
});
