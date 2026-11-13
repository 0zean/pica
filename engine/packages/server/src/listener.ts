import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { connect, createServer } from "node:net";
import type { Server } from "node:net";
import { dirname } from "node:path";
import { notifications } from "@pica/protocol";
import type { NotificationName } from "@pica/protocol";
import type * as z from "zod";
import { Connection } from "./connection.ts";
import type { ConnectionLimits } from "./connection.ts";
import { encodeFrame } from "./framing.ts";
import type { Logger } from "./logger.ts";
import type { MethodRouter } from "./router.ts";

export const DEFAULT_LIMITS: ConnectionLimits = {
  maxFrameBytes: 8 * 1024 * 1024,
  maxBufferedBytes: 64 * 1024 * 1024,
};

export interface ListenOptions {
  readonly socketPath: string;
  readonly router: MethodRouter;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
}

export type NotificationParams<N extends NotificationName> = z.input<(typeof notifications)[N]>;

export class SocketListener {
  private readonly connections = new Set<Connection>();
  private nextId = 1;
  readonly socketPath: string;
  private readonly server: Server;

  private constructor(socketPath: string, server: Server) {
    this.socketPath = socketPath;
    this.server = server;
  }

  static async start(options: ListenOptions): Promise<SocketListener> {
    await prepareSocketDirectory(dirname(options.socketPath));
    await removeStaleSocket(options.socketPath);
    const server = createServer();
    const listener = new SocketListener(options.socketPath, server);
    const limits = options.limits ?? DEFAULT_LIMITS;
    server.on("connection", (socket) => {
      listener.accept(new Connection(listener.nextId++, socket, options.router, limits, options.log));
    });
    await listen(server, options.socketPath);
    await chmod(options.socketPath, 0o600);
    return listener;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  // Sends to every client that has completed `engine.hello`, encoding once so all clients see the same bytes in the same order.
  broadcast<N extends NotificationName>(name: N, params: NotificationParams<N>): void {
    const checked = notifications[name].parse(params);
    const frame = encodeFrame({ jsonrpc: "2.0", method: name, params: checked });
    for (const connection of this.connections) {
      if (connection.isHandshaken) {
        connection.writeFrame(frame);
      }
    }
  }

  async close(): Promise<void> {
    for (const connection of this.connections) {
      connection.close();
    }
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
    await unlink(this.socketPath).catch(() => undefined);
  }

  private accept(connection: Connection): void {
    this.connections.add(connection);
    connection.onClose(() => {
      this.connections.delete(connection);
    });
  }
}

async function prepareSocketDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`${directory} is not a directory`);
  }
  if (stats.uid !== process.getuid?.()) {
    throw new Error(`${directory} is owned by another user`);
  }
  if ((stats.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700);
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  const stats = await lstat(socketPath).catch(() => undefined);
  if (stats === undefined) {
    return;
  }
  if (!stats.isSocket()) {
    throw new Error(`${socketPath} exists and is not a socket`);
  }
  if (await isAnswering(socketPath)) {
    throw new Error(`another engine is already listening on ${socketPath}`);
  }
  await unlink(socketPath);
}

function isAnswering(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      resolve(false);
    });
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // The umask makes the socket 0600 from the moment it is bound; the chmod after listening only confirms it.
    const previousMask = process.umask(0o177);
    try {
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    } finally {
      process.umask(previousMask);
    }
  });
}
