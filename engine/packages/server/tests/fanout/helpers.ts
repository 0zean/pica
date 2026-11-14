import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@pica/core";
import type { AgentRuntime, RuntimeEvent, RuntimeHooks, RuntimeSession, SessionOptions } from "@pica/core";
import { sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, openSeededStore, workspaceId } from "../sessions/helpers.ts";

export { call, scenario, workspaceId } from "../sessions/helpers.ts";

export const repoIds = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

export function repoPath(repoId: string): string {
  return `/src/acme/${repoId}`;
}

export interface FanOutEngine {
  readonly client: TestClient;
  stop(): Promise<void>;
}

// `uncloned` repos are stored without a local path, so a session cannot be created for them.
export async function startFanOutEngine(
  runtime: AgentRuntime,
  options: { readonly hooks?: (sessionId: string) => RuntimeHooks; readonly uncloned?: readonly string[] } = {},
): Promise<FanOutEngine> {
  const dir = await mkdtemp(join(tmpdir(), "picad-fanout-"));
  const store = openSeededStore(join(dir, "pica.db"));
  for (const id of repoIds) {
    const cloned = !(options.uncloned ?? []).includes(id);
    store.repos.save({
      id,
      remoteUrl: `github.com/acme/${id}`,
      localPath: cloned ? repoPath(id) : null,
      managed: !cloned,
      defaultBranch: "main",
      cloneState: cloned ? "ready" : "absent",
    });
  }
  const ids = sequentialIds();
  let engine: SocketListener | undefined;
  try {
    engine = await startEngine({
      socketPath: join(dir, "run", "picad.sock"),
      log: silentLogger,
      sessions: {
        store,
        runtime,
        clock: steppingClock("2026-11-14T09:00:00.000Z"),
        newSessionId: () => ids("session"),
        newFanOutId: () => ids("fanout"),
        ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      },
    });
    const client = await TestClient.connectAndHello(join(dir, "run", "picad.sock"));
    const listener = engine;
    return {
      client,
      stop: async () => {
        client.close();
        await listener.close();
        store.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await engine?.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export interface WireRun {
  readonly repoId: string;
  readonly sessionId: string | null;
  readonly status: string;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface WireFanOut {
  readonly id: string;
  readonly state: string;
  readonly concurrency: number;
  readonly runs: readonly WireRun[];
  readonly counts: Readonly<Record<"queued" | "active" | "succeeded" | "failed" | "cancelled", number>>;
}

export async function startFanOut(client: TestClient, params: JsonObject): Promise<WireFanOut> {
  const result = await call(client, "fanout.start", { workspaceId, repoIds: [...repoIds], ...params });
  return result["fanOut"] as WireFanOut;
}

export function fanOutUpdates(client: TestClient, fanOutId: string): WireFanOut[] {
  return client
    .notifications()
    .filter((message) => message["method"] === "fanout.changed")
    .map((message) => (message["params"] as JsonObject)["fanOut"] as WireFanOut)
    .filter((fanOut) => fanOut.id === fanOutId);
}

export async function waitForFanOut(
  client: TestClient,
  fanOutId: string,
  matches: (fanOut: WireFanOut) => boolean,
): Promise<WireFanOut> {
  await client.waitFor(() => fanOutUpdates(client, fanOutId).some(matches));
  return fanOutUpdates(client, fanOutId).find(matches) as WireFanOut;
}

export async function getFanOut(client: TestClient, fanOutId: string): Promise<WireFanOut> {
  return (await call(client, "fanout.get", { fanOutId }))["fanOut"] as WireFanOut;
}

// The most sessions with a turn in flight at once, from the runtime's own event order.
export function peakConcurrentTurns(events: readonly RuntimeEvent[]): number {
  let running = 0;
  let peak = 0;
  for (const event of events) {
    if (event.type === "assistant.turn_start") {
      running += 1;
      peak = Math.max(peak, running);
    } else if (event.type === "assistant.turn_end") {
      running -= 1;
    }
  }
  return peak;
}

export interface Gate {
  readonly hooks: (sessionId: string) => RuntimeHooks;
  waiting(): readonly string[];
  release(sessionId: string): void;
}

// Holds each session's first tool call until the test releases it.
export function toolGate(): Gate {
  const held = new Map<string, () => void>();
  return {
    hooks: (sessionId) => ({
      onPreToolUse: () =>
        new Promise((resolve) => {
          held.set(sessionId, () => {
            resolve({ decision: "allow" });
          });
        }),
    }),
    waiting: () => [...held.keys()],
    release: (sessionId) => {
      const resolve = held.get(sessionId);
      held.delete(sessionId);
      resolve?.();
    },
  };
}

// Delegates to `runtime`, except that `send` fails for sessions opened in `failingDirectory`.
export function failSendsIn(runtime: AgentRuntime, failingDirectory: string): AgentRuntime {
  return {
    listModels: () => runtime.listModels(),
    quota: () => runtime.quota(),
    resumeSession: (options) => runtime.resumeSession(options),
    createSession: async (options: SessionOptions) => {
      const opened = await runtime.createSession(options);
      return opened.ok && options.workingDirectory === failingDirectory ? ok(failingSends(opened.value)) : opened;
    },
  };
}

function failingSends(session: RuntimeSession): RuntimeSession {
  return {
    id: session.id,
    subscribe: (listener) => session.subscribe(listener),
    send: () => Promise.resolve({ ok: false, error: { code: "runtime.failed", message: "the model provider is down" } }),
    abort: () => session.abort(),
    resolvePermission: (requestId, approved) => session.resolvePermission(requestId, approved),
    resolveSessionLimit: (requestId, maxAiCredits) => session.resolveSessionLimit(requestId, maxAiCredits),
    usage: () => session.usage(),
    close: () => session.close(),
  };
}
