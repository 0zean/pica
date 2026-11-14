import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMcpHealthMonitor,
  createMcpSecretRedactor,
  createSecretResolvingMcpConnector,
  type McpHealthMonitor,
  type McpSecretSource,
} from "@pica/core";
import { createEnvSecretSource, createMcpLaunchConnector } from "../../src/index.ts";
import { answer, httpStub, initializeResult, ManualClock, startHttpStub, stdioStub, waitForStatus } from "./helpers.ts";

const token = "s3cret-token";
const noKeychain: McpSecretSource = {
  read: () => Promise.resolve({ ok: true, value: null }),
};

const open: { monitor?: McpHealthMonitor; servers: Server[] } = { servers: [] };

afterEach(async () => {
  await open.monitor?.stop();
  for (const server of open.servers) {
    server.close();
  }
  open.servers = [];
});

function monitorWith(env: Record<string, string>, clock = new ManualClock()): { monitor: McpHealthMonitor; clock: ManualClock } {
  const connector = createSecretResolvingMcpConnector({
    sources: { keychain: noKeychain, env: createEnvSecretSource(env) },
    redactor: createMcpSecretRedactor(),
    launcher: createMcpLaunchConnector({ baseEnv: { PATH: process.env["PATH"] } }),
  });
  const monitor = createMcpHealthMonitor({ connector, clock, options: { slowMs: 2_000 } });
  open.monitor = monitor;
  return { monitor, clock };
}

const settled = (s: { state: string }): boolean => s.state !== "connecting";

describe("stub stdio servers", () => {
  it("healthy: lists every page of tools with the secret substituted into env", async () => {
    const { monitor } = monitorWith({ PICA_STUB_TOKEN: token });
    monitor.sync([stdioStub("ok", "needs-token", { STUB_TOKEN: { secretRef: "env:PICA_STUB_TOKEN" } })]);
    const status = await waitForStatus(monitor, "ok", settled);
    expect(status).toMatchObject({ state: "healthy", lastError: null, tools: ["get", "search"], latencyMs: 0 });
    expect(monitor.catalog()["ok"]?.find((t) => t.name === "get")?.annotations).toEqual({ readOnlyHint: true });
  });

  it("failing auth: an unresolved secret needs auth and is not restarted", async () => {
    const { monitor, clock } = monitorWith({});
    monitor.sync([stdioStub("locked", "needs-token", { STUB_TOKEN: { secretRef: "env:PICA_STUB_TOKEN" } })]);
    const status = await waitForStatus(monitor, "locked", settled);
    expect(status.state).toBe("needs_auth");
    expect(status.lastError).toContain("PICA_STUB_TOKEN");
    expect(clock.pending(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("crashing: the exit is reported and a restart is scheduled", async () => {
    const { monitor, clock } = monitorWith({});
    monitor.sync([stdioStub("crash", "crash")]);
    const status = await waitForStatus(monitor, "crash", (s) => s.restarts === 1);
    expect(status).toMatchObject({ state: "connecting", lastError: "process exited with code 3" });
    expect(clock.pending(10_000)).toEqual([1_000]);
  });
});

describe("stub http servers", () => {
  it("healthy over SSE responses, keeping the session id", async () => {
    const sessionIds: (string | undefined)[] = [];
    const { url, server } = await startHttpStub((message, request, response) => {
      sessionIds.push(request.headers["mcp-session-id"] as string | undefined);
      if (message.method === "initialize") {
        answer(response, message.id, initializeResult, true);
      } else if (message.method === "tools/list") {
        answer(response, message.id, { tools: [{ name: "query", inputSchema: { type: "object" } }] }, true);
      } else {
        response.writeHead(202).end();
      }
    });
    open.servers.push(server);
    const { monitor } = monitorWith({});
    monitor.sync([httpStub("remote", url)]);
    const status = await waitForStatus(monitor, "remote", settled);
    expect(status).toMatchObject({ state: "healthy", tools: ["query"] });
    expect(sessionIds).toEqual([undefined, "sess-1", "sess-1"]);
  });

  it("slow: tools/list slower than the threshold is degraded", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let listing: () => void = () => undefined;
    const listed = new Promise<void>((resolve) => (listing = resolve));
    const { url, server } = await startHttpStub(async (message, _request, response) => {
      if (message.method === "initialize") {
        answer(response, message.id, initializeResult);
      } else if (message.method === "tools/list") {
        listing();
        await gate;
        answer(response, message.id, { tools: [] });
      } else {
        response.writeHead(202).end();
      }
    });
    open.servers.push(server);
    const { monitor, clock } = monitorWith({});
    monitor.sync([httpStub("slow", url)]);
    await listed;
    clock.time += 2_500;
    release();
    const status = await waitForStatus(monitor, "slow", settled);
    expect(status).toMatchObject({ state: "degraded", latencyMs: 2_500, tools: [] });
  });

  it("failing auth: HTTP 401 needs auth, and the header secret never appears in the status", async () => {
    const { url, server } = await startHttpStub((_message, _request, response) => {
      response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: token }));
    });
    open.servers.push(server);
    const { monitor } = monitorWith({ PICA_STUB_TOKEN: token });
    monitor.sync([httpStub("locked", url, { authorization: "Bearer ${secret:env:PICA_STUB_TOKEN}" })]);
    const status = await waitForStatus(monitor, "locked", settled);
    expect(status.state).toBe("needs_auth");
    expect(status.lastError).toBe(`initialize: ${new URL(url).origin} answered HTTP 401`);
    expect(JSON.stringify(status)).not.toContain(token);
  });

  it("unreachable: a closed port fails and is checked again later", async () => {
    const { url, server } = await startHttpStub(() => undefined);
    await new Promise((resolve) => server.close(resolve));
    const { monitor } = monitorWith({});
    monitor.sync([httpStub("down", url)]);
    const status = await waitForStatus(monitor, "down", settled);
    expect(status.state).toBe("failed");
    expect(status.lastError).toContain("unreachable");
  });
});
