import { describe, expect, it } from "vitest";
import { createMcpImportService, ok } from "../../src/index.ts";
import type { McpImportFiles, McpImportWrite, McpSecretWriter } from "../../src/index.ts";

// PLAN.md M-07: a pasted snippet in each common shape imports; a malformed one fails with the key path named.

const entry = { command: "npx", args: ["-y", "@example/weather-mcp"] };
const expectedWrite: McpImportWrite = {
  id: "weather",
  entry: { type: "stdio", command: "npx", args: ["-y", "@example/weather-mcp"], importedFrom: { platform: "paste", name: "weather" } },
};

function harness(): { files: McpImportFiles; writes: McpImportWrite[][]; secrets: McpSecretWriter } {
  const writes: McpImportWrite[][] = [];
  const files: McpImportFiles = {
    discover: () => [],
    readTarget: () => ok({ file: "/home/Library/Application Support/Pica/mcp.jsonc", value: undefined }),
    writeTarget: (_target, entries) => {
      writes.push([...entries]);
      return ok({ file: "/home/Library/Application Support/Pica/mcp.jsonc" });
    },
  };
  return { files, writes, secrets: { store: () => Promise.resolve(ok(undefined)) } };
}

async function importSnippet(text: string, name?: string) {
  const { files, writes, secrets } = harness();
  const result = await createMcpImportService({ files }).import({
    target: { scope: "global" },
    snippet: { text, ...(name === undefined ? {} : { name }) },
    secrets,
  });
  return { result, writes };
}

describe("pasted MCP snippets", () => {
  const shapes: [string, string, string?][] = [
    ["mcpServers", JSON.stringify({ mcpServers: { weather: entry } })],
    ["servers (VS Code)", JSON.stringify({ servers: { weather: { type: "stdio", ...entry } }, inputs: [] })],
    ["a bare name map", JSON.stringify({ weather: entry })],
    ["one entry with a name", JSON.stringify(entry), "weather"],
    ["one entry carrying its name", JSON.stringify({ name: "weather", ...entry })],
    ["a copied member without braces", `"weather": ${JSON.stringify(entry)}`],
  ];

  it.each(shapes)("imports %s", async (_shape, text, name) => {
    const { result, writes } = await importSnippet(text, name);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([[expectedWrite]]);
  });

  it("lists a snippet's servers as candidates without writing anything", () => {
    const { files, writes } = harness();
    const listed = createMcpImportService({ files }).candidates({ snippet: { text: JSON.stringify({ weather: entry }) } });
    expect(listed.ok && listed.value.map((source) => [source.platform, source.candidates.map((candidate) => candidate.id)])).toEqual([
      ["paste", ["weather"]],
    ]);
    expect(writes).toEqual([]);
  });

  it("reads each platform's variables and URL keys", async () => {
    const text = JSON.stringify({
      mcpServers: {
        windsurf: { serverUrl: "https://a.example.com/mcp", headers: { "X-Key": "${env:A_KEY}" } },
        gemini: { httpUrl: "https://b.example.com/mcp", headers: { Authorization: "Bearer ${B_TOKEN}" } },
        vscode: { command: "node", env: { KEY: "${input:c-key}" } },
      },
    });
    const { result } = await importSnippet(text);
    expect(result.ok && result.value.servers.map((server) => [server.id, server.transport])).toEqual([
      ["windsurf", { type: "http", url: "https://a.example.com/mcp", headers: { "X-Key": { secretRef: "env:A_KEY" } } }],
      ["gemini", { type: "http", url: "https://b.example.com/mcp", headers: { Authorization: "Bearer ${secret:env:B_TOKEN}" } }],
      ["vscode", { type: "stdio", command: "node", args: [], env: { KEY: { secretRef: "keychain:c-key" } }, cwd: null }],
    ]);
  });

  const malformed: [string, string, string, RegExp][] = [
    ["not JSON", "{ mcpServers: ", "", /not valid JSON/],
    ["not an object", "[1, 2]", "", /expected a JSON object/],
    ["mcpServers not an object", JSON.stringify({ mcpServers: [] }), "mcpServers", /expected an object/],
    ["an entry that is not an object", JSON.stringify({ mcpServers: { weather: "npx" } }), "mcpServers.weather", /expected an object/],
    ["a wrongly typed field", JSON.stringify({ mcpServers: { weather: { command: "npx", args: "-y" } } }), "mcpServers.weather.args", /./],
    ["a bad field in a bare map", JSON.stringify({ weather: { command: 7 } }), "weather.command", /./],
    ["a bad field in one entry", JSON.stringify({ url: "not a url" }), "url", /./],
    ["one entry without a name", JSON.stringify(entry), "", /needs a name/],
    ["no servers", "{}", "", /no MCP servers/],
  ];

  it.each(malformed)("rejects %s, naming the key path", async (_case, text, keyPath, message) => {
    const name = _case === "a bad field in one entry" ? "remote" : undefined;
    const { result, writes } = await importSnippet(text, name);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("mcp_import.malformed_snippet");
      expect(result.error.issues[0]?.keyPath).toBe(keyPath);
      expect(result.error.issues[0]?.message).toMatch(message);
      expect(result.error.message.startsWith(keyPath === "" ? "the snippet:" : `${keyPath}:`)).toBe(true);
    }
    expect(writes).toEqual([]);
  });
});
