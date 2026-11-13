import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, RuntimeHooks, Store } from "@pica/core";
import { openSqliteStore } from "@pica/adapters";
import { scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import type { Scenario } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";

export const workspaceId = "ws-1";
export const repoId = "repo-1";
export const repoPath = "/src/acme/api";

export function scenario(turns: unknown[]): Scenario {
  return scenarioSchema.parse({
    version: 1,
    models: [{ id: "model-a", name: "Model A" }],
    defaultModel: "model-a",
    turns,
  });
}

export function openSeededStore(path: string): Store {
  const opened = openSqliteStore(path);
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  const store = opened.value;
  if (!store.workspaces.get(workspaceId).ok) {
    store.repos.save({
      id: repoId,
      remoteUrl: "github.com/acme/api",
      localPath: repoPath,
      managed: false,
      defaultBranch: "main",
      cloneState: "ready",
    });
    store.workspaces.save({ id: workspaceId, name: "Payments", sources: [], pinnedRepoIds: [], settingsOverrides: {} });
  }
  return store;
}

export interface SessionEngine {
  readonly socketPath: string;
  readonly dbPath: string;
  readonly dir: string;
  readonly engine: SocketListener;
  connect(): Promise<TestClient>;
  stop(): Promise<void>;
}

export async function startSessionEngine(
  runtime: AgentRuntime,
  hooks?: (sessionId: string) => RuntimeHooks,
): Promise<SessionEngine> {
  const dir = await mkdtemp(join(tmpdir(), "picad-sessions-"));
  const socketPath = join(dir, "run", "picad.sock");
  const dbPath = join(dir, "pica.db");
  const store = openSeededStore(dbPath);
  const ids = sequentialIds();
  const engine = await startEngine({
    socketPath,
    log: silentLogger,
    sessions: {
      store,
      runtime,
      clock: steppingClock("2026-11-13T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      ...(hooks === undefined ? {} : { hooks }),
    },
  });
  const clients: TestClient[] = [];
  return {
    socketPath,
    dbPath,
    dir,
    engine,
    connect: async () => {
      const client = await TestClient.connectAndHello(socketPath);
      clients.push(client);
      return client;
    },
    stop: async () => {
      for (const client of clients) {
        client.close();
      }
      await engine.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) {
    throw new Error(`${method} failed: ${JSON.stringify(response["error"])}`);
  }
  return response["result"] as JsonObject;
}

export async function createSession(client: TestClient): Promise<string> {
  const result = await call(client, "session.create", {
    workspaceId,
    writeRepoIds: [repoId],
    referenceRepoIds: [],
  });
  return (result["session"] as JsonObject)["id"] as string;
}

export interface WireEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: JsonObject;
}

export async function subscribe(client: TestClient, sessionId: string, afterSeq = 0): Promise<string> {
  const result = await call(client, "events.subscribe", { sessionId, afterSeq });
  return result["subscriptionId"] as string;
}

export function received(client: TestClient, subscriptionId: string): WireEvent[] {
  return client
    .notifications()
    .filter((message) => message["method"] === "events.event")
    .map((message) => message["params"] as JsonObject)
    .filter((params) => params["subscriptionId"] === subscriptionId)
    .map((params) => params["event"] as WireEvent);
}

export async function waitForEvent(
  client: TestClient,
  subscriptionId: string,
  matches: (event: WireEvent) => boolean,
): Promise<WireEvent> {
  await client.waitFor(() => received(client, subscriptionId).some(matches));
  return received(client, subscriptionId).find(matches) as WireEvent;
}

export function isState(to: string): (event: WireEvent) => boolean {
  return (event) => event.type === "session.state_changed" && event.payload["to"] === to;
}
