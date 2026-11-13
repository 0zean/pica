import { performance } from "node:perf_hooks";
import { registerEngineHandlers } from "./engine-handlers.ts";
import { SocketListener } from "./listener.ts";
import type { ConnectionLimits } from "./connection.ts";
import type { Logger } from "./logger.ts";
import { MethodRouter } from "./router.ts";

export interface EngineOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
}

// Composition root: later units construct their adapters and register their handlers here.
export async function startEngine(options: EngineOptions): Promise<SocketListener> {
  const startedAt = performance.now();
  const router = new MethodRouter();
  registerEngineHandlers(router, {
    uptimeMs: () => performance.now() - startedAt,
    sessionsRunning: () => 0,
  });
  return SocketListener.start({
    socketPath: options.socketPath,
    router,
    log: options.log,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}
