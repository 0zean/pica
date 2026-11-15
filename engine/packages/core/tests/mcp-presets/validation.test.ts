import { describe, expect, it } from "vitest";
import { renderMcpPreset, resolveGitHubHost } from "../../src/index.ts";
import type { McpPresetContext } from "../../src/index.ts";

const snowflake = {
  accountUrl: "https://myorg-acct.snowflakecomputing.com",
  database: "ANALYTICS",
  schema: "PUBLIC",
  server: "pica_mcp",
  patSecretRef: "keychain:mcp/snowflake/pat",
};

function without(parameters: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== name));
}

function issues(
  presetId: string,
  parameters: Record<string, unknown>,
  context: McpPresetContext = {},
  serverId?: string,
): { parameter: string; message: string }[] {
  const result = renderMcpPreset(presetId, parameters, serverId === undefined ? {} : { serverId }, context);
  if (result.ok) {
    throw new Error(`${presetId} rendered`);
  }
  expect(result.error.code).toBe("mcp_preset.invalid");
  for (const issue of result.error.issues) {
    expect(result.error.message).toContain(`${issue.parameter}: ${issue.message}`);
  }
  return [...result.error.issues];
}

function named(presetId: string, parameters: Record<string, unknown>, context?: McpPresetContext): string[] {
  return issues(presetId, parameters, context).map((issue) => issue.parameter);
}

describe("missing parameters are named", () => {
  it.each(["accountUrl", "database", "schema", "server", "patSecretRef"])("snowflake %s", (parameter) => {
    const parameters = without(snowflake, parameter);
    expect(named("snowflake", parameters)).toEqual([parameter]);
    expect(named("snowflake", { ...snowflake, [parameter]: "  " })).toEqual([parameter]);
  });

  it.each(["apiKeySecretRef", "applicationKeySecretRef"])("datadog %s with key auth", (parameter) => {
    const parameters = without(
      { auth: "apiKey", apiKeySecretRef: "keychain:dd/api", applicationKeySecretRef: "keychain:dd/app" },
      parameter,
    );
    expect(named("datadog", parameters)).toEqual([parameter]);
  });

  it.each(["octo.ghe.com", "ghe.corp.example"])("github url on %s, explaining why without inventing one", (host) => {
    const found = issues("github", {}, { githubHost: resolveGitHubHost({ host }) });
    expect(found).toEqual([
      { parameter: "url", message: `is required: Pica does not know the GitHub MCP endpoint for ${host}; give the server URL` },
    ]);
  });
});

describe("malformed parameters are named", () => {
  it.each([
    ["github", { auth: "oauth" }, "auth"],
    ["github", { auth: "pat", patSecretRef: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, "patSecretRef"],
    ["github", { auth: "pat", patSecretRef: "vault:github" }, "patSecretRef"],
    ["github", { url: "http://api.githubcopilot.com/mcp/" }, "url"],
    ["github", { url: "https://user:pw@api.githubcopilot.com/mcp/" }, "url"],
    ["datadog", { site: "https://datadoghq.com" }, "site"],
    ["datadog", { site: "datadoghq" }, "site"],
    ["datadog", { site: "mcp.datadoghq.com" }, "site"],
    ["datadog", { auth: "token" }, "auth"],
    ["datadog", { auth: "apiKey", apiKeySecretRef: "abc123", applicationKeySecretRef: "keychain:dd/app" }, "apiKeySecretRef"],
    ["snowflake", { ...snowflake, accountUrl: "http://myorg-acct.snowflakecomputing.com" }, "accountUrl"],
    ["snowflake", { ...snowflake, accountUrl: "https://myorg-acct.snowflakecomputing.com/console" }, "accountUrl"],
    ["snowflake", { ...snowflake, database: "1ANALYTICS" }, "database"],
    ["snowflake", { ...snowflake, schema: "PUBLIC/../x" }, "schema"],
    ["snowflake", { ...snowflake, server: "my server" }, "server"],
    ["snowflake", { ...snowflake, patSecretRef: "${secret:keychain:}" }, "patSecretRef"],
  ] as const)("%s %j → %s", (presetId, parameters, parameter) => {
    expect(named(presetId, parameters)).toEqual([parameter]);
  });

  it("never repeats a value that may be a secret", () => {
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const result = renderMcpPreset("github", { auth: "pat", patSecretRef: token });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("rejects unknown parameters, non-strings and ones that do not apply", () => {
    expect(issues("clickup", { token: "x" })).toEqual([{ parameter: "token", message: "unknown parameter" }]);
    expect(named("datadog", { site: 42 })).toEqual(["site"]);
    expect(issues("github", { patSecretRef: "keychain:github/pat" })).toEqual([
      { parameter: "patSecretRef", message: "applies only when auth is pat" },
    ]);
  });

  it("names every bad parameter at once", () => {
    expect(named("snowflake", { accountUrl: "ftp://x", database: "ok", schema: "1", server: "" })).toEqual([
      "accountUrl",
      "schema",
      "server",
      "patSecretRef",
    ]);
  });

  it("names a bad server id", () => {
    expect(issues("clickup", {}, {}, "-bad")).toEqual([{ parameter: "serverId", message: "must match [A-Za-z0-9][A-Za-z0-9._-]*" }]);
  });

  it("reports an unknown preset", () => {
    const result = renderMcpPreset("jira", {});
    expect(result).toMatchObject({ ok: false, error: { code: "mcp_preset.unknown", presetId: "jira" } });
  });
});
