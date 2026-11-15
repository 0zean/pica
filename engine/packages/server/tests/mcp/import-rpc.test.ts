import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachMcpServers, createMcpImportService, mcpSessionConfig } from "@pica/core";
import { createMcpImportFiles, JsoncMcpRegistryLoader, mcpFileSources } from "@pica/adapters";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";

const secretValue = "test-secret-value-not-real";

let home: string;
let repoRoot: string;
let engine: SocketListener;
let client: TestClient;
let removeSocketDir: () => Promise<void>;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "pica-m07-rpc-"));
  repoRoot = join(home, "work", "app");
  mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
  writeFileSync(
    join(repoRoot, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { docs: { command: "docs-mcp", env: { DOCS_TOKEN: secretValue } } } }),
  );
  const paths = await makeSocketDir();
  removeSocketDir = paths.remove;
  engine = await startEngine({
    socketPath: paths.socketPath,
    log: silentLogger,
    mcpImport: {
      service: createMcpImportService({ files: createMcpImportFiles({ homeDir: home }), home }),
      repoRoot: (repoId) => (repoId === "repo-1" ? repoRoot : undefined),
    },
  });
  client = await TestClient.connectAndHello(paths.socketPath);
});

afterEach(async () => {
  client.close();
  await engine.close();
  await removeSocketDir();
  rmSync(home, { recursive: true, force: true });
});

// Answers each `secrets.set` the engine sends, the way the app's Keychain broker does.
function answerSecrets(stored: Map<string, string>): void {
  void (async () => {
    for (;;) {
      const request = await client.next((message) => message["method"] === "secrets.set");
      const params = request["params"] as { secretRef: string; value: string };
      stored.set(params.secretRef, params.value);
      client.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", id: request["id"], result: { ok: true } })}\n`);
    }
  })();
}

async function candidates(): Promise<JsonObject[]> {
  const listed = await client.request("mcp.importCandidates", { repoId: "repo-1" });
  const sources = (listed["result"] as { sources: { candidates: JsonObject[] }[] }).sources;
  return sources.flatMap((source) => source.candidates);
}

describe("mcp.importCandidates and mcp.import", () => {
  it("lists a repo's project files and imports the chosen server at repo scope", async () => {
    const found = await candidates();
    expect(found.map((candidate) => [candidate["platform"], candidate["id"], candidate["secretFields"]])).toEqual([
      ["cursor", "docs", ["mcpServers.docs.env.DOCS_TOKEN"]],
    ]);
    const stored = new Map<string, string>();
    answerSecrets(stored);
    const imported = await client.request("mcp.import", {
      scope: "repo",
      repoId: "repo-1",
      candidates: [{ candidateId: found[0]?.["candidateId"] }],
    });
    expect(imported["result"]).toEqual({
      servers: [
        {
          id: "docs",
          name: "docs",
          transport: { type: "stdio", command: "docs-mcp", args: [], env: { DOCS_TOKEN: { secretRef: "keychain:mcp/docs/DOCS_TOKEN" } }, cwd: null },
          toolAllowlist: null,
          scope: "repo",
        },
      ],
      file: join(repoRoot, ".pica", "mcp.jsonc"),
      secretRefs: ["keychain:mcp/docs/DOCS_TOKEN"],
      notes: [],
    });
    expect(stored).toEqual(new Map([["keychain:mcp/docs/DOCS_TOKEN", secretValue]]));
    expect(readFileSync(join(repoRoot, ".pica", "mcp.jsonc"), "utf8")).not.toContain(secretValue);
  });

  it("never attaches an imported server to a session", async () => {
    answerSecrets(new Map());
    const found = await candidates();
    // A project file's candidate is found again through the same repoId, whatever the target scope.
    const global = await client.request("mcp.import", { scope: "global", repoId: "repo-1", candidates: [{ candidateId: found[0]?.["candidateId"] }] });
    expect(global["error"]).toBeUndefined();
    const pasted = await client.request("mcp.import", { scope: "repo", repoId: "repo-1", snippet: { text: JSON.stringify({ weather: { command: "weather-mcp" } }) } });
    expect(pasted["error"]).toBeUndefined();

    const registry = new JsoncMcpRegistryLoader(mcpFileSources(home, repoRoot)).load();
    const servers = registry.ok ? registry.value.servers.map((server) => server.definition) : [];
    expect(servers.map((server) => server.id)).toEqual(["docs", "weather"]);
    // The servers are defined, but a session gets one only when the user attaches it (M-04).
    const plan = attachMcpServers(servers, ["main"], []);
    expect(plan.ok && plan.value.session).toEqual([]);
    expect(plan.ok && mcpSessionConfig(plan.value)).toEqual({ customAgents: [{ name: "main" }] });
    // The import wrote definitions and an origin, and nothing that selects a server for a session.
    const written = JSON.parse(readFileSync(join(home, "Library", "Application Support", "Pica", "mcp.jsonc"), "utf8")) as {
      servers: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(written.servers["docs"] ?? {}).sort()).toEqual(["command", "env", "importedFrom", "type"]);
  });

  it("names the key path of a malformed snippet", async () => {
    const response = await client.request("mcp.import", {
      scope: "global",
      snippet: { text: JSON.stringify({ mcpServers: { weather: { command: "weather-mcp", args: "--fast" } } }) },
    });
    expect(response["error"]).toMatchObject({
      data: { code: "invalid_params", details: { reason: "mcp_import.malformed_snippet", issues: [{ keyPath: "mcpServers.weather.args" }] } },
    });
    expect((response["error"] as { message: string }).message).toMatch(/^mcpServers\.weather\.args: /);
  });

  it("asks for the repo or workspace a scoped import needs", async () => {
    const snippet = { text: JSON.stringify({ weather: { command: "weather-mcp" } }) };
    expect((await client.request("mcp.import", { scope: "repo", snippet }))["error"]).toMatchObject({ data: { code: "invalid_params" } });
    expect((await client.request("mcp.import", { scope: "workspace", snippet }))["error"]).toMatchObject({ data: { code: "invalid_params" } });
    expect((await client.request("mcp.import", { scope: "repo", repoId: "nope", snippet }))["error"]).toMatchObject({ data: { code: "not_found" } });
  });
});
