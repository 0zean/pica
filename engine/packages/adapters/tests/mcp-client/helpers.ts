import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { McpHealthClock, McpHealthMonitor } from "@pica/core";
import type { McpServerDef, McpServerStatus } from "@pica/protocol";

export const stubPath = join(import.meta.dirname, "stubs", "stdio-stub.ts");

type EnvValue = string | { secretRef: string };

export function stdioStub(id: string, mode: string, env: Record<string, EnvValue> = {}): McpServerDef {
  return {
    id,
    name: id,
    transport: {
      type: "stdio",
      command: process.execPath,
      args: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", stubPath, mode],
      env,
      cwd: null,
    },
    toolAllowlist: null,
    scope: "global",
  };
}

export function httpStub(id: string, url: string, headers: Record<string, EnvValue> = {}): McpServerDef {
  return { id, name: id, transport: { type: "http", url, headers }, toolAllowlist: null, scope: "global" };
}

// Timers fire only when the test calls `fire`; time moves only through `time`.
export class ManualClock implements McpHealthClock {
  time = Date.UTC(2026, 10, 14);
  private timers: { at: number; run: () => void }[] = [];

  now(): number {
    return this.time;
  }

  setTimer(delayMs: number, run: () => void): () => void {
    const timer = { at: this.time + delayMs, run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  // Delays of pending timers shorter than `belowMs` (the check interval and timeouts are longer).
  pending(belowMs: number): number[] {
    return this.timers.map((t) => t.at - this.time).filter((d) => d < belowMs).sort((a, b) => a - b);
  }

  fireNext(belowMs: number): number {
    const next = [...this.timers].filter((t) => t.at - this.time < belowMs).sort((a, b) => a.at - b.at)[0];
    if (next === undefined) {
      throw new Error("no timer to fire");
    }
    this.timers = this.timers.filter((t) => t !== next);
    const delay = next.at - this.time;
    this.time = next.at;
    next.run();
    return delay;
  }
}

export function waitForStatus(
  monitor: McpHealthMonitor,
  serverId: string,
  matches: (status: McpServerStatus) => boolean,
): Promise<McpServerStatus> {
  const current = monitor.status(serverId);
  if (current !== undefined && matches(current)) {
    return Promise.resolve(current);
  }
  return new Promise((resolve) => {
    const unsubscribe = monitor.subscribe((status) => {
      if (status.serverId === serverId && matches(status)) {
        unsubscribe();
        resolve(status);
      }
    });
  });
}

export type StubHandler = (message: { id?: number; method: string }, request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

export async function startHttpStub(handler: StubHandler): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      if (request.method !== "POST") {
        response.writeHead(200).end();
        return;
      }
      void handler(JSON.parse(body) as { id?: number; method: string }, request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/mcp`, server };
}

export function answer(response: ServerResponse, id: number | undefined, result: object, sse = false): void {
  const message = JSON.stringify({ jsonrpc: "2.0", id, result });
  if (sse) {
    response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sess-1" });
    response.end(`event: message\ndata: ${message}\n\n`);
  } else {
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
    response.end(message);
  }
}

export const initializeResult = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: {} },
  serverInfo: { name: "stub", version: "1" },
};
