import { describe, expect, it } from "vitest";
import { TestClient, startTestEngine } from "./helpers.ts";

const COUNT = 2000;

function warning(index: number): { code: string; message: string; at: string } {
  return { code: `w${String(index)}`, message: "x".repeat(index % 300), at: new Date(1_700_000_000_000 + index).toISOString() };
}

describe("notifications", () => {
  it("delivers the same notifications in the same order to two clients", async () => {
    const { engine, socketPath, stop } = await startTestEngine();
    const first = await TestClient.connectAndHello(socketPath);
    const second = await TestClient.connectAndHello(socketPath);
    const notHandshaken = await TestClient.connect(socketPath);

    const requests: Promise<unknown>[] = [];
    for (let index = 0; index < COUNT; index++) {
      engine.broadcast("engine.warning", warning(index));
      if (index % 100 === 0) {
        requests.push(first.request("engine.health", {}), second.request("engine.health", {}));
      }
    }
    await Promise.all(requests);
    await first.waitFor(() => first.notifications().length === COUNT);
    await second.waitFor(() => second.notifications().length === COUNT);

    const codes = (client: TestClient): unknown[] =>
      client.notifications().map((message) => (message["params"] as { code: string }).code);
    expect(codes(first)).toEqual(Array.from({ length: COUNT }, (_, index) => `w${String(index)}`));
    expect(second.notifications()).toEqual(first.notifications());
    expect([...first.truncatedLines, ...second.truncatedLines]).toEqual([]);
    expect(first.notifications()[0]).toEqual({ jsonrpc: "2.0", method: "engine.warning", params: warning(0) });

    expect("result" in (await notHandshaken.request("engine.hello", {
      protocolVersion: { major: 1, minor: 0 },
      client: { name: "late", version: "0" },
    }))).toBe(true);
    expect(notHandshaken.notifications()).toEqual([]);

    for (const client of [first, second, notHandshaken]) {
      client.close();
    }
    await stop();
  });

  it("rejects a notification whose params do not match its schema", async () => {
    const { engine, stop } = await startTestEngine();
    expect(() => {
      engine.broadcast("engine.warning", { code: "", message: "m", at: "yesterday" });
    }).toThrow();
    await stop();
  });

  it("disconnects a client that stops reading without delaying the others", async () => {
    const { engine, socketPath, stop } = await startTestEngine({ maxFrameBytes: 4096, maxBufferedBytes: 256 * 1024 });
    const reader = await TestClient.connectAndHello(socketPath);
    const stalled = await TestClient.connectAndHello(socketPath);
    stalled.socket.pause();

    const big = 10_000;
    const batch = 50;
    for (let index = 0; index < big; index++) {
      engine.broadcast("engine.warning", { ...warning(index), message: "y".repeat(1000) });
      if ((index + 1) % batch === 0) {
        await reader.waitFor(() => reader.notifications().length === index + 1);
      }
    }
    expect(engine.connectionCount).toBe(1);
    // A paused socket never reads the engine's EOF; resuming lets it see that the engine hung up.
    stalled.socket.resume();
    await stalled.closed;
    expect(reader.truncatedLines).toEqual([]);
    reader.close();
    await stop();
  });
});
