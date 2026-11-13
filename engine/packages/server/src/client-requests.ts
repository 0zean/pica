import { methods, RPC_ERROR_NUMBERS, RpcErrorResponse, RpcSuccessResponse } from "@pica/protocol";
import type { MethodName } from "@pica/protocol";
import type * as z from "zod";
import { encodeFrame } from "./framing.ts";

export type EngineMethodName = {
  [M in MethodName]: (typeof methods)[M]["direction"] extends "engine" ? M : never;
}[MethodName];

export type EngineMethodParams<M extends EngineMethodName> = z.input<(typeof methods)[M]["params"]>;

// The client's answer to an engine-to-client request. `code` is the client's `data.code`, or the
// JSON-RPC error name when it sent none. The result is unvalidated; the caller parses it.
export type ClientReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ClientResponse {
  readonly id: string | number;
  readonly reply: ClientReply;
}

export const defaultClientRequestTimeoutMs = 30_000;

interface Pending {
  readonly resolve: (reply: ClientReply) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// Engine-to-client requests on one connection (`secrets.get`). Ids are strings prefixed `engine-` so
// they never collide with the numbers a client uses for its own requests.
export class ClientRequests {
  readonly #write: (frame: string) => void;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, Pending>();
  #nextId = 1;
  #closed = false;

  constructor(write: (frame: string) => void, timeoutMs: number = defaultClientRequestTimeoutMs) {
    this.#write = write;
    this.#timeoutMs = timeoutMs;
  }

  request<M extends EngineMethodName>(method: M, params: EngineMethodParams<M>): Promise<ClientReply> {
    if (this.#closed) {
      return Promise.resolve({ ok: false, code: "client_disconnected", message: "the client has disconnected" });
    }
    const id = `engine-${String(this.#nextId++)}`;
    const checked = methods[method].params.parse(params);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#settle(id, { ok: false, code: "client_timeout", message: `the client did not answer ${method} in time` });
      }, this.#timeoutMs);
      timer.unref();
      this.#pending.set(id, { resolve, timer });
      this.#write(encodeFrame({ jsonrpc: "2.0", id, method, params: checked }));
    });
  }

  // Returns false for a response to no request this engine sent, which is dropped.
  settle(response: ClientResponse): boolean {
    return typeof response.id === "string" && this.#settle(response.id, response.reply);
  }

  close(): void {
    this.#closed = true;
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, { ok: false, code: "client_disconnected", message: "the client disconnected" });
    }
  }

  #settle(id: string, reply: ClientReply): boolean {
    const pending = this.#pending.get(id);
    if (pending === undefined) {
      return false;
    }
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(reply);
    return true;
  }
}

export function parseClientResponse(value: unknown): ClientResponse | undefined {
  const success = RpcSuccessResponse.safeParse(value);
  if (success.success && !hasMethod(value)) {
    return { id: success.data.id, reply: { ok: true, result: success.data.result } };
  }
  const failure = RpcErrorResponse.safeParse(value);
  if (!failure.success || failure.data.id === null) {
    return undefined;
  }
  const { error } = failure.data;
  return {
    id: failure.data.id,
    reply: { ok: false, code: error.data?.code ?? rpcErrorName(error.code), message: error.message },
  };
}

function hasMethod(value: unknown): boolean {
  return typeof value === "object" && value !== null && "method" in value;
}

function rpcErrorName(code: number): string {
  const entry = Object.entries(RPC_ERROR_NUMBERS).find(([, number]) => number === code);
  return entry?.[0] ?? "unknown";
}
