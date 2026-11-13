import type { ProtocolErrorCode } from "../runtime/errors.ts";
import { formatMcpSecretReference, type McpSecretReference } from "../mcp/secret-reference.ts";

export type McpAuthErrorCode = Extract<ProtocolErrorCode, "secret_unresolved" | "auth_required" | "config_invalid">;

// Mirrors `FixAction` in @pica/protocol so the error can be sent to the client as `data.fix`.
export interface McpAuthFix {
  readonly kind: "open_url" | "open_settings" | "retry" | "sign_in" | "run_command";
  readonly label: string;
  readonly target?: string;
}

// Messages and details name servers and references, never secret values.
export interface McpAuthError {
  readonly code: McpAuthErrorCode;
  readonly message: string;
  readonly fix?: McpAuthFix;
  readonly details?: Readonly<Record<string, unknown>>;
}

// The `ErrorData` payload (PLAN.md §4.5) for an error that reaches the client.
export function mcpAuthErrorData(error: McpAuthError): {
  code: McpAuthErrorCode;
  fix?: McpAuthFix;
  details?: Record<string, unknown>;
} {
  return {
    code: error.code,
    ...(error.fix === undefined ? {} : { fix: error.fix }),
    ...(error.details === undefined ? {} : { details: { ...error.details } }),
  };
}

// Settings panes the app opens for an `open_settings` fix (docs/mcp-secrets.md).
export function mcpSecretSettingsTarget(serverId: string, reference: McpSecretReference): string {
  return reference.provider === "keychain" ? `mcp/${serverId}/secrets` : `mcp/${serverId}/environment`;
}

export function mcpSecretUnresolved(
  serverId: string,
  unresolved: readonly McpSecretReference[],
): McpAuthError {
  const first = unresolved[0];
  if (first === undefined) {
    throw new Error("mcpSecretUnresolved needs at least one reference");
  }
  const refs = unresolved.map(formatMcpSecretReference);
  const label =
    first.provider === "keychain" ? `Add the ${first.name} secret` : `Set ${first.name} in the engine environment`;
  return {
    code: "secret_unresolved",
    message: `MCP server ${serverId} needs ${refs.join(", ")}, which ${refs.length === 1 ? "is" : "are"} not set.`,
    fix: { kind: "open_settings", label, target: mcpSecretSettingsTarget(serverId, first) },
    details: { serverId, secretRef: formatMcpSecretReference(first), secretRefs: refs },
  };
}

export function mcpSecretSourceFailed(serverId: string, reference: McpSecretReference, reason: string): McpAuthError {
  const secretRef = formatMcpSecretReference(reference);
  return {
    code: "secret_unresolved",
    message: `Could not read ${secretRef} for MCP server ${serverId}: ${reason}`,
    fix: { kind: "retry", label: "Try again" },
    details: { serverId, secretRef },
  };
}

export function mcpMalformedSecret(serverId: string, placeholder: string): McpAuthError {
  return {
    code: "config_invalid",
    message: `MCP server ${serverId} has a malformed secret reference ${placeholder}; see docs/secret-references.md.`,
    details: { serverId },
  };
}

export function mcpAuthRequired(serverId: string, serverName: string, reason: string): McpAuthError {
  return {
    code: "auth_required",
    message: `MCP server ${serverName} needs you to sign in again: ${reason}`,
    fix: { kind: "sign_in", label: `Sign in to ${serverName}`, target: serverId },
    details: { serverId },
  };
}

export function mcpOAuthUnsupported(serverId: string, reason: string): McpAuthError {
  return {
    code: "config_invalid",
    message: `MCP server ${serverId} cannot sign in with OAuth: ${reason}`,
    details: { serverId },
  };
}
