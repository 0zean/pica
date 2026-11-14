import { connect } from "node:net";
import type { Socket } from "node:net";
import { createInterface } from "node:readline";
import type * as z from "zod";
import { methods, notifications, PROTOCOL_VERSION, RPC_ERROR_NUMBERS, RpcErrorResponse } from "@pica/protocol";
import type { MethodName, NotificationName, SessionEvent } from "@pica/protocol";
import { EngineError } from "./errors.ts";

export type Params<M extends MethodName> = z.input<(typeof methods)[M]["params"]>;
export type Result<M extends MethodName> = z.output<(typeof methods)[M]["result"]>;
type ClientMethodName = { [M in MethodName]: (typeof methods)[M]["direction"] extends "client" ? M : never }[MethodName];

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: EngineError) => void;
}

export interface EventSink {
  readonly onEvent: (event: SessionEvent) => void;
}

const CLIENT_INFO = { name: "pica-cli", version: "0.0.0" } as const;

// One connection to `picad`: typed requests, and `events.event` routed to its subscription.
export class EngineConnection {
  private readonly socket: Socket;
  private readonly pending = new Map<number, Pending>();
  private readonly sinks = new Map<string, EventSink>();
  // Events that arrive before the subscribe response names their subscription.
  private readonly early: { readonly subscriptionId: string; readonly event: SessionEvent }[] = [];
  private nextId = 1;
  private closedError: EngineError | undefined;
  private markClosed: (error: EngineError) => void = () => undefined;
  // Settles when the connection is lost, so a command waiting on events does not wait forever.
  readonly lost: Promise<EngineError>;

  private constructor(socket: Socket) {
    this.socket = socket;
    this.lost = new Promise((resolve) => {
      this.markClosed = resolve;
    });
    createInterface({ input: socket }).on("line", (line) => {
      this.receive(line);
    });
    socket.on("close", () => {
      this.failAll(new EngineError("engine_disconnected", "The engine closed the connection."));
    });
    socket.on("error", (error) => {
      this.failAll(new EngineError("engine_disconnected", `Lost the engine connection: ${error.message}`));
    });
  }

  static open(socketPath: string): Promise<EngineConnection> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      const onError = (error: Error): void => {
        reject(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(new EngineConnection(socket));
      });
    });
  }

  async hello(): Promise<void> {
    await this.request("engine.hello", { protocolVersion: PROTOCOL_VERSION, client: CLIENT_INFO });
  }

  request<M extends ClientMethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    if (this.closedError !== undefined) {
      return Promise.reject(this.closedError);
    }
    const id = this.nextId++;
    const spec = methods[method];
    return new Promise<Result<M>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          const checked = spec.result.safeParse(value);
          if (checked.success) {
            resolve(checked.data as Result<M>);
          } else {
            reject(new EngineError("invalid_response", `The engine's ${method} result does not match the protocol.`));
          }
        },
        reject,
      });
      this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async subscribe(sessionId: string, afterSeq: number, sink: EventSink): Promise<Result<"events.subscribe">> {
    const result = await this.request("events.subscribe", { sessionId, afterSeq });
    this.sinks.set(result.subscriptionId, sink);
    for (const held of this.early.splice(0)) {
      if (held.subscriptionId === result.subscriptionId) {
        sink.onEvent(held.event);
      } else {
        this.early.push(held);
      }
    }
    return result;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.sinks.delete(subscriptionId);
    await this.request("events.unsubscribe", { subscriptionId });
  }

  close(): void {
    this.socket.destroy();
  }

  private receive(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) {
      return;
    }
    if ("method" in message && typeof message.method === "string") {
      this.receiveCall(message.method, "id" in message ? message.id : undefined, "params" in message ? message.params : undefined);
      return;
    }
    if ("id" in message && typeof message.id === "number") {
      this.receiveResponse(message.id, message);
    }
  }

  private receiveResponse(id: number, message: object): void {
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(id);
    if ("result" in message) {
      pending.resolve(message.result);
      return;
    }
    const failure = RpcErrorResponse.safeParse(message);
    const error = failure.success ? failure.data.error : undefined;
    pending.reject(new EngineError(error?.data?.code ?? "invalid_response", error?.message ?? "The engine sent a malformed error."));
  }

  private receiveCall(method: string, id: unknown, params: unknown): void {
    if (id !== undefined) {
      this.refuseEngineRequest(id, method);
      return;
    }
    if (method !== ("events.event" satisfies NotificationName)) {
      return;
    }
    const parsed = notifications["events.event"].safeParse(params);
    if (!parsed.success) {
      return;
    }
    const { subscriptionId, event } = parsed.data;
    if (this.sinks.has(subscriptionId)) {
      this.deliver(subscriptionId, event as SessionEvent);
    } else {
      this.early.push({ subscriptionId, event: event as SessionEvent });
    }
  }

  private deliver(subscriptionId: string, event: SessionEvent): void {
    this.sinks.get(subscriptionId)?.onEvent(event);
  }

  // D-10: the CLI holds no secret broker; the engine reads environment variables in CLI mode.
  private refuseEngineRequest(id: unknown, method: string): void {
    const unresolved = method === "secrets.get";
    const error = unresolved
      ? { code: RPC_ERROR_NUMBERS.application, message: "The CLI does not broker secrets.", data: { code: "secret_unresolved" } }
      : { code: RPC_ERROR_NUMBERS.method_not_found, message: `The CLI does not handle ${method}.`, data: { code: "method_not_found" } };
    this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
  }

  private failAll(error: EngineError): void {
    this.closedError ??= error;
    this.markClosed(this.closedError);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
