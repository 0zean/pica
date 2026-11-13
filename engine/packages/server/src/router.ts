import type * as z from "zod";
import { methods, RpcRequest } from "@pica/protocol";
import type { MethodName, RequestId, RpcSuccessResponse } from "@pica/protocol";
import { parseClientResponse, type ClientResponse } from "./client-requests.ts";
import { RpcFailure } from "./errors.ts";

export type MethodParams<M extends MethodName> = z.output<(typeof methods)[M]["params"]>;
export type MethodResult<M extends MethodName> = z.input<(typeof methods)[M]["result"]>;

export interface RequestContext {
  readonly connectionId: number;
}

export type Handler<M extends MethodName> = (
  params: MethodParams<M>,
  context: RequestContext,
) => MethodResult<M> | Promise<MethodResult<M>>;

type BoundHandler = (params: unknown, context: RequestContext) => Promise<unknown>;
type Id = z.infer<typeof RequestId>;
type SuccessResponse = z.infer<typeof RpcSuccessResponse>;

export type ParsedMessage =
  | { kind: "request"; id: Id; method: string; params: unknown }
  | { kind: "response"; response: ClientResponse }
  | { kind: "ignored" }
  | { kind: "invalid"; id: Id | null; failure: RpcFailure };

export function parseMessage(text: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "invalid", id: null, failure: new RpcFailure("parse_error", "The frame is not valid JSON.") };
  }
  const request = RpcRequest.safeParse(value);
  if (request.success) {
    return { kind: "request", id: request.data.id, method: request.data.method, params: request.data.params };
  }
  const response = parseClientResponse(value);
  if (response !== undefined) {
    return { kind: "response", response };
  }
  if (isNotificationOrResponse(value)) {
    return { kind: "ignored" };
  }
  return {
    kind: "invalid",
    id: extractId(value),
    failure: new RpcFailure("invalid_request", "The frame is not a JSON-RPC 2.0 request object."),
  };
}

// Client notifications, and malformed responses, have no handler; JSON-RPC forbids answering them.
function isNotificationOrResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const isNotification = !("id" in value) && "method" in value;
  const isResponse = "id" in value && ("result" in value || "error" in value) && !("method" in value);
  return isNotification || isResponse;
}

function extractId(value: unknown): Id | null {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return null;
  }
  const id = value.id;
  return typeof id === "string" || (typeof id === "number" && Number.isInteger(id)) ? id : null;
}

function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methods, name);
}

export class MethodRouter {
  private readonly handlers = new Map<MethodName, BoundHandler>();

  register<M extends MethodName>(name: M, handler: Handler<M>): void {
    const spec = methods[name];
    if (spec.direction !== "client") {
      throw new Error(`${name} is sent by the engine; it cannot have a server handler`);
    }
    if (this.handlers.has(name)) {
      throw new Error(`${name} already has a handler`);
    }
    this.handlers.set(name, async (raw, context) => {
      const params = spec.params.safeParse(raw ?? {});
      if (!params.success) {
        throw new RpcFailure("invalid_params", `Invalid params for ${name}.`, {
          issues: params.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
        });
      }
      const result = await handler(params.data as MethodParams<M>, context);
      const checked = spec.result.safeParse(result);
      if (!checked.success) {
        throw new Error(`${name} handler returned a result that does not match its schema: ${checked.error.message}`);
      }
      return checked.data;
    });
  }

  async dispatch(id: Id, method: string, params: unknown, context: RequestContext): Promise<SuccessResponse> {
    if (!isMethodName(method) || methods[method].direction !== "client") {
      throw new RpcFailure("method_not_found", `Unknown method ${method}.`, { method });
    }
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      throw new RpcFailure("method_not_found", `${method} is not implemented by this engine yet.`, {
        method,
        implemented: false,
      });
    }
    return { jsonrpc: "2.0", id, result: await handler(params, context) };
  }
}
