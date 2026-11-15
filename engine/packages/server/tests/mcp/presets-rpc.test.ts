import { describe, expect, it } from "vitest";
import { resolveGitHubHost } from "@pica/core";
import { silentLogger, startEngine } from "../../src/index.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";

async function withEngine(host: string | undefined, run: (client: TestClient) => Promise<void>): Promise<void> {
  const paths = await makeSocketDir();
  const engine = await startEngine({
    socketPath: paths.socketPath,
    log: silentLogger,
    ...(host === undefined ? {} : { githubHost: resolveGitHubHost({ host }) }),
  });
  const client = await TestClient.connectAndHello(paths.socketPath);
  try {
    await run(client);
  } finally {
    client.close();
    await engine.close();
    await paths.remove();
  }
}

describe("mcp.presets and mcp.renderPreset", () => {
  it("lists the presets and renders one without adding it", async () => {
    await withEngine(undefined, async (client) => {
      const list = (await client.request("mcp.presets", {}))["result"] as { presets: { id: string }[] };
      expect(list.presets.map((preset) => preset.id)).toEqual(["clickup", "datadog", "github", "snowflake"]);

      const rendered = await client.request("mcp.renderPreset", {
        presetId: "datadog",
        parameters: { site: "datadoghq.eu" },
        serverId: "dd-eu",
        scope: "workspace",
      });
      expect(rendered["result"]).toEqual({
        server: {
          id: "dd-eu",
          name: "Datadog",
          scope: "workspace",
          toolAllowlist: null,
          transport: { type: "http", url: "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp", headers: {} },
        },
      });
    });
  });

  it("answers invalid parameters with each one named, and unknown presets as not found", async () => {
    await withEngine("octo.ghe.com", async (client) => {
      const invalid = await client.request("mcp.renderPreset", { presetId: "github", parameters: { auth: "pat", patSecretRef: "oops" } });
      expect(invalid["error"]).toMatchObject({
        data: {
          code: "invalid_params",
          details: {
            presetId: "github",
            issues: [
              { parameter: "patSecretRef", message: expect.stringContaining("secret reference") as string },
              { parameter: "url", message: expect.stringContaining("octo.ghe.com") as string },
            ],
          },
        },
      });
      const unknown = await client.request("mcp.renderPreset", { presetId: "jira", parameters: {} });
      expect(unknown["error"]).toMatchObject({ data: { code: "not_found", details: { presetId: "jira" } } });
    });
  });
});
