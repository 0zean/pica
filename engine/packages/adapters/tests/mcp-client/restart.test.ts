import { afterEach, describe, expect, it } from "vitest";
import { createMcpHealthMonitor, createSecretResolvingMcpConnector, createMcpSecretRedactor, type McpHealthMonitor } from "@pica/core";
import { createEnvSecretSource, createMcpLaunchConnector } from "../../src/index.ts";
import { ManualClock, stdioStub, waitForStatus } from "./helpers.ts";

let monitor: McpHealthMonitor | undefined;

afterEach(async () => {
  await monitor?.stop();
});

describe("a crashing stdio server", () => {
  it("is restarted with backoff and given up on after the configured attempts", async () => {
    const clock = new ManualClock();
    monitor = createMcpHealthMonitor({
      connector: createSecretResolvingMcpConnector({
        sources: { keychain: createEnvSecretSource({}), env: createEnvSecretSource({}) },
        redactor: createMcpSecretRedactor(),
        launcher: createMcpLaunchConnector({ baseEnv: { PATH: process.env["PATH"] } }),
      }),
      clock,
      options: { restart: { maxAttempts: 3, initialDelayMs: 500, multiplier: 3, maxDelayMs: 10_000 } },
    });
    // Below the 15 s request timeout, whose timer can still be pending when the exit is reported.
    const short = 10_000;
    monitor.sync([stdioStub("crash", "crash")]);
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const status = await waitForStatus(monitor, "crash", (s) => s.restarts === attempt && s.state === "connecting");
      expect(status.lastError).toBe("process exited with code 3");
      expect(clock.pending(short)).toHaveLength(1);
      delays.push(clock.fireNext(short));
    }
    expect(delays).toEqual([500, 1_500, 4_500]);
    const failed = await waitForStatus(monitor, "crash", (s) => s.state === "failed");
    expect(failed).toMatchObject({
      lastError: "process exited with code 3; gave up after 3 restart attempts",
      restarts: 3,
      latencyMs: null,
    });
    expect(clock.pending(short)).toEqual([]);
  });
});
