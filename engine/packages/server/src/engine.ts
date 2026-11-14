import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  agentTier,
  createEventLog,
  createFanOutService,
  createOutputGuard,
  createRedactingEventLog,
  createRedactingLogger,
  createSecretScrubber,
  createSessionService,
  createUsageReport,
  emitPolicyDecisions,
  withAuditLog,
  withOutputGuard,
  withUsageLedger,
} from "@pica/core";
import type {
  AgentRuntime,
  AuditLog,
  BudgetSettings,
  EventLog,
  FanOutInfo,
  McpHealthMonitor,
  McpSecretRedactor,
  OutputGuardDeps,
  RuntimeHooks,
  SessionService,
  Store,
  TokenPrices,
  UsagePricing,
  WorkspaceService,
} from "@pica/core";
import { registerEngineHandlers } from "./engine-handlers.ts";
import { registerFanOutHandlers, toFanOutDto } from "./fanout-handlers.ts";
import { registerMcpHealthHandlers } from "./mcp-handlers.ts";
import { SocketListener } from "./listener.ts";
import type { ConnectionLimits } from "./connection.ts";
import type { Logger } from "./logger.ts";
import { MethodRouter } from "./router.ts";
import { registerSessionHandlers, toSessionDto } from "./session-handlers.ts";
import { registerUsageHandlers } from "./usage-handlers.ts";
import { registerWorkspaceHandlers } from "./workspace-handlers.ts";

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
  // H-02: tool calls, approvals and policy decisions are appended to this hash-chained log.
  readonly audit?: AuditLog;
  readonly newFanOutId?: () => string;
}

export interface EngineOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
  // Without it the engine answers `session.*`, `events.*` and `approval.*` as not implemented.
  readonly sessions?: EngineSessionOptions;
  // M-06: answers `mcp.status*` and `mcp.restart`, and broadcasts `mcp.statusChanged`.
  readonly mcpHealth?: McpHealthMonitor;
  // R-06: answers `workspace.*`, `repo.list` and `repo.get`, and broadcasts `workspace.changed`.
  readonly workspaces?: WorkspaceService;
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
  const fanOut = {
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
    onChanged: (info: FanOutInfo) => {
      started.listener?.broadcast("fanout.changed", { fanOut: toFanOutDto(info) });
    },
  };
  const sessions =
    options.sessions === undefined
      ? undefined
      : startSessions(router, options.sessions, log, scrubber, (session) => {
          started.listener?.broadcast("session.changed", { session: toSessionDto(session) });
        }, fanOut);
  registerEngineHandlers(router, {
    uptimeMs: () => performance.now() - startedAt,
    sessionsRunning: () => sessions?.runningCount() ?? 0,
  });
  if (options.mcpHealth !== undefined) {
    registerMcpHealthHandlers(router, options.mcpHealth);
  }
  if (options.workspaces !== undefined) {
    registerWorkspaceHandlers(router, {
      workspaces: options.workspaces,
      onChanged: (workspace) => {
        started.listener?.broadcast("workspace.changed", { workspace });
      },
    });
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
  fanOut: { readonly workspaces?: WorkspaceService; readonly onChanged: (fanOut: FanOutInfo) => void },
): SessionService {
  const usage = options.usage ?? {};
  const ledger = withUsageLedger(createRedactingEventLog(createEventLog(options.store.events), scrubber), {
    usage: options.store.usage,
    pricing: {
      pricesFor: usage.pricesFor ?? (() => null),
      tierOf: usage.tierOf ?? agentTier({ rootAgent: "main" }),
    },
    onError: (error) => {
      log.warn(`usage not recorded in full: ${error.message}`);
    },
  });
  const eventLog = auditedEventLog(ledger, options, log);
  const clock = options.clock ?? (() => new Date().toISOString());
  const service = createSessionService({
    store: options.store,
    events: eventLog,
    runtime: options.runtime,
    clock,
    newSessionId: options.newSessionId ?? randomUUID,
    onChanged,
    usage: options.store.usage,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...sessionHooks(options, eventLog, clock),
  });
  const recovered = service.recover();
  if (!recovered.ok) {
    throw new Error(`session recovery failed: ${recovered.error.message}`);
  }
  if (recovered.value.length > 0) {
    log.warn(`${String(recovered.value.length)} session(s) from the previous engine are resumable`);
  }
  registerSessionHandlers(router, { sessions: service, log: eventLog, events: options.store.events });
  // R-11: fan-out runs drive sessions through the same service and follow them on the same log.
  registerFanOutHandlers(
    router,
    createFanOutService({
      sessions: service,
      events: eventLog,
      clock,
      newFanOutId: options.newFanOutId ?? randomUUID,
      onChanged: fanOut.onChanged,
      ...(fanOut.workspaces === undefined ? {} : { workspaces: fanOut.workspaces }),
    }),
  );
  registerUsageHandlers(
    router,
    createUsageReport({ usage: options.store.usage, reasoningPrices: usage.reasoningPrices ?? (() => null) }),
  );
  return service;
}

function auditedEventLog(eventLog: EventLog, options: EngineSessionOptions, log: Logger): EventLog {
  if (options.audit === undefined) {
    return eventLog;
  }
  return withAuditLog(eventLog, options.audit, (error) => {
    log.warn(`audit entry not written: ${error.message}`);
  });
}

function sessionHooks(
  options: EngineSessionOptions,
  eventLog: EventLog,
  clock: () => string,
): { readonly hooks?: (sessionId: string) => RuntimeHooks } {
  if (options.outputGuard !== undefined) {
    const onDecision = options.outputGuard.onDecision ?? emitPolicyDecisions(eventLog, clock);
    return { hooks: withOutputGuard(options.hooks, createOutputGuard({ ...options.outputGuard, onDecision })) };
  }
  return options.hooks === undefined ? {} : { hooks: options.hooks };
}
