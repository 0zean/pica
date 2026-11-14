import type { McpAuthError } from "../mcp-auth/errors.ts";
import type { McpSecretRedactor } from "../mcp-auth/redact.ts";
import { resolveMcpServerSecrets } from "../mcp-auth/resolve-secrets.ts";
import type { McpSecretSources } from "../mcp-auth/secret-source.ts";
import { err } from "../result.ts";
import type { McpConnector, McpLaunchConnector, McpProbeFailure } from "./ports.ts";

export interface SecretResolvingMcpConnectorDeps {
  readonly sources: McpSecretSources;
  readonly redactor: McpSecretRedactor;
  readonly launcher: McpLaunchConnector;
}

// Substitutes secret references before each connection and redacts every message coming back,
// since a server may echo its credentials in an error.
export function createSecretResolvingMcpConnector(deps: SecretResolvingMcpConnectorDeps): McpConnector {
  const redact = (failure: McpProbeFailure): McpProbeFailure => ({
    kind: failure.kind,
    message: deps.redactor.redact(failure.message),
  });
  return {
    async connect(definition, onExit) {
      const launch = await resolveMcpServerSecrets(definition, deps.sources, deps.redactor);
      if (!launch.ok) {
        return err(secretFailure(launch.error));
      }
      const connected = await deps.launcher.connect(launch.value, (reason) => {
        onExit(deps.redactor.redact(reason));
      });
      if (!connected.ok) {
        return err(redact(connected.error));
      }
      const connection = connected.value;
      return {
        ok: true,
        value: {
          async listTools() {
            const tools = await connection.listTools();
            return tools.ok ? tools : err(redact(tools.error));
          },
          close: () => connection.close(),
        },
      };
    },
  };
}

// A missing secret needs the user just as a refused token does, and restarting cannot fix either.
function secretFailure(error: McpAuthError): McpProbeFailure {
  return { kind: error.code === "config_invalid" ? "protocol" : "auth", message: error.message };
}
