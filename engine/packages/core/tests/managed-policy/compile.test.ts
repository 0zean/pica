import { describe, expect, it } from "vitest";
import { compileManagedPolicy } from "../../src/index.ts";

describe("compileManagedPolicy", () => {
  it("compiles an empty policy to no restrictions", () => {
    expect(compileManagedPolicy("p", {})).toEqual({
      ok: true,
      value: {
        id: "org",
        source: "p",
        models: {},
        mcpAllowlist: undefined,
        budget: { maxSessionCredits: undefined, maxWorkspaceDailyCredits: undefined },
        minimumPermissionMode: undefined,
        rules: [],
        configLocks: undefined,
      },
    });
  });

  it("names the key path of an unknown key, an invalid locked config key and a bad pattern", () => {
    const compiled = compileManagedPolicy("p", {
      config: { routing: { profil: "strict" } },
      rules: [{ id: "r", reason: "x", commandPattern: "(" }],
    });
    expect(compiled.ok ? [] : compiled.error.issues.map((issue) => issue.keyPath)).toEqual(["config.routing.profil", "rules.0.commandPattern"]);
    expect(compileManagedPolicy("p", { modles: {} })).toMatchObject({ ok: false, error: { code: "config.invalid", issues: [{ keyPath: "modles" }] } });
  });

  it("keeps endpoint pins on MCP allowlist entries", () => {
    const compiled = compileManagedPolicy("p", { id: "acme", mcpServers: { allow: [{ id: "github", url: "https://api.githubcopilot.com/mcp/" }] } });
    expect(compiled.ok && compiled.value.mcpAllowlist).toEqual({ id: "acme.mcp-servers", servers: [{ id: "github", url: "https://api.githubcopilot.com/mcp/" }] });
  });
});
