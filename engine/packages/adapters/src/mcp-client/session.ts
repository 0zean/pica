import { err, ok, type JsonObject, type McpProbeFailure, type McpToolDefinition, type Result } from "@pica/core";

export const mcpClientProtocolVersion = "2025-06-18";

// One JSON-RPC conversation with an MCP server, over whichever transport.
export interface McpRpcSession {
  request(method: string, params: JsonObject): Promise<Result<unknown, McpProbeFailure>>;
  notify(method: string, params: JsonObject): Promise<Result<void, McpProbeFailure>>;
}

type Rec = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Turns a JSON-RPC response object into its result. Error messages from the server are kept out:
// they may quote the request, and a request can carry credentials.
export function responseResult(response: Rec, method: string): Result<unknown, McpProbeFailure> {
  const error = response["error"];
  if (isRecord(error)) {
    const code = typeof error["code"] === "number" ? String(error["code"]) : "unknown";
    return err({ kind: "protocol", message: `${method} failed with JSON-RPC error ${code}` });
  }
  return ok(response["result"]);
}

export async function initializeMcpSession(session: McpRpcSession): Promise<Result<void, McpProbeFailure>> {
  const initialized = await session.request("initialize", {
    protocolVersion: mcpClientProtocolVersion,
    capabilities: {},
    clientInfo: { name: "pica", version: "0.0.0" },
  });
  if (!initialized.ok) {
    return initialized;
  }
  return session.notify("notifications/initialized", {});
}

export async function listMcpTools(
  session: McpRpcSession,
): Promise<Result<readonly McpToolDefinition[], McpProbeFailure>> {
  const tools: McpToolDefinition[] = [];
  let cursor: string | undefined;
  do {
    const page = await session.request("tools/list", cursor === undefined ? {} : { cursor });
    if (!page.ok) {
      return page;
    }
    if (!isRecord(page.value) || !Array.isArray(page.value["tools"])) {
      return err({ kind: "protocol", message: "tools/list returned no tool array" });
    }
    for (const item of page.value["tools"]) {
      const tool = toolDefinition(item);
      if (tool === undefined) {
        return err({ kind: "protocol", message: "tools/list returned a tool without a name or input schema" });
      }
      tools.push(tool);
    }
    const next = page.value["nextCursor"];
    cursor = typeof next === "string" && next.length > 0 ? next : undefined;
  } while (cursor !== undefined);
  return ok(tools);
}

function toolDefinition(value: unknown): McpToolDefinition | undefined {
  if (!isRecord(value) || typeof value["name"] !== "string" || !isRecord(value["inputSchema"])) {
    return undefined;
  }
  // Parsed from JSON, so every nested value is JSON.
  const inputSchema = value["inputSchema"] as JsonObject;
  const description = value["description"];
  const annotations = value["annotations"];
  return {
    name: value["name"],
    inputSchema,
    ...(typeof description === "string" ? { description } : {}),
    ...(isRecord(annotations) ? { annotations } : {}),
  };
}
