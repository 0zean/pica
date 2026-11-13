import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  estimateMcpPlanTokens,
  estimateMcpToolListTokens,
  estimateMcpToolTokens,
} from "../../src/index.ts";
import type { McpToolDefinition } from "../../src/index.ts";
import { agent, fixtureCatalog, plan, readJson } from "./helpers.ts";

interface Expected {
  readonly tools: Readonly<Record<string, number>>;
  readonly total: number;
}

// expected-tokens.json was produced by a separate implementation of docs/mcp-tool-budgets.md
// and reviewed; `noop` is worked by hand below.
const expected = readJson("expected-tokens.json") as Readonly<Record<string, Expected>>;
const catalog = fixtureCatalog();

describe("tool-definition token estimates", () => {
  it("covers every fixture tool list", () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [serverId, expectation] of Object.entries(expected)) {
    it(`matches expected values for ${serverId}`, () => {
      const tools = catalog[serverId] ?? [];
      const perTool = Object.fromEntries(tools.map((tool) => [tool.name, estimateMcpToolTokens(serverId, tool)]));
      expect(perTool).toEqual(expectation.tools);
      expect(estimateMcpToolListTokens(serverId, tools)).toBe(expectation.total);
    });
  }

  it("works a minimal tool by hand", () => {
    const noop: McpToolDefinition = { name: "noop", inputSchema: { type: "object" } };
    const text = '{"input_schema":{"type":"object"},"name":"scripts/noop"}';
    expect(canonicalJson({ name: "scripts/noop", input_schema: { type: "object" } })).toBe(text);
    expect(text.length).toBe(56);
    expect(estimateMcpToolTokens("scripts", noop)).toBe(56 / 4 + 4);
  });

  it("does not depend on schema key order", () => {
    const a: McpToolDefinition = { name: "t", inputSchema: { type: "object", required: ["x"], properties: { x: { type: "string" } } } };
    const b: McpToolDefinition = { name: "t", inputSchema: { properties: { x: { type: "string" } }, required: ["x"], type: "object" } };
    expect(estimateMcpToolTokens("s", a)).toBe(estimateMcpToolTokens("s", b));
  });

  it("counts only allowlisted tools and flags servers with no known tool list", () => {
    const agents = [agent("triage", ["view"])];
    const estimate = estimateMcpPlanTokens(
      plan(agents, [
        { serverId: "github", target: { kind: "session" }, tools: ["get_issue", "list_issues"] },
        { serverId: "datadog", target: { kind: "agent", agent: "triage" }, tools: null },
      ]),
      { github: catalog.github ?? [] },
    );
    const github = expected.github?.tools ?? {};
    expect(estimate.session).toEqual({
      tokens: (github.get_issue ?? 0) + (github.list_issues ?? 0),
      complete: true,
      servers: [{ serverId: "github", toolCount: 2, tokens: 243 }],
    });
    expect(estimate.agents).toEqual([
      { agent: "triage", estimate: { tokens: 0, complete: false, servers: [{ serverId: "datadog", toolCount: null, tokens: null }] } },
    ]);
  });
});
