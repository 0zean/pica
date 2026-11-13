import * as z from "zod";
import { ErrorData } from "./common.ts";

export const RequestId = z.union([z.string(), z.int()]);

export const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId,
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const RpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const RpcError = z.object({
  code: z.int(),
  message: z.string(),
  data: ErrorData.optional(),
});

export const RpcSuccessResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId,
  result: z.unknown(),
});

export const RpcErrorResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId.nullable(),
  error: RpcError,
});

// JSON-RPC 2.0 reserves -32768..-32000; Pica's own errors share one application code and are told apart by `data.code`.
export const RPC_ERROR_NUMBERS = {
  parse_error: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
  internal_error: -32603,
  application: -32000,
} as const;
