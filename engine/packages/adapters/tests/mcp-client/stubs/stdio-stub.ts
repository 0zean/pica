import { createInterface } from "node:readline";

// A stub MCP server on stdio. `healthy` lists two tools over two pages; `crash` exits once initialized;
// `needs-token` exits unless STUB_TOKEN is set.
const mode = process.argv[2] ?? "healthy";

if (mode === "needs-token" && process.env["STUB_TOKEN"] !== "s3cret-token") {
  process.exit(2);
}

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const pages: Record<string, { tools: object[]; nextCursor?: string }> = {
  first: {
    tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
    nextCursor: "second",
  },
  second: {
    tools: [{ name: "get", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }],
  },
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as { id?: number; method: string; params?: { cursor?: string } };
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } },
    });
  } else if (message.method === "notifications/initialized") {
    if (mode === "crash") {
      process.exit(3);
    }
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: pages[message.params?.cursor ?? "first"] });
  }
});
