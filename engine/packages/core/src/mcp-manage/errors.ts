import type { ProtocolErrorCode } from "../runtime/errors.ts";

export type McpManageErrorCode =
  | "mcp_manage.not_found"
  | "mcp_manage.already_exists"
  | "mcp_manage.invalid"
  | "mcp_manage.inline_secret"
  | "mcp_manage.not_attachable"
  | "mcp_manage.policy_denied"
  | "mcp_manage.cache_reset_unconfirmed"
  | "mcp_manage.session_busy"
  | "mcp_manage.write_failed";

export interface McpManageError {
  readonly code: McpManageErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

const protocolCodes: Readonly<Record<McpManageErrorCode, ProtocolErrorCode>> = {
  "mcp_manage.not_found": "not_found",
  "mcp_manage.already_exists": "already_exists",
  "mcp_manage.invalid": "invalid_params",
  "mcp_manage.inline_secret": "config_invalid",
  "mcp_manage.not_attachable": "invalid_params",
  "mcp_manage.policy_denied": "policy_denied",
  "mcp_manage.cache_reset_unconfirmed": "cache_reset_unconfirmed",
  "mcp_manage.session_busy": "invalid_state",
  "mcp_manage.write_failed": "internal_error",
};

export function mcpManageProtocolCode(code: McpManageErrorCode): ProtocolErrorCode {
  return protocolCodes[code];
}

export function mcpManageError(code: McpManageErrorCode, message: string, details?: Readonly<Record<string, unknown>>): McpManageError {
  return details === undefined ? { code, message } : { code, message, details };
}
