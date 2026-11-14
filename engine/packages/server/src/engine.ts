import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  agentTier,
  createEventLog,
  createOutputGuard,
  createRedactingEventLog,
  createRedactingLogger,
  createSecretScrubber,
  createSessionService,
  createUsageReport,
  withOutputGuard,
  withUsageLedger,
} from "@pica/core";
import type {
  AgentRuntime,
  BudgetSettings,
  McpHealthMonitor,
  McpSecretRedactor,
  OutputGuardDeps,
  RuntimeHooks,
  SessionService,
  Store,
  TokenPrices,
  UsagePricing,
} from "@pica/core";
import { registerEngineHandlers } from "./engine-handlers.ts";
import { registerMcpHealthHandlers } from "./mcp-handlers.ts";
import { SocketListener } from "./listener.ts";
import type { ConnectionLimits } from "./connection.ts";
import type { Logger } from "./logger.ts";
import { MethodRouter } from "./router.ts";
import { registerSessionHandlers, toSessionDto } from "./session-handlers.ts";
import { registerUsageHandlers } from "./usage-handlers.ts";

export interface EngineUsageOptions extends Partial<UsagePricing> {
  readonly reasoningPrices?: () => TokenPrices | null;
}

export interface EngineSessionOptions {
  readonly store: Store;
  readonly runtime: AgentRuntime;
  readonly clock?: () => string;
  readonly newSessionId?: () => string;
  readonly hooks?: (sessionId: string) => RuntimeHooks;
  // Without prices, usage is recorded at zero credits and the savings estimate is zero.
  readonly usage?: EngineUsageOptions;
  // C-06: truncates oversized tool results and spills them to session artifacts.
  readonly outputGuard?: OutputGuardDeps;
  // C-09: `budget.*` from config; without it sessions have no default limit and no daily cap.
  readonly budget?: BudgetSettings;
}

export interface EngineOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
  // Without it the engine answers `session.*`, `events.*` and `approval.*` as not implemented.
  readonly sessions?: EngineSessionOptions;
  // M-06: answers `mcp.status*` and `mcp.restart`, and broadcasts `mcp.statusChanged`.
  readonly mcpHealth?: McpHealthMonitor;
}

// Composition root: later units construct their adapters and register their handlers here.
export async function startEngine(options: EngineOptions): Promise<SocketListener> {
  const startedAt = performance.now();
  // H-03: token formats are scrubbed from every log line and stored event.
  const scrubber = createSecretScrubber();
  const log = createRedactingLogger(options.log, scrubber);
  const router = new MethodRouter();
  // Session changes can only be broadcast once the listener exists; recovery runs before it does.
  const started: { listener?: SocketListener } = {};
  const sessions =
    options.sessions === undefined
      ? undefined
      : startSessions(router, options.sessions, log, scrubber, (session) => {
          started.listener?.broadcast("session.changed", { session: toSessionDto(session) });
        });
  registerEngineHandlers(router, {
    uptimeMs: () => performance.now() - startedAt,
    sessionsRunning: () => sessions?.runningCount() ?? 0,
  });
  if (options.mcpHealth !== undefined) {
    registerMcpHealthHandlers(router, options.mcpHealth);
  }
  const listener = await SocketListener.start({
    socketPath: options.socketPath,
    router,
    log,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  started.listener = listener;
  if (options.mcpHealth !== undefined) {
    options.mcpHealth.subscribe((status) => {
      listener.broadcast("mcp.statusChanged", { status });
    });
  }
  return listener;
}

function startSessions(
  router: MethodRouter,
  options: EngineSessionOptions,
  log: Logger,
  scrubber: McpSecretRedactor,
  onChanged: NonNullable<Parameters<typeof createSessionService>[0]["onChanged"]>,
): SessionService {
  const usage = options.usage ?? {};
  const eventLog = withUsageLedger(createRedactingEventLog(createEventLog(options.store.events), scrubber), {
    usage: options.store.usage,
    pricing: {
      pricesFor: usage.pricesFor ?? (() => null),
      tierOf: usage.tierOf ?? agentTier({ rootAgent: "main" }),
    },
    onError: (error) => {
      log.warn(`usage not recorded in full: ${error.message}`);
    },
  });
  const service = createSessionService({
    store: options.store,
    events: eventLog,
    runtime: options.runtime,
    clock: options.clock ?? (() => new Date().toISOString()),
    newSessionId: options.newSessionId ?? randomUUID,
    onChanged,
    usage: options.store.usage,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...sessionHooks(options),
  });
  const recovered = service.recover();
  if (!recovered.ok) {
    throw new Error(`session recovery failed: ${recovered.error.message}`);
  }
  if (recovered.value.length > 0) {
    log.warn(`${String(recovered.value.length)} session(s) from the previous engine are resumable`);
  }
  registerSessionHandlers(router, { sessions: service, log: eventLog, events: options.store.events });
  registerUsageHandlers(
    router,
    createUsageReport({ usage: options.store.usage, reasoningPrices: usage.reasoningPrices ?? (() => null) }),
  );
  return service;
}

function sessionHooks(options: EngineSessionOptions): { readonly hooks?: (sessionId: string) => RuntimeHooks } {
  if (options.outputGuard !== undefined) {
    return { hooks: withOutputGuard(options.hooks, createOutputGuard(options.outputGuard)) };
  }
  return options.hooks === undefined ? {} : { hooks: options.hooks };
}
