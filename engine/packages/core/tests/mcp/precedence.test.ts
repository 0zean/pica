import { describe, expect, it } from "vitest";
import type { McpScope } from "@pica/protocol";
import { mcpFormatPrecedence, mcpScopePrecedence, resolveMcpServers } from "../../src/index.ts";
import type { McpLayerInput, McpSourceFormat, ResolvedMcpRegistry } from "../../src/index.ts";

interface Layer {
  readonly scope: McpScope;
  readonly format: McpSourceFormat;
}

// Every source a scope can have; workspace definitions only come from the store, in Pica's format.
const layers: readonly Layer[] = [
  { scope: "global", format: "copilot-cli" },
  { scope: "global", format: "pica" },
  { scope: "workspace", format: "pica" },
  { scope: "repo", format: "mcp-json" },
  { scope: "repo", format: "vscode" },
  { scope: "repo", format: "pica" },
];

const label = (layer: Layer): string => `${layer.scope}/${layer.format}`;

// The same server, `shared`, written in each format; its URL names the layer that defined it.
function sharedServer(layer: Layer, extra: Record<string, unknown> = {}): McpLayerInput {
  const server = { type: "http", url: `https://${layer.scope}-${layer.format}.example.com/mcp` };
  const servers = { shared: server, ...extra };
  const value = layer.format === "vscode" ? { servers } : layer.format === "pica" ? { servers } : { mcpServers: servers };
  return { ...layer, source: label(layer), value };
}

function resolve(inputs: readonly McpLayerInput[]): ResolvedMcpRegistry {
  const result = resolveMcpServers(inputs);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function winner(registry: ResolvedMcpRegistry, id = "shared"): string {
  const server = registry.servers.find((entry) => entry.definition.id === id);
  if (server === undefined) {
    throw new Error(`no server ${id}`);
  }
  return label(server.origin);
}

const pairs = layers.flatMap((lower, index) => layers.slice(index + 1).map((higher) => ({ lower, higher })));

describe("MCP merge precedence", () => {
  it("orders scopes like config layers and Pica files above imports", () => {
    expect(mcpScopePrecedence).toEqual(["global", "workspace", "repo"]);
    expect(mcpFormatPrecedence.at(-1)).toBe("pica");
  });

  it.each(pairs.map(({ lower, higher }) => [label(lower), label(higher), lower, higher] as const))(
    "%s < %s",
    (_lowerLabel, higherLabel, lower, higher) => {
      expect(winner(resolve([sharedServer(lower), sharedServer(higher)]))).toBe(higherLabel);
      expect(winner(resolve([sharedServer(higher), sharedServer(lower)]))).toBe(higherLabel);
    },
  );

  it("the highest of all layers wins and the rest are listed as shadowed, highest first", () => {
    const registry = resolve([...layers].reverse().map((layer) => sharedServer(layer)));
    const [server] = registry.servers;
    expect(server?.definition.scope).toBe("repo");
    expect(server?.definition.transport).toMatchObject({ url: "https://repo-pica.example.com/mcp" });
    expect(server?.shadowed.map(label)).toEqual(layers.slice(0, -1).map(label).reverse());
  });

  it("replaces a definition whole rather than merging its fields", () => {
    const globalLayer: McpLayerInput = {
      scope: "global",
      format: "pica",
      source: "global",
      value: { servers: { shared: { type: "http", url: "https://a.example.com", headers: { "X-Team": "core" }, tools: ["a"] } } },
    };
    const repoLayer: McpLayerInput = {
      scope: "repo",
      format: "pica",
      source: "repo",
      value: { servers: { shared: { type: "http", url: "https://b.example.com" } } },
    };
    const [server] = resolve([globalLayer, repoLayer]).servers;
    expect(server?.definition).toEqual({
      id: "shared",
      name: "shared",
      scope: "repo",
      toolAllowlist: null,
      transport: { type: "http", url: "https://b.example.com", headers: {} },
    });
  });

  it("keeps servers with distinct ids from every layer, sorted by id", () => {
    const registry = resolve(
      layers.map((layer, index) => sharedServer(layer, { [`only-${String(index)}`]: { command: "srv", type: "stdio" } })),
    );
    expect(registry.servers.map((server) => server.definition.id)).toEqual([
      "only-0",
      "only-1",
      "only-2",
      "only-3",
      "only-4",
      "only-5",
      "shared",
    ]);
    expect(registry.servers.find((server) => server.definition.id === "only-0")?.definition.scope).toBe("global");
    expect(registry.servers.find((server) => server.definition.id === "only-5")?.definition.scope).toBe("repo");
  });

  it("an empty set of sources yields no servers", () => {
    expect(resolve([])).toEqual({ servers: [], notes: [] });
  });

  it("an invalid lower layer fails the whole registry and names its source", () => {
    const broken: McpLayerInput = { scope: "global", format: "pica", source: "global.jsonc", value: { servers: { x: { type: "ftp" } } } };
    const result = resolveMcpServers([broken, sharedServer({ scope: "repo", format: "pica" })]);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "config.invalid", file: "global.jsonc" });
  });

  it("rejects two foreign names that map to the same id", () => {
    const input: McpLayerInput = {
      scope: "repo",
      format: "mcp-json",
      source: ".mcp.json",
      value: { mcpServers: { "my server": { command: "a" }, "my-server": { command: "b" } } },
    };
    const result = resolveMcpServers([input]);
    expect(result.ok ? undefined : result.error.issues).toEqual([
      { keyPath: "mcpServers.my-server", message: 'server id "my-server" is also used by "my server"' },
    ]);
  });
});
