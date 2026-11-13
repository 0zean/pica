import { describe, expect, it } from "vitest";
import { inlineSecretMessage, isSensitiveMcpName, resolveMcpServers } from "../../src/index.ts";
import type { McpLayerInput, McpSourceFormat } from "../../src/index.ts";

const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345";

function layer(format: McpSourceFormat, servers: Record<string, unknown>): McpLayerInput {
  const key = format === "pica" || format === "vscode" ? "servers" : "mcpServers";
  return { scope: "repo", format, source: `source.${format}`, value: { [key]: servers } };
}

function issuesFor(input: McpLayerInput): readonly { keyPath: string; message: string }[] {
  const result = resolveMcpServers([input]);
  if (result.ok) {
    return [];
  }
  expect(result.error.code).toBe("config.inline_secret");
  return result.error.issues;
}

const http = (headers: Record<string, unknown>, url = "https://mcp.example.com/mcp"): Record<string, unknown> => ({
  type: "http",
  url,
  headers,
});
const stdio = (fields: Record<string, unknown>): Record<string, unknown> => ({ type: "stdio", command: "server", ...fields });

describe("inline secrets", () => {
  const rejected: [string, McpSourceFormat, Record<string, unknown>, string][] = [
    ["sensitive env name", "pica", stdio({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "abc123" } }), "servers.s.env.GITHUB_PERSONAL_ACCESS_TOKEN"],
    ["api key env", "pica", stdio({ env: { DD_API_KEY: "0123456789abcdef" } }), "servers.s.env.DD_API_KEY"],
    ["password env", "pica", stdio({ env: { snowflakePassword: "hunter2" } }), "servers.s.env.snowflakePassword"],
    ["bearer literal", "pica", http({ Authorization: "Bearer abc.def" }), "servers.s.headers.Authorization"],
    ["api key header", "pica", http({ "X-API-Key": "k" }), "servers.s.headers.X-API-Key"],
    ["cookie header", "pica", http({ Cookie: "session=abc" }), "servers.s.headers.Cookie"],
    ["known token under a plain name", "pica", stdio({ env: { CONFIG: token } }), "servers.s.env.CONFIG"],
    ["token in args", "pica", stdio({ args: ["--config", token] }), "servers.s.args.1"],
    ["--token=value", "pica", stdio({ args: ["--token=abc"] }), "servers.s.args.0"],
    ["--api-key value", "pica", stdio({ args: ["--api-key", "abc"] }), "servers.s.args.1"],
    ["password in url", "pica", http({}, "https://user:pw@mcp.example.com/mcp"), "servers.s.url"],
    ["token in url query", "pica", http({}, "https://mcp.example.com/mcp?api_key=abc"), "servers.s.url"],
    ["private key", "pica", stdio({ env: { CERT: "-----BEGIN RSA PRIVATE KEY-----\nMII" } }), "servers.s.env.CERT"],
    ["literal beside a reference", "pica", http({ Authorization: "Bearer ${secret:env:A}abc" }), "servers.s.headers.Authorization"],
    ["VS Code file", "vscode", { command: "x", env: { API_TOKEN: "abc" } }, "servers.s.env.API_TOKEN"],
    [".mcp.json file", "mcp-json", { type: "http", url: "https://x.example.com", headers: { Authorization: `Bearer ${token}` } }, "mcpServers.s.headers.Authorization"],
    ["Copilot CLI file", "copilot-cli", { type: "local", command: "x", env: { SLACK_BOT_TOKEN: "xoxb-1234567890-abcdef" } }, "mcpServers.s.env.SLACK_BOT_TOKEN"],
  ];

  it.each(rejected)("rejects %s", (_name, format, server, keyPath) => {
    expect(issuesFor(layer(format, { s: server }))).toEqual([{ keyPath, message: inlineSecretMessage }]);
  });

  it("the message points to secret references and never repeats the value", () => {
    const result = resolveMcpServers([layer("pica", { s: stdio({ env: { API_TOKEN: "s3cr3t-value" } }) })]);
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.message;
    expect(message).toContain("${secret:keychain:");
    expect(message).toContain("docs/secret-references.md");
    expect(message).toContain("source.pica: servers.s.env.API_TOKEN: inline secret");
    expect(message).not.toContain("s3cr3t-value");
  });

  const accepted: [string, Record<string, unknown>][] = [
    ["references in env", stdio({ env: { GITHUB_TOKEN: "${secret:keychain:github}", PATH_TOKEN: "${secret:env:X}" } })],
    ["bearer reference", http({ Authorization: "Bearer ${secret:keychain:github/pat}" })],
    ["object reference", http({ "DD-API-KEY": { secretRef: "keychain:datadog" } })],
    ["empty sensitive value", stdio({ env: { API_TOKEN: "" } })],
    ["non-secret names", stdio({ env: { LOG_LEVEL: "debug", DD_SITE: "datadoghq.eu", OAUTH_CLIENT_ID: "abc", PRIVATE_KEY_PATH: "/k.pem" } })],
    ["reference after a sensitive flag", stdio({ args: ["--token", "${secret:env:T}"] })],
    ["plain args", stdio({ args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] })],
    ["plain url query", http({}, "https://mcp.example.com/mcp?toolsets=repos")],
  ];

  it.each(accepted)("accepts %s", (_name, server) => {
    expect(resolveMcpServers([layer("pica", { s: server })]).ok).toBe(true);
  });

  it("rejects malformed references and references outside env, headers, and args", () => {
    const result = resolveMcpServers([
      layer("pica", {
        a: stdio({ env: { A: "${secret:vault:x}" } }),
        b: { type: "stdio", command: "${secret:env:CMD}" },
        c: http({ B: { secretRef: "nope" } }),
      }),
    ]);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "config.invalid",
      issues: [
        { keyPath: "servers.a.env.A", message: "malformed secret reference ${secret:vault:x} (docs/secret-references.md)" },
        { keyPath: "servers.b.command", message: "secret references are allowed only in env, headers, and args" },
        { keyPath: "servers.c.headers.B", message: 'malformed secret reference "nope" (docs/secret-references.md)' },
      ],
    });
  });

  it.each([
    ["GITHUB_PERSONAL_ACCESS_TOKEN", true],
    ["apiKey", true],
    ["X-API-Key", true],
    ["Authorization", true],
    ["GITHUB_PAT", true],
    ["CLIENT_SECRET", true],
    ["KEYBOARD_LAYOUT", false],
    ["PRIVATE_KEY_PATH", false],
    ["AUTH_MODE", false],
    ["DD_SITE", false],
  ] as const)("isSensitiveMcpName(%s) is %s", (name, expected) => {
    expect(isSensitiveMcpName(name)).toBe(expected);
  });
});
