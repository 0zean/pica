import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface StubMcpServerOptions {
  readonly tools: readonly StubMcpTool[];
  // When set, a request without `Authorization: Bearer <token>` gets 401.
  readonly bearerToken?: string;
}

export interface StubMcpServer {
  // http://127.0.0.1:<port>/mcp
  readonly url: string;
  // The Authorization header of every request, in order (undefined when absent).
  readonly authorizations: readonly (string | undefined)[];
  close(): Promise<void>;
}

// A Streamable HTTP MCP server on the loopback interface that answers `initialize` and
// `tools/list`, for deterministic tests with no network (PLAN.md §8).
export async function startStubMcpServer(options: StubMcpServerOptions): Promise<StubMcpServer> {
  const authorizations: (string | undefined)[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      authorizations.push(request.headers.authorization);
      answer(options, request, response, body);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

function answer(options: StubMcpServerOptions, request: IncomingMessage, response: ServerResponse, body: string): void {
  if (options.bearerToken !== undefined && request.headers.authorization !== `Bearer ${options.bearerToken}`) {
    response.writeHead(401).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const message = JSON.parse(body) as { id?: number | string; method?: string };
  if (message.id === undefined) {
    response.writeHead(202).end();
    return;
  }
  const result =
    message.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pica-stub", version: "1" } }
      : message.method === "tools/list"
        ? { tools: options.tools }
        : undefined;
  const reply =
    result === undefined
      ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } }
      : { jsonrpc: "2.0", id: message.id, result };
  response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "stub-session" });
  response.end(JSON.stringify(reply));
}

// A fetch that sends requests for an origin (such as a preset's https endpoint) to a stub's URL
// instead, so a remote preset reaches a local stub.
export function redirectingFetch(redirects: Readonly<Record<string, string>>): (url: string, init: RequestInit) => Promise<Response> {
  return (url, init) => {
    const target = new URL(url);
    const to = redirects[target.origin];
    if (to === undefined) {
      return Promise.reject(new Error(`no network in tests: ${target.origin}`));
    }
    return fetch(to, init);
  };
}
