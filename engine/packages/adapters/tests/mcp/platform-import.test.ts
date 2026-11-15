import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpImportService, err, ok } from "@pica/core";
import type { McpSecretWriter } from "@pica/core";
import { createMcpImportFiles, JsoncMcpRegistryLoader, mcpFileSources, mcpImportFileLocations, userMcpConfigPath } from "../../src/index.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pica-m07-"));
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

function put(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function memoryBroker(): McpSecretWriter & { readonly stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    stored,
    store(secretRef, value) {
      stored.set(secretRef, value);
      return Promise.resolve(ok(undefined));
    },
  };
}

const claudeDesktop = (): string => join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

describe("M-07 discovery", () => {
  it("finds no candidates, and no error, when no platform file exists", () => {
    const files = createMcpImportFiles({ homeDir: home });
    expect(files.discover(join(home, "repo"))).toEqual([]);
    expect(createMcpImportService({ files, home }).candidates({ repoRoot: join(home, "repo") })).toEqual(ok([]));
  });

  it("lists an unreadable or unparsable file with no candidates and no error", () => {
    put(join(home, ".cursor", "mcp.json"), "{ \"mcpServers\": ");
    mkdirSync(join(home, ".codeium", "windsurf", "mcp_config.json"), { recursive: true });
    // Root reads a file whatever its mode, so the permission case runs only for other users.
    const asRoot = process.getuid?.() === 0;
    if (!asRoot) {
      put(join(home, ".gemini", "settings.json"), { mcpServers: { a: { command: "a" } } });
      chmodSync(join(home, ".gemini", "settings.json"), 0o000);
    }
    const result = createMcpImportService({ files: createMcpImportFiles({ homeDir: home }), home }).candidates({});
    expect(result.ok).toBe(true);
    const sources = result.ok ? result.value : [];
    expect(sources.map((source) => [source.platform, source.source, source.candidates.length])).toEqual([
      ["cursor", "~/.cursor/mcp.json", 0],
      ["windsurf", "~/.codeium/windsurf/mcp_config.json", 0],
      ...(asRoot ? [] : [["gemini-cli", "~/.gemini/settings.json", 0]]),
    ]);
    for (const source of sources) {
      expect(source.notes[0]?.message).toMatch(/^could not be read: /);
    }
  });

  it("looks in each platform's documented place, and in the repo for project files", () => {
    const locations = mcpImportFileLocations("/Users/dev", "/Users/dev/work/app").map((location) => [location.platform, location.file]);
    expect(locations).toEqual([
      ["claude-desktop", "/Users/dev/Library/Application Support/Claude/claude_desktop_config.json"],
      ["claude-code", "/Users/dev/.claude.json"],
      ["cursor", "/Users/dev/.cursor/mcp.json"],
      ["windsurf", "/Users/dev/.codeium/windsurf/mcp_config.json"],
      ["vscode", "/Users/dev/Library/Application Support/Code/User/mcp.json"],
      ["vscode", "/Users/dev/Library/Application Support/Code - Insiders/User/mcp.json"],
      ["gemini-cli", "/Users/dev/.gemini/settings.json"],
      ["copilot-cli", "/Users/dev/.copilot/mcp-config.json"],
      ["mcp-json", "/Users/dev/work/app/.mcp.json"],
      ["vscode", "/Users/dev/work/app/.vscode/mcp.json"],
      ["cursor", "/Users/dev/work/app/.cursor/mcp.json"],
      ["gemini-cli", "/Users/dev/work/app/.gemini/settings.json"],
    ]);
  });
});

describe("M-07 import", () => {
  const secretValue = "test-secret-value-not-real";
  const bearerValue = "test-bearer-value-not-real";

  beforeEach(() => {
    put(claudeDesktop(), {
      mcpServers: {
        github: { command: "docker", args: ["run", "--token", secretValue], env: { GITHUB_PERSONAL_ACCESS_TOKEN: secretValue } },
      },
    });
    put(join(home, ".cursor", "mcp.json"), {
      mcpServers: { remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: `Bearer ${bearerValue}` } } },
    });
  });

  it("stores inline secrets in the broker and writes only references to mcp.jsonc", async () => {
    const files = createMcpImportFiles({ homeDir: home });
    const service = createMcpImportService({ files, home });
    const listed = service.candidates({});
    const candidates = listed.ok ? listed.value.flatMap((source) => source.candidates) : [];
    expect(candidates.map((candidate) => [candidate.id, candidate.secretFields])).toEqual([
      ["github", ["mcpServers.github.args.2", "mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN"]],
      ["remote", ["mcpServers.remote.headers.Authorization"]],
    ]);
    const broker = memoryBroker();
    const result = await service.import({
      target: { scope: "global" },
      candidates: candidates.map(({ candidateId }) => ({ candidateId })),
      secrets: broker,
    });
    expect(result.ok).toBe(true);

    expect(Object.fromEntries(broker.stored)).toEqual({
      "keychain:mcp/github/args-token": secretValue,
      "keychain:mcp/github/GITHUB_PERSONAL_ACCESS_TOKEN": secretValue,
      "keychain:mcp/remote/Authorization": bearerValue,
    });
    const text = readFileSync(userMcpConfigPath(home), "utf8");
    expect(text).not.toContain(secretValue);
    expect(text).not.toContain(bearerValue);
    expect(JSON.parse(text)).toEqual({
      servers: {
        github: {
          type: "stdio",
          command: "docker",
          args: ["run", "--token", "${secret:keychain:mcp/github/args-token}"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${secret:keychain:mcp/github/GITHUB_PERSONAL_ACCESS_TOKEN}" },
          importedFrom: { platform: "claude-desktop", source: "~/Library/Application Support/Claude/claude_desktop_config.json", name: "github" },
        },
        remote: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer ${secret:keychain:mcp/remote/Authorization}" },
          importedFrom: { platform: "cursor", source: "~/.cursor/mcp.json", name: "remote" },
        },
      },
    });

    // The written file loads cleanly: no inline secret is left for M-01 to reject.
    const registry = new JsoncMcpRegistryLoader(mcpFileSources(home)).load();
    expect(registry.ok && registry.value.servers.map((server) => server.definition.id)).toEqual(["github", "remote"]);
    expect(result.ok && result.value.secretRefs).toEqual([
      "keychain:mcp/github/args-token",
      "keychain:mcp/github/GITHUB_PERSONAL_ACCESS_TOKEN",
      "keychain:mcp/remote/Authorization",
    ]);
  });

  it("writes nothing when the broker cannot store a secret", async () => {
    const service = createMcpImportService({ files: createMcpImportFiles({ homeDir: home }), home });
    const listed = service.candidates({});
    const github = listed.ok ? listed.value[0]?.candidates[0] : undefined;
    const result = await service.import({
      target: { scope: "global" },
      candidates: [{ candidateId: github?.candidateId ?? "" }],
      secrets: { store: () => Promise.resolve(err({ message: "the client answered client_disconnected" })) },
    });
    expect(result.ok ? undefined : result.error.code).toBe("mcp_import.secret_store_failed");
    expect(result.ok ? "" : result.error.message).not.toContain(secretValue);
    expect(() => readFileSync(userMcpConfigPath(home), "utf8")).toThrow();
  });

  it("keeps the target file's comments and refuses an id it already has", async () => {
    const target = join(home, "repo", ".pica", "mcp.jsonc");
    put(target, '{\n  // team servers\n  "servers": {\n    "github": { "type": "stdio", "command": "gh-mcp" }\n  }\n}\n');
    const service = createMcpImportService({ files: createMcpImportFiles({ homeDir: home }), home });
    const listed = service.candidates({});
    const github = listed.ok ? listed.value[0]?.candidates[0] : undefined;
    const selection = { candidateId: github?.candidateId ?? "" };
    const broker = memoryBroker();

    const clash = await service.import({ target: { scope: "repo", repoRoot: join(home, "repo") }, candidates: [selection], secrets: broker });
    expect(clash.ok ? undefined : clash.error.code).toBe("mcp_import.conflict");
    expect(broker.stored.size).toBe(0);

    const renamed = await service.import({
      target: { scope: "repo", repoRoot: join(home, "repo") },
      candidates: [{ ...selection, id: "github-desktop" }],
      secrets: broker,
    });
    expect(renamed.ok).toBe(true);
    const text = readFileSync(target, "utf8");
    expect(text).toContain("// team servers");
    expect(text).toContain('"github-desktop"');
    expect([...broker.stored.keys()]).toEqual(["keychain:mcp/github-desktop/args-token", "keychain:mcp/github-desktop/GITHUB_PERSONAL_ACCESS_TOKEN"]);
  });

  it("writes a workspace import to the workspace's mcp.jsonc", async () => {
    const service = createMcpImportService({ files: createMcpImportFiles({ homeDir: home }), home });
    const result = await service.import({
      target: { scope: "workspace", workspaceId: "ws-1" },
      snippet: { text: JSON.stringify({ weather: { command: "weather-mcp" } }) },
      secrets: memoryBroker(),
    });
    expect(result.ok && result.value.file).toBe(join(home, "Library", "Application Support", "Pica", "workspaces", "ws-1", "mcp.jsonc"));
    const registry = new JsoncMcpRegistryLoader(mcpFileSources(home, undefined, "ws-1")).load();
    expect(registry.ok && registry.value.servers.map((server) => [server.definition.id, server.definition.scope])).toEqual([["weather", "workspace"]]);
  });
});
