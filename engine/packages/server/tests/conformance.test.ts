import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RPC_ERROR_NUMBERS, RpcErrorResponse, RpcSuccessResponse, methods } from "@pica/protocol";
import { NdjsonDecoder } from "../src/index.ts";
import { TestClient, helloParams, startTestEngine } from "./helpers.ts";
import type { JsonObject } from "./helpers.ts";

const MAX_FRAME_BYTES = 4096;

function expectError(response: JsonObject, id: number | string | null, number: number, code: string): JsonObject {
  const parsed = RpcErrorResponse.parse(response);
  expect(parsed.id).toBe(id);
  expect(parsed.error.code).toBe(number);
  expect(parsed.error.data?.code).toBe(code);
  expect(parsed.error.message.length).toBeGreaterThan(0);
  return parsed.error.data?.details ?? {};
}

describe("RPC conformance", () => {
  let stop: () => Promise<void>;
  let client: TestClient;

  beforeEach(async () => {
    const started = await startTestEngine({ maxFrameBytes: MAX_FRAME_BYTES, maxBufferedBytes: 1024 * 1024 });
    stop = started.stop;
    client = await TestClient.connectAndHello(started.socketPath);
  });

  afterEach(async () => {
    client.close();
    await stop();
  });

  it("answers malformed JSON with parse_error and a null id", async () => {
    client.sendRaw('{"jsonrpc":"2.0","id":1,"method":\n');
    expectError(await client.next(), null, RPC_ERROR_NUMBERS.parse_error, "parse_error");
  });

  it("answers a non-request object with invalid_request, keeping its id", async () => {
    client.sendRaw(`${JSON.stringify({ jsonrpc: "1.0", id: 7, method: "engine.health" })}\n`);
    expectError(await client.next(), 7, RPC_ERROR_NUMBERS.invalid_request, "invalid_request");
    client.sendRaw("[1,2]\n");
    expectError(await client.next(), null, RPC_ERROR_NUMBERS.invalid_request, "invalid_request");
  });

  it("answers an unknown method with method_not_found", async () => {
    const response = await client.request("nope.nothing", {});
    const details = expectError(response, 2, RPC_ERROR_NUMBERS.method_not_found, "method_not_found");
    expect(details).toEqual({ method: "nope.nothing" });
  });

  it("answers an engine-to-client method sent by a client with method_not_found", async () => {
    const response = await client.request("secrets.get", { secretRef: "x" });
    expectError(response, 2, RPC_ERROR_NUMBERS.method_not_found, "method_not_found");
  });

  it("answers a known method without a handler with method_not_found marked not implemented", async () => {
    expect(Object.hasOwn(methods, "workspace.list")).toBe(true);
    const details = expectError(
      await client.request("workspace.list", {}),
      2,
      RPC_ERROR_NUMBERS.method_not_found,
      "method_not_found",
    );
    expect(details).toEqual({ method: "workspace.list", implemented: false });
  });

  it("answers invalid params with invalid_params naming the bad path", async () => {
    const response = await client.request("engine.hello", { protocolVersion: { major: "one", minor: 0 } });
    const details = expectError(response, 2, RPC_ERROR_NUMBERS.invalid_params, "invalid_params");
    const paths = (details["issues"] as { path: string[] }[]).map((issue) => issue.path.join("."));
    expect(paths).toContain("protocolVersion.major");
    expect(paths).toContain("client");
  });

  it("answers an oversized frame with frame_too_large and keeps serving the connection", async () => {
    client.sendRaw(`{"jsonrpc":"2.0","id":99,"method":"engine.health","params":{"pad":"${"x".repeat(MAX_FRAME_BYTES)}"}}\n`);
    const details = expectError(await client.next(), null, RPC_ERROR_NUMBERS.invalid_request, "frame_too_large");
    expect(details).toEqual({ maxFrameBytes: MAX_FRAME_BYTES });
    const health = RpcSuccessResponse.parse(await client.request("engine.health", {}));
    expect(health.id).toBe(2);
  });

  it("serves engine.health with a result matching its schema", async () => {
    const response = RpcSuccessResponse.parse(await client.request("engine.health"));
    const result = methods["engine.health"].result.parse(response.result);
    expect(result.status).toBe("ok");
    expect(result.sessionsRunning).toBe(0);
  });

  it("ignores client notifications and responses", async () => {
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", method: "engine.health" })}\n`);
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: 50, result: {} })}\n`);
    const response = RpcSuccessResponse.parse(await client.request("engine.health", {}));
    expect(response.id).toBe(2);
    expect(client.notifications()).toEqual([]);
  });
});

describe("before the handshake", () => {
  it("refuses any request other than engine.hello with invalid_state, then accepts hello", async () => {
    const { socketPath, stop } = await startTestEngine();
    const client = await TestClient.connect(socketPath);
    expectError(await client.request("engine.health", {}), 1, RPC_ERROR_NUMBERS.application, "invalid_state");
    expect("result" in (await client.request("engine.hello", helloParams(1)))).toBe(true);
    expect("result" in (await client.request("engine.health", {}))).toBe(true);
    client.close();
    await stop();
  });

  it("handles pipelined requests sent with hello in order", async () => {
    const { socketPath, stop } = await startTestEngine();
    const client = await TestClient.connect(socketPath);
    client.sendRaw(
      `${JSON.stringify({ jsonrpc: "2.0", id: "a", method: "engine.hello", params: helloParams(1) })}\n` +
        `${JSON.stringify({ jsonrpc: "2.0", id: "b", method: "engine.health", params: {} })}\n`,
    );
    expect(RpcSuccessResponse.parse(await client.next((m) => m["id"] === "a")).id).toBe("a");
    expect(RpcSuccessResponse.parse(await client.next((m) => m["id"] === "b")).id).toBe("b");
    client.close();
    await stop();
  });
});

describe("NdjsonDecoder", () => {
  const bytes = (text: string): Buffer => Buffer.from(text, "utf8");

  it("joins lines split across chunks, including inside a multi-byte character", () => {
    const decoder = new NdjsonDecoder(64);
    const line = Buffer.from('{"a":"é"}\n{"b":2}\n', "utf8");
    const frames = [...decoder.push(line.subarray(0, 7)), ...decoder.push(line.subarray(7))];
    expect(frames).toEqual([
      { kind: "line", text: '{"a":"é"}' },
      { kind: "line", text: '{"b":2}' },
    ]);
  });

  it("reports an oversized line once and resynchronises at the next newline", () => {
    const decoder = new NdjsonDecoder(8);
    const frames = [
      ...decoder.push(bytes("0123456")),
      ...decoder.push(bytes("789abc")),
      ...decoder.push(bytes("def\n{}\n")),
    ];
    expect(frames).toEqual([
      { kind: "too_large", bytes: 13 },
      { kind: "line", text: "{}" },
    ]);
  });

  it("accepts a line of exactly the maximum size and skips blank lines", () => {
    const decoder = new NdjsonDecoder(4);
    expect(decoder.push(bytes("\n\r\n1234\n"))).toEqual([{ kind: "line", text: "1234" }]);
  });
});
