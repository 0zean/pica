import type * as z from "zod";
import { RPC_ERROR_NUMBERS } from "@pica/protocol";
import type { ErrorCode, FixAction, RequestId, RpcErrorResponse } from "@pica/protocol";

export type ErrorCodeName = z.infer<typeof ErrorCode>;
type Fix = z.infer<typeof FixAction>;
type Id = z.infer<typeof RequestId>;
type ErrorResponse = z.infer<typeof RpcErrorResponse>;

// Thrown by handlers to answer with a stable error code instead of `internal_error`.
export class RpcFailure extends Error {
  readonly code: ErrorCodeName;
  readonly details: Record<string, unknown> | undefined;
  readonly fix: Fix | undefined;

  constructor(code: ErrorCodeName, message: string, details?: Record<string, unknown>, fix?: Fix) {
    super(message);
    this.name = "RpcFailure";
    this.code = code;
    this.details = details;
    this.fix = fix;
  }
}

function rpcNumber(code: ErrorCodeName): number {
  switch (code) {
    case "parse_error":
    case "invalid_request":
    case "method_not_found":
    case "invalid_params":
    case "internal_error":
      return RPC_ERROR_NUMBERS[code];
    case "frame_too_large":
      return RPC_ERROR_NUMBERS.invalid_request;
    default:
      return RPC_ERROR_NUMBERS.application;
  }
}

export function errorResponse(id: Id | null, failure: RpcFailure): ErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: rpcNumber(failure.code),
      message: failure.message,
      data: {
        code: failure.code,
        ...(failure.fix === undefined ? {} : { fix: failure.fix }),
        ...(failure.details === undefined ? {} : { details: failure.details }),
      },
    },
  };
}
