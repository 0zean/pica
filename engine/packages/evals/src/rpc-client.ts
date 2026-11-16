import { connect } from "node:net";
import type { Socket } from "node:net";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@pica/protocol";
import type { SessionEvent } from "@pica/protocol";

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

// The harness's connection to the engine: requests, and the events of one subscription at a time.
export class EvalClient {
  readonly #socket: Socket;
  readonly #pending = new Map<number, Pending>();
  readonly #events: SessionEvent[] = [];
  #wake: (() => void) | undefined;
  #nextId = 1;

  private constructor(socket: Socket) {
    this.#socket = socket;
    createInterface({ input: socket }).on("line", (line) => {
      this.#receive(JSON.parse(line) as Record<string, unknown>);
    });
    socket.on("close", () => {
      for (const pending of this.#pending.values()) pending.reject(new Error("the engine closed the connection"));
      this.#pending.clear();
    });
  }

  static async open(socketPath: string): Promise<EvalClient> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const opened = connect(socketPath);
      opened.once("error", reject);
      opened.once("connect", () => {
        opened.off("error", reject);
        resolve(opened);
      });
    });
    const client = new EvalClient(socket);
    await client.call("engine.hello", {
      protocolVersion: PROTOCOL_VERSION,
      client: { name: "pica-evals", version: "0.0.0" },
    });
    return client;
  }

  call<T = Record<string, unknown>>(method: string, params: unknown): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => { resolve(value as T); }, reject });
      this.#socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  // Every event received so far, in order.
  events(): readonly SessionEvent[] {
    return this.#events;
  }

  // Resolves once an event at or after `from` (an index into `events()`) satisfies `predicate`.
  async waitForEvent(from: number, predicate: (event: SessionEvent) => boolean): Promise<number> {
    for (;;) {
      const index = this.#events.findIndex((event, position) => position >= from && predicate(event));
      if (index >= 0) return index;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }

  close(): void {
    this.#socket.destroy();
  }

  #receive(message: Record<string, unknown>): void {
    if (typeof message["id"] === "number") {
      const pending = this.#pending.get(message["id"]);
      this.#pending.delete(message["id"]);
      if ("result" in message) pending?.resolve(message["result"]);
      else pending?.reject(new Error(`engine error: ${JSON.stringify(message["error"])}`));
      return;
    }
    if (message["method"] === "events.event") {
      const params = message["params"] as { event: SessionEvent };
      this.#events.push(params.event);
      const wake = this.#wake;
      this.#wake = undefined;
      wake?.();
    }
  }
}
