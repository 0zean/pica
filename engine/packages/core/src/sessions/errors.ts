import type { RuntimeError, RuntimeErrorCode } from "../runtime/index.ts";
import type { Result } from "../result.ts";
import { err } from "../result.ts";

export const sessionServiceErrorCodes = [
  "session.not_found",
  "session.invalid_state",
  "session.invalid_request",
  "session.approval_not_found",
  "session.budget_exhausted",
  "session.runtime_failed",
  "session.store_failed",
] as const;

export type SessionServiceErrorCode = (typeof sessionServiceErrorCodes)[number];

export interface SessionServiceError {
  readonly code: SessionServiceErrorCode;
  readonly message: string;
  // Set for `session.runtime_failed`, so callers can report the runtime's stable code.
  readonly runtimeCode?: RuntimeErrorCode;
  // Set for `session.budget_exhausted`: when the workspace's daily cap resets.
  readonly resetAt?: string;
}

export type SessionResult<T> = Result<T, SessionServiceError>;

export function sessionFailure(
  code: SessionServiceErrorCode,
  message: string,
): { readonly ok: false; readonly error: SessionServiceError } {
  return err({ code, message });
}

export function runtimeFailure(error: RuntimeError): { readonly ok: false; readonly error: SessionServiceError } {
  return err({ code: "session.runtime_failed", message: error.message, runtimeCode: error.code });
}
