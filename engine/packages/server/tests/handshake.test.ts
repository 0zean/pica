import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, RPC_ERROR_NUMBERS, RpcErrorResponse, RpcSuccessResponse, methods } from "@pica/protocol";
import { TestClient, helloParams, startTestEngine } from "./helpers.ts";

describe("engine.hello", () => {
  let socketPath: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ({ socketPath, stop } = await startTestEngine());
  });

  afterEach(async () => {
    await stop();
  });

  it.each([PROTOCOL_VERSION.major + 1, PROTOCOL_VERSION.major - 1])(
    "refuses a client speaking major version %i and closes the connection",
    async (major) => {
      const client = await TestClient.connect(socketPath);
      const response = RpcErrorResponse.parse(await client.request("engine.hello", helloParams(major)));
      expect(response.error.code).toBe(RPC_ERROR_NUMBERS.application);
      expect(response.error.data?.code).toBe("protocol_version_mismatch");
      expect(response.error.data?.details).toEqual({
        engine: PROTOCOL_VERSION,
        client: { major, minor: 0 },
      });
      await client.closed;
    },
  );

  it("accepts a client with the same major and a different minor version", async () => {
    const client = await TestClient.connect(socketPath);
    const params = { ...helloParams(PROTOCOL_VERSION.major), protocolVersion: { major: PROTOCOL_VERSION.major, minor: 99 } };
    const response = RpcSuccessResponse.parse(await client.request("engine.hello", params));
    const result = methods["engine.hello"].result.parse(response.result);
    expect(result.protocolVersion).toEqual(PROTOCOL_VERSION);
    expect(result.engineVersion.length).toBeGreaterThan(0);
    expect("result" in (await client.request("engine.health", {}))).toBe(true);
    client.close();
  });

  it("does not let a refused client's later requests through", async () => {
    const client = await TestClient.connect(socketPath);
    client.sendRaw(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.hello", params: helloParams(PROTOCOL_VERSION.major + 1) })}\n` +
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "engine.health", params: {} })}\n`,
    );
    await client.closed;
    const response = RpcErrorResponse.parse(await client.next((m) => m["id"] === 1));
    expect(response.error.data?.code).toBe("protocol_version_mismatch");
    expect(client.notifications()).toEqual([]);
  });
});
