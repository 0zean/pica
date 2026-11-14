import {
  err,
  ok,
  type McpConnection,
  type McpLaunchTransport,
  type McpProbeFailure,
  type Result,
} from "@pica/core";
import {
  errorMessage,
  initializeMcpSession,
  isRecord,
  listMcpTools,
  mcpClientProtocolVersion,
  responseResult,
  type McpRpcSession,
} from "./session.ts";

type HttpLaunch = Extract<McpLaunchTransport, { type: "http" | "sse" }>;
export type McpHttpFetch = (url: string, init: RequestInit) => Promise<Response>;

// MCP Streamable HTTP: each message is a POST; the answer is JSON or a short SSE stream. The legacy
// two-endpoint SSE transport is not probed separately; servers configured as `sse` usually accept
// Streamable HTTP on the same URL. Failure messages carry status codes, never response bodies.
export async function connectHttpMcpServer(
  launch: HttpLaunch,
  doFetch: McpHttpFetch,
): Promise<Result<McpConnection, McpProbeFailure>> {
  const server = new HttpServer(launch, doFetch);
  const initialized = await initializeMcpSession(server);
  if (!initialized.ok) {
    return initialized;
  }
  return ok({ listTools: () => listMcpTools(server), close: () => server.close() });
}

class HttpServer implements McpRpcSession {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialized = false;

  constructor(
    private readonly launch: HttpLaunch,
    private readonly doFetch: McpHttpFetch,
  ) {}

  async request(method: string, params: object): Promise<Result<unknown, McpProbeFailure>> {
    const id = this.nextId++;
    const posted = await this.post({ jsonrpc: "2.0", id, method, params }, method);
    if (!posted.ok) {
      return posted;
    }
    const response = await responseMessage(posted.value, id);
    if (response === undefined) {
      return err({ kind: "protocol", message: `${method} returned no JSON-RPC response` });
    }
    if (method === "initialize") {
      this.sessionId = posted.value.headers.get("mcp-session-id") ?? undefined;
      this.initialized = true;
    }
    return responseResult(response, method);
  }

  async notify(method: string, params: object): Promise<Result<void, McpProbeFailure>> {
    const posted = await this.post({ jsonrpc: "2.0", method, params }, method);
    if (!posted.ok) {
      return posted;
    }
    await posted.value.body?.cancel();
    return ok(undefined);
  }

  async close(): Promise<void> {
    if (this.sessionId === undefined) {
      return;
    }
    try {
      const response = await this.doFetch(this.launch.url, { method: "DELETE", headers: this.headers() });
      await response.body?.cancel();
    } catch {
      // The server forgets idle sessions on its own.
    }
  }

  private async post(message: object, method: string): Promise<Result<Response, McpProbeFailure>> {
    let response: Response;
    try {
      response = await this.doFetch(this.launch.url, {
        method: "POST",
        headers: {
          ...this.headers(),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
      });
    } catch (error) {
      return err({ kind: "unreachable", message: `${method}: ${origin(this.launch.url)} unreachable: ${errorMessage(error)}` });
    }
    if (response.ok) {
      return ok(response);
    }
    await response.body?.cancel();
    const status = `${method}: ${origin(this.launch.url)} answered HTTP ${String(response.status)}`;
    if (response.status === 401 || response.status === 403) {
      return err({ kind: "auth", message: status });
    }
    return err({ kind: response.status >= 500 ? "unreachable" : "protocol", message: status });
  }

  private headers(): Record<string, string> {
    return {
      ...this.launch.headers,
      ...(this.sessionId === undefined ? {} : { "mcp-session-id": this.sessionId }),
      ...(this.initialized ? { "mcp-protocol-version": mcpClientProtocolVersion } : {}),
    };
  }
}

async function responseMessage(
  response: Response,
  id: number,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  const candidates = isStream ? sseData(text) : [text];
  for (const candidate of candidates) {
    const message = parseJson(candidate);
    if (isRecord(message) && message["id"] === id) {
      return message;
    }
  }
  return undefined;
}

function sseData(text: string): string[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data.length > 0);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// The path and query can carry credentials, so messages name the origin only.
function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "the server";
  }
}
