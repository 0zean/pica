import type { ErrorCode } from "@pica/protocol";

export const runtimeErrorCodes = [
  "runtime.auth_missing",
  "runtime.quota_exhausted",
  "runtime.model_unavailable",
  "runtime.session_not_found",
  "runtime.session_busy",
  "runtime.session_closed",
  "runtime.permission_not_found",
  "runtime.invalid_argument",
  "runtime.failed",
] as const;

export type RuntimeErrorCode = (typeof runtimeErrorCodes)[number];

export interface RuntimeError {
  readonly code: RuntimeErrorCode;
  readonly message: string;
}

export function isRuntimeErrorCode(value: string): value is RuntimeErrorCode {
  return (runtimeErrorCodes as readonly string[]).includes(value);
}

export type ProtocolErrorCode = (typeof ErrorCode.options)[number];

// The client-facing code (PLAN.md §4.5) that a runtime failure is reported under.
const protocolCodes: Readonly<Record<RuntimeErrorCode, ProtocolErrorCode>> = {
  "runtime.auth_missing": "auth_required",
  "runtime.quota_exhausted": "quota_exhausted",
  "runtime.model_unavailable": "model_unavailable",
  "runtime.session_not_found": "not_found",
  "runtime.session_busy": "invalid_state",
  "runtime.session_closed": "invalid_state",
  "runtime.permission_not_found": "not_found",
  "runtime.invalid_argument": "invalid_params",
  "runtime.failed": "runtime_failed",
};

export function protocolErrorCode(code: RuntimeErrorCode): ProtocolErrorCode {
  return protocolCodes[code];
}
