import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createEventLog, createSessionService } from "@pica/core";
import type { AgentRuntime, RuntimeHooks, SessionService, Store } from "@pica/core";
import { registerEngineHandlers } from "./engine-handlers.ts";
import { SocketListener } from "./listener.ts";
import type { ConnectionLimits } from "./connection.ts";
import type { Logger } from "./logger.ts";
import { MethodRouter } from "./router.ts";
import { registerSessionHandlers, toSessionDto } from "./session-handlers.ts";

export interface EngineSessionOptions {
  readonly store: Store;
  readonly runtime: AgentRuntime;
  readonly clock?: () => string;
  readonly newSessionId?: () => string;
  readonly hooks?: (sessionId: string) => RuntimeHooks;
}

export interface EngineOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
  // Without it the engine answers `session.*`, `events.*` and `approval.*` as not implemented.
  readonly sessions?: EngineSessionOptions;
}

// Composition root: later units construct their adapters and register their handlers here.
export async function startEngine(options: EngineOptions): Promise<SocketListener> {
  const startedAt = performance.now();
  const router = new MethodRouter();
  // Session changes can only be broadcast once the listener exists; recovery runs before it does.
  const started: { listener?: SocketListener } = {};
  const sessions =
    options.sessions === undefined
      ? undefined
      : startSessions(router, options.sessions, options.log, (session) => {
          started.listener?.broadcast("session.changed", { session: toSessionDto(session) });
        });
  registerEngineHandlers(router, {
    uptimeMs: () => performance.now() - startedAt,
    sessionsRunning: () => sessions?.runningCount() ?? 0,
  });
  const listener = await SocketListener.start({
    socketPath: options.socketPath,
    router,
    log: options.log,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  started.listener = listener;
  return listener;
}

function startSessions(
  router: MethodRouter,
  options: EngineSessionOptions,
  log: Logger,
  onChanged: NonNullable<Parameters<typeof createSessionService>[0]["onChanged"]>,
): SessionService {
  const eventLog = createEventLog(options.store.events);
  const service = createSessionService({
    store: options.store,
    events: eventLog,
    runtime: options.runtime,
    clock: options.clock ?? (() => new Date().toISOString()),
    newSessionId: options.newSessionId ?? randomUUID,
    onChanged,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  const recovered = service.recover();
  if (!recovered.ok) {
    throw new Error(`session recovery failed: ${recovered.error.message}`);
  }
  if (recovered.value.length > 0) {
    log.warn(`${String(recovered.value.length)} session(s) from the previous engine are resumable`);
  }
  registerSessionHandlers(router, { sessions: service, log: eventLog, events: options.store.events });
  return service;
}
