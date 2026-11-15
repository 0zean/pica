import { describe, expect, it } from "vitest";
import { McpPreset, McpServerDef } from "@pica/protocol";
import type { SecretRef } from "@pica/protocol";
import { listMcpPresets, renderMcpPreset, renderMcpPresetEntry, resolveGitHubHost } from "../../src/index.ts";

function render(presetId: string, parameters: Record<string, string>, ghHost?: string): McpServerDef {
  const context = ghHost === undefined ? {} : { githubHost: resolveGitHubHost({ host: ghHost }) };
  const result = renderMcpPreset(presetId, parameters, {}, context);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  // Every rendering is a valid protocol definition.
  return McpServerDef.parse(result.value);
}

function http(id: string, name: string, url: string, headers: Record<string, string | SecretRef> = {}): McpServerDef {
  return { id, name, scope: "global", toolAllowlist: null, transport: { type: "http", url, headers } };
}

describe("preset catalog", () => {
  it("lists the four presets, sorted, as protocol DTOs", () => {
    const presets = listMcpPresets();
    expect(presets.map((preset) => preset.id)).toEqual(["clickup", "datadog", "github", "snowflake"]);
    for (const preset of presets) {
      expect(McpPreset.parse(preset)).toEqual(preset);
    }
  });

  it("requires a GitHub URL only off github.com", () => {
    const urlParameter = (host?: string) =>
      listMcpPresets(host === undefined ? {} : { githubHost: resolveGitHubHost({ host }) })
        .find((preset) => preset.id === "github")
        ?.parameters.find((parameter) => parameter.name === "url");
    expect(urlParameter()).toMatchObject({ required: false, default: "https://api.githubcopilot.com/mcp/" });
    expect(urlParameter("octo.ghe.com")).toMatchObject({ required: true, default: null });
    expect(urlParameter("ghe.corp.example")).toMatchObject({ required: true, default: null });
  });
});

describe("rendering with sample parameters (PLAN.md §2.2)", () => {
  it("GitHub with the Copilot sign-in sends no header", () => {
    expect(render("github", {})).toEqual(http("github", "GitHub", "https://api.githubcopilot.com/mcp/"));
    expect(render("github", { auth: "copilot" })).toEqual(http("github", "GitHub", "https://api.githubcopilot.com/mcp/"));
  });

  it("GitHub with a PAT sends it as a Bearer reference, defaulting to the host's Keychain item", () => {
    expect(render("github", { auth: "pat" })).toEqual(
      http("github", "GitHub", "https://api.githubcopilot.com/mcp/", {
        Authorization: "Bearer ${secret:keychain:github/github.com/pat}",
      }),
    );
    expect(render("github", { auth: "pat", patSecretRef: "env:GITHUB_MCP_PAT" })).toEqual(
      http("github", "GitHub", "https://api.githubcopilot.com/mcp/", { Authorization: "Bearer ${secret:env:GITHUB_MCP_PAT}" }),
    );
  });

  it("GitHub on GHE.com or GHES uses the URL given, and the host's PAT item", () => {
    expect(render("github", { url: "https://copilot-mcp.octo.ghe.com/mcp/", auth: "pat" }, "Octo.GHE.com")).toEqual(
      http("github", "GitHub", "https://copilot-mcp.octo.ghe.com/mcp/", {
        Authorization: "Bearer ${secret:keychain:github/octo.ghe.com/pat}",
      }),
    );
    expect(render("github", { url: "https://mcp.ghe.corp.example/mcp" }, "ghe.corp.example")).toEqual(
      http("github", "GitHub", "https://mcp.ghe.corp.example/mcp"),
    );
  });

  it("Datadog derives the URL from the site, with OAuth by default", () => {
    expect(render("datadog", {})).toEqual(http("datadog", "Datadog", "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp"));
    expect(render("datadog", { site: "DatadogHQ.eu" })).toEqual(
      http("datadog", "Datadog", "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp"),
    );
  });

  it("Datadog with keys sends both headers as secret references", () => {
    expect(
      render("datadog", {
        site: "us5.datadoghq.com",
        auth: "apiKey",
        apiKeySecretRef: "keychain:mcp/datadog/api-key",
        applicationKeySecretRef: "${secret:env:DD_APP_KEY}",
      }),
    ).toEqual(
      http("datadog", "Datadog", "https://mcp.us5.datadoghq.com/api/unstable/mcp-server/mcp", {
        "DD-API-KEY": { secretRef: "keychain:mcp/datadog/api-key" },
        "DD-APPLICATION-KEY": { secretRef: "env:DD_APP_KEY" },
      }),
    );
  });

  it("ClickUp has one URL and OAuth", () => {
    expect(render("clickup", {})).toEqual(http("clickup", "ClickUp", "https://mcp.clickup.com/mcp"));
  });

  it("Snowflake builds the account URL path and sends the PAT as a Bearer reference", () => {
    const expected = http(
      "snowflake",
      "Snowflake",
      "https://myorg-acct.snowflakecomputing.com/api/v2/databases/ANALYTICS/schemas/PUBLIC/mcp-servers/pica_mcp",
      { Authorization: "Bearer ${secret:keychain:mcp/snowflake/pat}" },
    );
    const parameters = { database: "ANALYTICS", schema: "PUBLIC", server: "pica_mcp", patSecretRef: "keychain:mcp/snowflake/pat" };
    expect(render("snowflake", { ...parameters, accountUrl: "https://myorg-acct.snowflakecomputing.com" })).toEqual(expected);
    expect(render("snowflake", { ...parameters, accountUrl: "myorg-acct.snowflakecomputing.com/" })).toEqual(expected);
  });

  it("takes a server id and scope", () => {
    const result = renderMcpPreset("clickup", {}, { serverId: "clickup-work", scope: "workspace" });
    expect(result).toEqual({
      ok: true,
      value: { ...http("clickup-work", "ClickUp", "https://mcp.clickup.com/mcp"), scope: "workspace" },
    });
  });

  it("renders the mcp.jsonc entry A-13 writes", () => {
    expect(renderMcpPresetEntry("github", { auth: "pat" })).toEqual({
      ok: true,
      value: {
        name: "GitHub",
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${secret:keychain:github/github.com/pat}" },
      },
    });
  });
});
