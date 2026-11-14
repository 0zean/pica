import { describe, expect, it } from "vitest";
import { createMcpHealthMonitor, type McpConnector } from "@pica/core";
import type { McpServerDef } from "@pica/protocol";
import { silentLogger, startEngine } from "../../src/index.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";

const server: McpServerDef = {
  id: "stub",
  name: "Stub",
  transport: { type: "http", url: "https://stub.example.com/mcp", headers: {} },
  toolAllowlist: null,
  scope: "global",
};

const connector: McpConnector = {
  connect: () =>
    Promise.resolve({
      ok: true,
      value: {
        listTools: () => Promise.resolve({ ok: true, value: [{ name: "ping", inputSchema: { type: "object" } }] }),
        close: () => Promise.resolve(),
      },
    }),
};

describe("mcp.* health methods", () => {
  it("answers status, status lists and restarts, and broadcasts every change", async () => {
    const monitor = createMcpHealthMonitor({
      connector,
      clock: { now: () => Date.UTC(2026, 10, 14), setTimer: () => () => undefined },
    });
    const paths = await makeSocketDir();
    const engine = await startEngine({ socketPath: paths.socketPath, log: silentLogger, mcpHealth: monitor });
    const client = await TestClient.connectAndHello(paths.socketPath);

    monitor.sync([server]);
    await client.waitFor(() => client.notifications().some((n) => statusState(n) === "healthy"));
    expect(client.notifications().map(statusState)).toEqual(["connecting", "healthy"]);

    const list = await client.request("mcp.statusList", {});
    expect(list["result"]).toEqual({
      statuses: [
        {
          serverId: "stub",
          state: "healthy",
          lastError: null,
          tools: ["ping"],
          latencyMs: 0,
          toolDefinitionTokens: expect.any(Number) as number,
          checkedAt: "2026-11-14T00:00:00.000Z",
          restarts: 0,
        },
      ],
    });
    expect((await client.request("mcp.status", { id: "stub" }))["result"]).toMatchObject({ status: { state: "healthy" } });
    expect((await client.request("mcp.status", { id: "nope" }))["error"]).toMatchObject({ data: { code: "not_found" } });

    expect((await client.request("mcp.restart", { id: "stub" }))["result"]).toEqual({ ok: true });
    await client.waitFor(() => client.notifications().length === 4);
    expect(client.notifications().map(statusState)).toEqual(["connecting", "healthy", "connecting", "healthy"]);

    client.close();
    await monitor.stop();
    await engine.close();
    await paths.remove();
  });
});

function statusState(notification: Record<string, unknown>): unknown {
  return notification["method"] === "mcp.statusChanged"
    ? (notification["params"] as { status: { state: string } }).status.state
    : undefined;
}
