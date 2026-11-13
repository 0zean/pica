import type { RuntimeError, RuntimeErrorCode } from "@pica/core";

// What the runtime tells us about a failure. `session.error` events carry these fields in their
// data; JSON-RPC errors carry them in `data`, or only in the message.
export interface ErrorFacts {
  readonly errorType?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly message: string;
}

const authTypes = new Set(["authentication", "authorization"]);
const modelErrorCodes = new Set(["model_not_supported", "model_not_available", "model_disabled"]);

export function classifyError(facts: ErrorFacts): RuntimeErrorCode {
  const { errorType, errorCode, statusCode, message } = facts;
  if ((errorType !== undefined && authTypes.has(errorType)) || statusCode === 401) {
    return "runtime.auth_missing";
  }
  if (errorType === "quota" || statusCode === 402) {
    return "runtime.quota_exhausted";
  }
  if ((errorCode !== undefined && modelErrorCodes.has(errorCode)) || /\bmodel\b.*\b(not available|unavailable|not supported|disabled)\b/i.test(message)) {
    return "runtime.model_unavailable";
  }
  if (/\bsession not found\b/i.test(message)) {
    return "runtime.session_not_found";
  }
  if (/\bnot (authenticated|logged in|signed in)\b/i.test(message)) {
    return "runtime.auth_missing";
  }
  return "runtime.failed";
}

// Turns anything the SDK threw into a stable error. JSON-RPC `ResponseError`s keep their
// structured `data` when the runtime sent one.
export function toRuntimeError(thrown: unknown): RuntimeError {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const data = isRecord(thrown) && isRecord(thrown.data) ? thrown.data : {};
  const facts: ErrorFacts = {
    errorType: stringField(data, "errorType"),
    errorCode: stringField(data, "errorCode"),
    statusCode: typeof data.statusCode === "number" ? data.statusCode : undefined,
    message,
  };
  return { code: classifyError(facts), message };
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
