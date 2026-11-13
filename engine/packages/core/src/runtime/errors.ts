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
