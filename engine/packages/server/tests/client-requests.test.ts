import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Connection, DEFAULT_LIMITS, MethodRouter, silentLogger } from "../src/index.ts";
import { TestClient, makeSocketDir } from "./helpers.ts";

interface Pair {
  readonly connection: Connection;
  readonly client: TestClient;
}

let cleanup: () => Promise<void> = () => Promise.resolve();

afterEach(async () => {
  await cleanup();
});

// One engine-side Connection and the client socket at its other end.
async function connectedPair(): Promise<Pair> {
  const paths = await makeSocketDir();
  await mkdir(paths.dir, { recursive: true });
  let accepted: ((connection: Connection) => void) | undefined;
  const connectionReady = new Promise<Connection>((resolve) => {
    accepted = resolve;
  });
  const server: Server = createServer((socket) => {
    accepted?.(new Connection(1, socket, new MethodRouter(), DEFAULT_LIMITS, silentLogger));
  });
  await new Promise<void>((resolve) => server.listen(paths.socketPath, resolve));
  const client = await TestClient.connect(paths.socketPath);
  const connection = await connectionReady;
  cleanup = async () => {
    client.close();
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    await paths.remove();
  };
  return { connection, client };
}

describe("engine-to-client requests", () => {
  it("resolve with the client's result", async () => {
    const { connection, client } = await connectedPair();
    const reply = connection.request("secrets.get", { secretRef: "keychain:github/pat" });
    const request = await client.next((message) => message["method"] === "secrets.get");
    expect(request).toEqual({ jsonrpc: "2.0", id: "engine-1", method: "secrets.get", params: { secretRef: "keychain:github/pat" } });
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: request["id"], result: { value: "v" } })}\n`);
    expect(await reply).toEqual({ ok: true, result: { value: "v" } });
  });

  it("resolve with the client's error code", async () => {
    const { connection, client } = await connectedPair();
    const reply = connection.request("secrets.get", { secretRef: "keychain:missing" });
    const request = await client.next();
    client.sendRaw(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request["id"],
        error: { code: -32000, message: "no item", data: { code: "secret_unresolved", details: { secretRef: "keychain:missing" } } },
      })}\n`,
    );
    expect(await reply).toEqual({ ok: false, code: "secret_unresolved", message: "no item" });
  });

  it("name the JSON-RPC error when the client sends no data.code", async () => {
    const { connection, client } = await connectedPair();
    const reply = connection.request("secrets.get", { secretRef: "keychain:x" });
    const request = await client.next();
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: request["id"], error: { code: -32601, message: "unknown" } })}\n`);
    expect(await reply).toEqual({ ok: false, code: "method_not_found", message: "unknown" });
  });

  it("are matched by id when answered out of order", async () => {
    const { connection, client } = await connectedPair();
    const first = connection.request("secrets.get", { secretRef: "keychain:a" });
    const second = connection.request("secrets.get", { secretRef: "keychain:b" });
    const requestA = await client.next();
    const requestB = await client.next();
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: requestB["id"], result: { value: "b" } })}\n`);
    client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: requestA["id"], result: { value: "a" } })}\n`);
    expect(await Promise.all([first, second])).toEqual([
      { ok: true, result: { value: "a" } },
      { ok: true, result: { value: "b" } },
    ]);
  });

  it("resolve as disconnected when the client goes away", async () => {
    const { connection, client } = await connectedPair();
    const reply = connection.request("secrets.get", { secretRef: "keychain:x" });
    await client.next();
    client.close();
    expect(await reply).toEqual({ ok: false, code: "client_disconnected", message: "the client disconnected" });
  });
});
