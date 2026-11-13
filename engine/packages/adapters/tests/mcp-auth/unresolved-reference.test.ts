import { createMcpSecretRedactor, mcpAuthErrorData, resolveMcpServerSecrets, type McpAuthError } from "@pica/core";
import { ErrorData, type McpServerDef } from "@pica/protocol";
import { describe, expect, it } from "vitest";
import { createBrokerSecretSource, createEnvSecretSource, type BrokerSecretsGetCall } from "../../src/index.ts";

// The Keychain broker as A-02's client answers it: `{ value }`, or -32000 `secret_unresolved`.
function broker(items: Readonly<Record<string, string>>): BrokerSecretsGetCall {
  return ({ secretRef }) =>
    Promise.resolve(
      secretRef in items
        ? { ok: true, result: { value: items[secretRef] } }
        : { ok: false, code: "secret_unresolved", message: `no Keychain item for ${secretRef}` },
    );
}

const github: McpServerDef = {
  id: "github",
  name: "GitHub",
  transport: {
    type: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${secret:keychain:github/pat}" },
  },
  toolAllowlist: null,
  scope: "global",
};

const datadog: McpServerDef = {
  id: "datadog",
  name: "Datadog",
  transport: {
    type: "stdio",
    command: "datadog-mcp",
    args: ["--site", "datadoghq.eu"],
    env: { DD_API_KEY: { secretRef: "env:DD_API_KEY" }, DD_APP_KEY: "${secret:keychain:datadog/app}" },
    cwd: null,
  },
  toolAllowlist: null,
  scope: "workspace",
};

async function resolveError(
  definition: McpServerDef,
  items: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): Promise<McpAuthError> {
  const sources = { keychain: createBrokerSecretSource(broker(items)), env: createEnvSecretSource(env) };
  const result = await resolveMcpServerSecrets(definition, sources, createMcpSecretRedactor());
  if (result.ok) {
    throw new Error("expected the reference to stay unresolved");
  }
  return result.error;
}

describe("an unresolved secret reference", () => {
  it("in the Keychain fails with a fix that opens the server's secrets pane", async () => {
    const error = await resolveError(github, {}, {});
    expect(error.code).toBe("secret_unresolved");
    expect(error.fix).toEqual({ kind: "open_settings", label: "Add the github/pat secret", target: "mcp/github/secrets" });
    expect(error.details).toMatchObject({ serverId: "github", secretRef: "keychain:github/pat" });
  });

  it("in the environment fails with a fix that opens the server's environment pane", async () => {
    const error = await resolveError(datadog, { "keychain:datadog/app": "app-key-value" }, {});
    expect(error.code).toBe("secret_unresolved");
    expect(error.fix).toEqual({
      kind: "open_settings",
      label: "Set DD_API_KEY in the engine environment",
      target: "mcp/datadog/environment",
    });
    expect(error.details).toMatchObject({ secretRef: "env:DD_API_KEY", secretRefs: ["env:DD_API_KEY"] });
  });

  it("names every missing reference and opens the pane for the first one", async () => {
    const error = await resolveError(datadog, {}, {});
    expect(error.message).toBe("MCP server datadog needs env:DD_API_KEY, keychain:datadog/app, which are not set.");
    expect(error.fix?.target).toBe("mcp/datadog/environment");
    expect(error.details).toMatchObject({ secretRefs: ["env:DD_API_KEY", "keychain:datadog/app"] });
  });

  it("counts an empty Keychain value as unset", async () => {
    const error = await resolveError(github, { "keychain:github/pat": "" }, {});
    expect(error.fix?.target).toBe("mcp/github/secrets");
  });

  it("produces protocol ErrorData the client can offer as an action", async () => {
    const error = await resolveError(github, {}, {});
    expect(ErrorData.parse(mcpAuthErrorData(error))).toEqual({
      code: "secret_unresolved",
      fix: { kind: "open_settings", label: "Add the github/pat secret", target: "mcp/github/secrets" },
      details: { serverId: "github", secretRef: "keychain:github/pat", secretRefs: ["keychain:github/pat"] },
    });
  });

  it("is told apart from a broker that cannot answer, which offers a retry instead", async () => {
    const failing: BrokerSecretsGetCall = () =>
      Promise.resolve({ ok: false, code: "client_disconnected", message: "the client disconnected" });
    const sources = { keychain: createBrokerSecretSource(failing), env: createEnvSecretSource({}) };
    const result = await resolveMcpServerSecrets(github, sources, createMcpSecretRedactor());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("secret_unresolved");
      expect(result.error.fix).toEqual({ kind: "retry", label: "Try again" });
    }
  });
});

describe("resolved secret references", () => {
  it("are substituted into headers, env, and args", async () => {
    const sources = {
      keychain: createBrokerSecretSource(broker({ "keychain:github/pat": "ghp_x$&y", "keychain:datadog/app": "app" })),
      env: createEnvSecretSource({ DD_API_KEY: "dd-key" }),
    };
    const redactor = createMcpSecretRedactor();
    const remote = await resolveMcpServerSecrets(github, sources, redactor);
    const local = await resolveMcpServerSecrets(datadog, sources, redactor);
    expect(remote.ok && remote.value.transport).toEqual({
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ghp_x$&y" },
    });
    expect(local.ok && local.value.transport).toEqual({
      type: "stdio",
      command: "datadog-mcp",
      args: ["--site", "datadoghq.eu"],
      env: { DD_API_KEY: "dd-key", DD_APP_KEY: "app" },
      cwd: null,
    });
  });
});
