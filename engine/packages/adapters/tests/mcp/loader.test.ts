import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copilotCliMcpConfigPath,
  JsoncMcpRegistryLoader,
  mcpFileSources,
  projectMcpJsonPath,
  repoMcpConfigPath,
  userMcpConfigPath,
  vscodeMcpConfigPath,
} from "../../src/index.ts";
import type { McpRegistrySource } from "../../src/index.ts";
import { useTempDir, writeFile } from "../config/helpers.ts";

const tempDir = useTempDir();

function server(url: string): Record<string, unknown> {
  return { type: "http", url };
}

describe("JsoncMcpRegistryLoader", () => {
  it("merges every file a repo session reads, plus workspace definitions from the store", () => {
    const home = tempDir();
    const repo = join(tempDir(), "repo");
    writeFile(copilotCliMcpConfigPath(home), JSON.stringify({ mcpServers: { a: server("https://cli.example.com"), b: server("https://cli.example.com") } }));
    writeFile(userMcpConfigPath(home), `// user\n{ "servers": { "b": ${JSON.stringify(server("https://user.example.com"))}, "c": ${JSON.stringify(server("https://user.example.com"))} } }`);
    writeFile(projectMcpJsonPath(repo), JSON.stringify({ mcpServers: { d: server("https://mcp-json.example.com"), e: server("https://mcp-json.example.com") } }));
    writeFile(vscodeMcpConfigPath(repo), JSON.stringify({ servers: { e: server("https://vscode.example.com"), f: server("https://vscode.example.com") } }));
    writeFile(repoMcpConfigPath(repo), JSON.stringify({ servers: { c: server("https://repo.example.com"), f: server("https://repo.example.com") } }));
    const sources: McpRegistrySource[] = [
      ...mcpFileSources(home, repo),
      { scope: "workspace", label: "workspace:team", value: { servers: { a: server("https://workspace.example.com"), d: server("https://workspace.example.com") } } },
    ];

    const result = new JsoncMcpRegistryLoader(sources).load();

    expect(result.ok).toBe(true);
    const winners = result.ok
      ? Object.fromEntries(result.value.servers.map((entry) => [entry.definition.id, [entry.definition.scope, entry.origin.source]]))
      : {};
    expect(winners).toEqual({
      a: ["workspace", "workspace:team"],
      b: ["global", userMcpConfigPath(home)],
      c: ["repo", repoMcpConfigPath(repo)],
      d: ["repo", projectMcpJsonPath(repo)],
      e: ["repo", vscodeMcpConfigPath(repo)],
      f: ["repo", repoMcpConfigPath(repo)],
    });
  });

  it("treats missing files as absent sources", () => {
    const result = new JsoncMcpRegistryLoader(mcpFileSources(tempDir(), tempDir())).load();
    expect(result).toEqual({ ok: true, value: { servers: [], notes: [] } });
  });

  it("locates an inline secret in an imported file by line and column", () => {
    const repo = tempDir();
    const file = writeFile(projectMcpJsonPath(repo), '{\n  "mcpServers": {\n    "gh": { "command": "x", "env": { "GITHUB_TOKEN": "abc" } }\n  }\n}\n');

    const result = new JsoncMcpRegistryLoader([{ scope: "repo", format: "mcp-json", file, root: repo }]).load();

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "config.inline_secret",
      file,
      issues: [{ keyPath: "mcpServers.gh.env.GITHUB_TOKEN", line: 3, column: 38 }],
    });
    expect(result.ok ? "" : result.error.message).toMatch(/^.*\.mcp\.json:3:38: mcpServers\.gh\.env\.GITHUB_TOKEN: inline secret;/);
  });
});
