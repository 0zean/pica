import { describe, expect, it } from "vitest";
import { createMcpHealthMonitor, estimateMcpToolListTokens } from "../../src/index.ts";
import { FakeClock, httpServer, recordStatuses, stdioServer, StubConnector, tools } from "./helpers.ts";

function setup(behaviors: ConstructorParameters<typeof StubConnector>[1]) {
  const clock = new FakeClock();
  const connector = new StubConnector(clock, behaviors);
  const monitor = createMcpHealthMonitor({
    connector,
    clock,
    options: { slowMs: 2_000, restart: { maxAttempts: 2, initialDelayMs: 1_000 } },
  });
  const seen = recordStatuses((listener) => monitor.subscribe(listener));
  return { clock, connector, monitor, seen };
}

describe("MCP server health from stub servers", () => {
  it("a healthy server reports its tools, latency and token estimate", async () => {
    const { clock, monitor, seen } = setup({ ok: { kind: "healthy" } });
    monitor.sync([stdioServer("ok")]);
    expect(monitor.status("ok")?.state).toBe("connecting");
    await clock.advance(0);
    expect(monitor.status("ok")).toEqual({
      serverId: "ok",
      state: "healthy",
      lastError: null,
      tools: ["get", "search"],
      latencyMs: 0,
      toolDefinitionTokens: estimateMcpToolListTokens("ok", tools),
      checkedAt: new Date(clock.now()).toISOString(),
      restarts: 0,
    });
    expect(seen.map((s) => s.state)).toEqual(["connecting", "healthy"]);
    expect(monitor.catalog()).toEqual({ ok: tools });
  });

  it("a slow server is degraded with its latency and the reason", async () => {
    const { clock, monitor } = setup({ slow: { kind: "slow", latencyMs: 2_500 } });
    monitor.sync([httpServer("slow")]);
    await clock.advance(0);
    const status = monitor.status("slow");
    expect(status?.state).toBe("degraded");
    expect(status?.latencyMs).toBe(2_500);
    expect(status?.lastError).toBe("tools/list took 2500 ms; slower than 2000 ms");
    expect(status?.tools).toEqual(["get", "search"]);
  });

  it("a server that does not answer in time is reported with a timeout", async () => {
    const clock = new FakeClock();
    const monitor = createMcpHealthMonitor({
      clock,
      options: { timeoutMs: 5_000 },
      connector: { connect: () => new Promise(() => undefined) },
    });
    monitor.sync([httpServer("hung")]);
    await clock.advance(5_000);
    expect(monitor.status("hung")).toMatchObject({ state: "failed", lastError: "connecting timed out after 5000 ms" });
  });

  it("a crashing stdio server is restarting, then failed once out of attempts", async () => {
    const { clock, monitor, seen } = setup({ crash: { kind: "crash-after-start" } });
    monitor.sync([stdioServer("crash")]);
    await clock.advance(0);
    expect(monitor.status("crash")).toMatchObject({
      state: "connecting",
      lastError: "process exited with code 3",
      restarts: 1,
    });
    await clock.advance(10_000);
    expect(monitor.status("crash")).toMatchObject({
      state: "failed",
      lastError: "process exited with code 3; gave up after 2 restart attempts",
      restarts: 2,
      latencyMs: null,
    });
    expect(seen.map((s) => s.state)).toEqual(["connecting", "connecting", "connecting", "failed"]);
  });

  it("a crashing http server is failed and reconnected at the next check", async () => {
    const clock = new FakeClock();
    const connector = new StubConnector(clock, {});
    const monitor = createMcpHealthMonitor({ connector, clock, options: { checkIntervalMs: 60_000 } });
    monitor.sync([httpServer("remote")]);
    await clock.advance(0);
    connector.exit("remote", "stream closed");
    expect(monitor.status("remote")).toMatchObject({ state: "failed", lastError: "stream closed" });
    await clock.advance(60_000);
    expect(monitor.status("remote")?.state).toBe("healthy");
  });

  it("a server failing auth needs auth and is not retried until restarted", async () => {
    const { clock, connector, monitor } = setup({ locked: { kind: "auth" } });
    monitor.sync([httpServer("locked")]);
    await clock.advance(0);
    expect(monitor.status("locked")).toMatchObject({
      state: "needs_auth",
      lastError: "answered HTTP 401",
      restarts: 0,
    });
    await clock.advance(10 * 60_000);
    expect(connector.connectTimes("locked")).toHaveLength(1);
    expect(clock.pendingDelays()).toEqual([]);
    expect(monitor.restart("locked")).toBe(true);
    await clock.advance(0);
    expect(connector.connectTimes("locked")).toHaveLength(2);
  });

  it("all four stubs side by side, sorted by id", async () => {
    const { clock, monitor } = setup({
      a_healthy: { kind: "healthy" },
      b_slow: { kind: "slow", latencyMs: 3_000 },
      c_crash: { kind: "crash-on-start" },
      d_auth: { kind: "auth" },
    });
    monitor.sync([httpServer("d_auth"), stdioServer("c_crash"), httpServer("b_slow"), stdioServer("a_healthy")]);
    await clock.advance(60_000);
    expect(monitor.statuses().map((s) => [s.serverId, s.state])).toEqual([
      ["a_healthy", "healthy"],
      ["b_slow", "degraded"],
      ["c_crash", "failed"],
      ["d_auth", "needs_auth"],
    ]);
  });

  it("removing a server stops it and closes its connection", async () => {
    const { clock, connector, monitor, seen } = setup({});
    monitor.sync([stdioServer("gone")]);
    await clock.advance(0);
    monitor.sync([]);
    expect(seen.at(-1)).toMatchObject({ serverId: "gone", state: "stopped" });
    expect(connector.closed).toEqual(["gone"]);
    expect(monitor.statuses()).toEqual([]);
    expect(clock.pendingDelays()).toEqual([]);
  });
});
