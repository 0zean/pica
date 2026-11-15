import type { Socket } from "node:net";
import { ClientRequests, type ClientReply, type EngineMethodName, type EngineMethodParams } from "./client-requests.ts";
import { encodeFrame, NdjsonDecoder } from "./framing.ts";
import { errorResponse, RpcFailure } from "./errors.ts";
import { parseMessage } from "./router.ts";
import type { MethodRouter } from "./router.ts";
import type { Logger } from "./logger.ts";

export interface ConnectionLimits {
  readonly maxFrameBytes: number;
  // A client whose unread output grows past this is disconnected so it cannot stall the engine.
  readonly maxBufferedBytes: number;
}

export class Connection {
  readonly id: number;
  private readonly socket: Socket;
  private readonly router: MethodRouter;
  private readonly limits: ConnectionLimits;
  private readonly log: Logger;
  private readonly decoder: NdjsonDecoder;
  private handshaken = false;
  private beforeHandshake: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly clientRequests: ClientRequests;

  constructor(id: number, socket: Socket, router: MethodRouter, limits: ConnectionLimits, log: Logger) {
    this.id = id;
    this.socket = socket;
    this.router = router;
    this.limits = limits;
    this.log = log;
    this.decoder = new NdjsonDecoder(limits.maxFrameBytes);
    this.clientRequests = new ClientRequests((frame) => {
      this.writeFrame(frame);
    });
    socket.on("data", (chunk: Buffer) => {
      this.receive(chunk);
    });
    socket.on("drain", () => {
      socket.resume();
    });
    socket.on("error", (error) => {
      log.warn(`client ${String(id)}: ${error.message}`);
    });
    socket.on("close", () => {
      this.closed = true;
      this.clientRequests.close();
    });
  }

  get isHandshaken(): boolean {
    return this.handshaken;
  }

  onClose(listener: () => void): void {
    this.socket.on("close", listener);
  }

  notify(method: string, params: unknown): void {
    this.writeFrame(encodeFrame({ jsonrpc: "2.0", method, params }));
  }

  // Sends an engine-to-client request (`secrets.get`) and resolves with the client's reply. Never rejects.
  request<M extends EngineMethodName>(method: M, params: EngineMethodParams<M>): Promise<ClientReply> {
    return this.clientRequests.request(method, params);
  }

  writeFrame(frame: string): void {
    if (this.closed) {
      return;
    }
    const flushed = this.socket.write(frame);
    if (this.socket.writableLength > this.limits.maxBufferedBytes) {
      this.log.warn(`client ${String(this.id)}: disconnected; ${String(this.socket.writableLength)} bytes unread`);
      this.closed = true;
      this.socket.destroy();
      return;
    }
    if (!flushed) {
      // Stop reading requests from a client that is not reading responses.
      this.socket.pause();
    }
  }

  close(): void {
    this.closed = true;
    this.socket.destroy();
  }

  private receive(chunk: Buffer): void {
    for (const frame of this.decoder.push(chunk)) {
      if (frame.kind === "too_large") {
        const failure = new RpcFailure(
          "frame_too_large",
          `The frame exceeds the ${String(this.limits.maxFrameBytes)} byte limit.`,
          { maxFrameBytes: this.limits.maxFrameBytes },
        );
        this.writeFrame(encodeFrame(errorResponse(null, failure)));
      } else if (this.handshaken) {
        void this.handle(frame.text);
      } else {
        const text = frame.text;
        this.beforeHandshake = this.beforeHandshake.then(() => this.handle(text));
      }
    }
  }

  private async handle(text: string): Promise<void> {
    const message = parseMessage(text);
    if (message.kind === "ignored") {
      return;
    }
    if (message.kind === "response") {
      if (!this.clientRequests.settle(message.response)) {
        this.log.warn(`client ${String(this.id)}: dropped a response to no pending request`);
      }
      return;
    }
    if (message.kind === "invalid") {
      this.writeFrame(encodeFrame(errorResponse(message.id, message.failure)));
      return;
    }
    if (!this.handshaken && message.method !== "engine.hello") {
      const failure = new RpcFailure("invalid_state", "Send engine.hello before any other request.");
      this.writeFrame(encodeFrame(errorResponse(message.id, failure)));
      return;
    }
    try {
      const response = await this.router.dispatch(message.id, message.method, message.params, {
        connectionId: this.id,
        notify: (method, params) => {
          this.notify(method, params);
        },
        onClose: (listener) => {
          this.onClose(listener);
        },
        request: (method, params) => this.request(method, params),
      });
      if (message.method === "engine.hello") {
        this.handshaken = true;
      }
      this.writeFrame(encodeFrame(response));
    } catch (error) {
      this.writeFrame(encodeFrame(errorResponse(message.id, this.toFailure(error))));
      if (error instanceof RpcFailure && error.code === "protocol_version_mismatch") {
        this.closed = true;
        this.socket.end();
      }
    }
  }

  private toFailure(error: unknown): RpcFailure {
    if (error instanceof RpcFailure) {
      return error;
    }
    this.log.error(`client ${String(this.id)}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return new RpcFailure("internal_error", "The engine failed to handle the request.");
  }
}
