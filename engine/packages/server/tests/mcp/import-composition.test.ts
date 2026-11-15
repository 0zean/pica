import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpImportOptions, silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";

// `picad` (main.ts) composes the MCP import with `mcpImportOptions(homedir())`; this runs the same
// composition against a temporary home.
let home: string;
let engine: SocketListener;
let client: TestClient;
let removeSocketDir: () => Promise<void>;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "pica-m07-main-"));
  const claude = join(home, "Library", "Application Support", "Claude");
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, "claude_desktop_config.json"), JSON.stringify({ mcpServers: { notes: { command: "notes-mcp" } } }));
  const paths = await makeSocketDir();
  removeSocketDir = paths.remove;
  engine = await startEngine({ socketPath: paths.socketPath, log: silentLogger, mcpImport: mcpImportOptions(home) });
  client = await TestClient.connectAndHello(paths.socketPath);
});

afterEach(async () => {
  client.close();
  await engine.close();
  await removeSocketDir();
  rmSync(home, { recursive: true, force: true });
});

describe("picad's MCP import composition (M-07)", () => {
  it("lists servers from another platform's file under the home directory", async () => {
    const listed = await client.request("mcp.importCandidates", {});
    const sources = (listed["result"] as { sources: { platform: string; candidates: { id: string }[] }[] }).sources;
    expect(sources.find((source) => source.platform === "claude-desktop")?.candidates.map((candidate) => candidate.id)).toEqual(["notes"]);
  });

  it("imports a pasted server into the user's own mcp.jsonc", async () => {
    const imported = await client.request("mcp.import", {
      scope: "global",
      snippet: { text: JSON.stringify({ mcpServers: { search: { command: "search-mcp" } } }) },
    });
    const file = join(home, "Library", "Application Support", "Pica", "mcp.jsonc");
    expect(imported["result"]).toMatchObject({ file, servers: [{ id: "search", scope: "global" }] });
    expect(existsSync(file)).toBe(true);
  });
});
