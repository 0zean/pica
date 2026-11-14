import { describe, expect, it } from "vitest";
import { createMcpHealthMonitor, mcpRestartDelayMs, defaultMcpHealthOptions } from "../../src/index.ts";
import { FakeClock, stdioServer, StubConnector } from "./helpers.ts";

const restart = { maxAttempts: 4, initialDelayMs: 1_000, maxDelayMs: 5_000, multiplier: 2, stableAfterMs: 30_000 };

describe("restarting a crashing stdio server", () => {
  it("waits 1 s, 2 s, 4 s, 5 s (capped) between attempts and gives up after the configured attempts", async () => {
    const clock = new FakeClock();
    const connector = new StubConnector(clock, { crash: { kind: "crash-on-start" } });
    const monitor = createMcpHealthMonitor({ connector, clock, options: { restart } });
    const start = clock.now();
    monitor.sync([stdioServer("crash")]);
    await clock.advance(60 * 60_000);
    const gaps = connector.connectTimes("crash").map((at, i, all) => at - (all[i - 1] ?? start));
    expect(gaps).toEqual([0, 1_000, 2_000, 4_000, 5_000]);
    expect(monitor.status("crash")).toMatchObject({
      state: "failed",
      lastError: "process exited with code 1; gave up after 4 restart attempts",
      restarts: 4,
    });
    expect(clock.pendingDelays()).toEqual([]);
  });

  it("a crash during the backoff window of a later attempt still counts toward the limit", async () => {
    const clock = new FakeClock();
    const connector = new StubConnector(clock, { crash: { kind: "crash-after-start" } });
    const monitor = createMcpHealthMonitor({ connector, clock, options: { restart } });
    monitor.sync([stdioServer("crash")]);
    await clock.advance(60_000);
    expect(connector.connectTimes("crash")).toHaveLength(5);
    expect(monitor.status("crash")?.state).toBe("failed");
  });

  it("a server that stayed up past stableAfterMs starts counting again", async () => {
    const clock = new FakeClock();
    const connector = new StubConnector(clock, { flaky: { kind: "healthy" } });
    const monitor = createMcpHealthMonitor({ connector, clock, options: { restart, checkIntervalMs: 600_000 } });
    monitor.sync([stdioServer("flaky")]);
    await clock.advance(0);
    for (let i = 0; i < 3; i++) {
      connector.exit("flaky", "process exited with code 1");
      await clock.advance(10_000);
    }
    expect(monitor.status("flaky")).toMatchObject({ state: "healthy", restarts: 3 });
    await clock.advance(30_000);
    connector.exit("flaky", "process exited with code 1");
    expect(monitor.status("flaky")).toMatchObject({ state: "connecting", restarts: 1 });
    expect(clock.pendingDelays()[0]).toBe(1_000);
  });

  it("restart() after giving up tries again with a fresh count", async () => {
    const clock = new FakeClock();
    const connector = new StubConnector(clock, { crash: { kind: "crash-on-start" } });
    const monitor = createMcpHealthMonitor({ connector, clock, options: { restart: { ...restart, maxAttempts: 1 } } });
    monitor.sync([stdioServer("crash")]);
    await clock.advance(60_000);
    expect(monitor.status("crash")?.state).toBe("failed");
    monitor.restart("crash");
    await clock.advance(0);
    expect(monitor.status("crash")).toMatchObject({ state: "connecting", restarts: 1 });
    expect(connector.connectTimes("crash")).toHaveLength(3);
  });

  it("the default schedule doubles from 1 s and caps at 30 s", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => mcpRestartDelayMs(defaultMcpHealthOptions.restart, n));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });
});
