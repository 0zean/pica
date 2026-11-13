import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@pica/protocol";
import { silentLogger, startEngine } from "../src/index.ts";
import type { ConnectionLimits, SocketListener } from "../src/index.ts";

export interface JsonObject {
  [key: string]: unknown;
}

export class TestClient {
  private readonly received: JsonObject[] = [];
  private readonly waiters: (() => void)[] = [];
  private nextId = 1;
  readonly truncatedLines: string[] = [];
  readonly closed: Promise<void>;

  readonly socket: Socket;

  private constructor(socket: Socket) {
    this.socket = socket;
    createInterface({ input: socket }).on("line", (line) => {
      try {
        this.received.push(JSON.parse(line) as JsonObject);
      } catch {
        // Only a client the engine disconnected mid-frame receives a partial last line.
        this.truncatedLines.push(line);
      }
      for (const wake of this.waiters.splice(0)) {
        wake();
      }
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", () => {
        resolve();
      });
    });
  }

  static connect(socketPath: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.off("error", reject);
        resolve(new TestClient(socket));
      });
    });
  }

  static async connectAndHello(socketPath: string): Promise<TestClient> {
    const client = await TestClient.connect(socketPath);
    const response = await client.request("engine.hello", helloParams(PROTOCOL_VERSION.major));
    if (!("result" in response)) {
      throw new Error(`hello failed: ${JSON.stringify(response)}`);
    }
    return client;
  }

  sendRaw(text: string): void {
    this.socket.write(text);
  }

  async request(method: string, params?: unknown): Promise<JsonObject> {
    const id = this.nextId++;
    this.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    return this.next((message) => message["id"] === id);
  }

  notifications(): JsonObject[] {
    return this.received.filter((message) => !("id" in message));
  }

  // Resolves with the first received message matching `predicate`, removing it from the inbox.
  async next(predicate: (message: JsonObject) => boolean = () => true): Promise<JsonObject> {
    for (;;) {
      const index = this.received.findIndex(predicate);
      if (index !== -1) {
        return this.received.splice(index, 1)[0] as JsonObject;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  async waitFor(condition: () => boolean): Promise<void> {
    while (!condition()) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  close(): void {
    this.socket.destroy();
  }
}

export function helloParams(major: number): JsonObject {
  return { protocolVersion: { major, minor: 0 }, client: { name: "test", version: "0.0.0" } };
}

export async function makeSocketDir(): Promise<{ dir: string; socketPath: string; remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "picad-"));
  const dir = join(root, "run");
  return {
    dir,
    socketPath: join(dir, "picad.sock"),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

export async function startTestEngine(
  limits?: ConnectionLimits,
): Promise<{ engine: SocketListener; socketPath: string; dir: string; stop: () => Promise<void> }> {
  const paths = await makeSocketDir();
  const engine = await startEngine({
    socketPath: paths.socketPath,
    log: silentLogger,
    ...(limits === undefined ? {} : { limits }),
  });
  return {
    engine,
    socketPath: paths.socketPath,
    dir: paths.dir,
    stop: async () => {
      await engine.close();
      await paths.remove();
    },
  };
}
