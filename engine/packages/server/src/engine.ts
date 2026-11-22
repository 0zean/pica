import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  agentTier,
  createEventLog,
  createFanOutService,
  createOutputGuard,
  createReadGate,
  createRedactingEventLog,
  createRedactingLogger,
  createSecretScrubber,
  createSessionService,
  createUsageReport,
  emitPolicyDecisions,
  userHookLifecycle,
  meteredUsage,
  withAuditLog,
  withOutputGuard,
  withUsageLedger,
} from "@pica/core";
import type {
  AgentRuntime,
  AuditLog,
  BudgetSettings,
  Delegator,
  EventLog,
  FanOutInfo,
  CustomizationService,
  FilesService,
  GitHubHost,
  GitInstallation,
  McpHealthMonitor,
  McpImportService,
  McpSecretRedactor,
  OutputGuardDeps,
  PermissionRules,
  ReadGateDeps,
  RepoRegistry,
  RuntimeHooks,
  SessionMcp,
  SessionRoutingProfile,
  SessionService,
  Store,
  TokenPrices,
  UsagePricing,
  UserHookDeps,
  UsageRepository,
  WorkspaceService,
} from "@pica/core";
import { registerAccountHandlers } from "./account-handlers.ts";
import { registerCatalogHandlers } from "./catalog-handlers.ts";
import type { EngineCatalogOptions } from "./catalog-handlers.ts";
import { registerConfigHandlers } from "./config-handlers.ts";
import type { EngineConfigAccess } from "./config-handlers.ts";
import { registerEngineHandlers } from "./engine-handlers.ts";
import type { StoreRecoveryReport } from "./engine-handlers.ts";
import { registerFanOutHandlers, toFanOutDto } from "./fanout-handlers.ts";
import { registerFilesHandlers } from "./files-handlers.ts";
import { registerCustomizationHandlers } from "./customization-handlers.ts";
import { registerGitHandlers } from "./git-handlers.ts";
import type { EngineReviewOptions } from "./git-handlers.ts";
import { registerMcpHealthHandlers, registerMcpPresetHandlers } from "./mcp-handlers.ts";
import { registerMcpImportHandlers } from "./mcp-import-handlers.ts";
import { composeMcp } from "./mcp-composition.ts";
import type { ComposedMcp, EngineMcpOptions } from "./mcp-composition.ts";
import { registerMcpManageHandlers } from "./mcp-manage-handlers.ts";
import { createBrokerSecretSource } from "@pica/adapters";
import { SocketListener } from "./listener.ts";
import type { ConnectionLimits } from "./connection.ts";
import type { Logger } from "./logger.ts";
import type { UsageMetricsExporter } from "./metrics-export.ts";
import { MethodRouter } from "./router.ts";
import { registerRepoHandlers } from "./repo-handlers.ts";
import { registerSessionHandlers, toSessionDto } from "./session-handlers.ts";
import { registerSessionRootsHandlers } from "./session-roots-handlers.ts";
import { registerUsageHandlers } from "./usage-handlers.ts";
import { registerWorkspaceHandlers } from "./workspace-handlers.ts";
import { registerGitHubHandlers } from "./github-handlers.ts";
import type { EngineGitHubOptions } from "./github-handlers.ts";
import { registerGitInstallHandlers } from "./git-install-handlers.ts";

export interface EngineUsageOptions extends Partial<UsagePricing> {
  readonly reasoningPrices?: () => TokenPrices | null;
}

export interface EngineSessionOptions {
  readonly store: Store;
  readonly runtime: AgentRuntime;
  readonly clock?: () => string;
  readonly newSessionId?: () => string;
  readonly hooks?: (sessionId: string) => RuntimeHooks;
  // C-04: gates main-agent reads in `onPreToolUse`, in place of `hooks`. Its decisions are emitted
  // as events on the session log (and so audited) unless `onDecision` is given.
  readonly readGate?: ReadGateDeps;
  // Without prices, usage is recorded at zero credits and the savings estimate is zero.
  readonly usage?: EngineUsageOptions;
  // C-06: truncates oversized tool results and spills them to session artifacts.
  readonly outputGuard?: OutputGuardDeps;
  // C-09: `budget.*` from config; without it sessions have no default limit and no daily cap.
  readonly budget?: BudgetSettings;
  // H-02: tool calls, approvals and policy decisions are appended to this hash-chained log.
  readonly audit?: AuditLog;
  // X-03: `hooks.sessionStart` and `hooks.sessionEnd` from config; a failing hook is logged.
  readonly userHooks?: UserHookDeps;
  // H-04: exports usage metrics over OTLP. Off unless given; the caller stops it.
  readonly metricsExport?: UsageMetricsExporter;
  readonly newFanOutId?: () => string;
  // C-07: builds each session's sub-agents (`customAgents`); without it sessions get none.
  readonly delegator?: Delegator;
  // The routing profile for a session created without one (D-22); without it, `off`.
  readonly defaultProfile?: (workspaceId: string) => SessionRoutingProfile;
  // A-06: answers `agents.list`, `models.list` and `models.tiers`.
  readonly catalog?: EngineCatalogOptions;
  // A-14: answers `config.get` and `config.set`.
  readonly config?: EngineConfigAccess;
  // A-07: `permissions.tools` answer permission prompts; "always allow" appends one.
  readonly permissionRules?: PermissionRules;
}

export interface EngineOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly limits?: ConnectionLimits;
  // Without it the engine answers `session.*`, `events.*` and `approval.*` as not implemented.
  readonly sessions?: EngineSessionOptions;
  // M-06: answers `mcp.status*` and `mcp.restart`, and broadcasts `mcp.statusChanged`.
  readonly mcpHealth?: McpHealthMonitor;
  // A-13: answers `mcp.list`, `mcp.add`, `mcp.update`, `mcp.remove`, `mcp.attach*`, `mcp.detach`
  // and `mcp.login`, checks every server's health, and starts sessions with their attached servers.
  readonly mcp?: EngineMcpOptions;
  // D-20: the configured GitHub host, which the GitHub MCP preset follows. Absent means github.com.
  readonly githubHost?: GitHubHost;
  // R-06: answers `workspace.*`, `repo.list` and `repo.get`, and broadcasts `workspace.changed`.
  readonly workspaces?: WorkspaceService;
  // R-03: answers `repo.addPath`, `repo.addUrl` and `repo.remove`.
  readonly repos?: RepoRegistry;
  // M-07: answers `mcp.importCandidates` and `mcp.import`. Repo ids resolve through `workspaces`
  // unless `repoRoot` is given.
  readonly mcpImport?: EngineMcpImportOptions;
  // A-09: answers `files.list`, `files.read` and `files.quickOpen`.
  readonly files?: FilesService;
  // X-02: answers `customization.list`, `.create`, `.save` and `.delete`.
  readonly customization?: CustomizationService;
  // A-08: answers `git.*` and `github.createPullRequest` for the review.
  readonly review?: EngineReviewOptions;
  // A-12: answers `github.authStatus`, `github.listTeams` and `github.listTeamRepos`.
  readonly github?: EngineGitHubOptions;
  // A-15: answers `engine.git`.
  readonly gitInstall?: () => Promise<GitInstallation>;
  // H-05: reported by `engine.health` when the store was moved aside at start.
  readonly storeRecovery?: StoreRecoveryReport | null;
}

export interface EngineMcpImportOptions {
  readonly service: McpImportService;
  readonly repoRoot?: (repoId: string) => string | undefined;
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
  const sessionsHolder: { service?: SessionService | undefined } = {};
  const mcp = options.mcp === undefined ? undefined : startMcp(options.mcp, options.sessions, scrubber, log, started, sessionsHolder);
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
        }, fanOut, mcp?.sessionMcp);
  sessionsHolder.service = sessions;
  registerEngineHandlers(router, {
    uptimeMs: () => performance.now() - startedAt,
    sessionsRunning: () => sessions?.runningCount() ?? 0,
    storeRecovery: options.storeRecovery ?? null,
  });
  if (options.sessions !== undefined) {
    registerAccountHandlers(router, options.sessions.runtime);
  }
  if (options.sessions?.catalog !== undefined) {
    registerCatalogHandlers(router, options.sessions.catalog);
  }
  if (options.sessions?.config !== undefined) {
    registerConfigHandlers(router, options.sessions.config);
  }
  // M-02: presets need no adapter, so they are always answered.
  registerMcpPresetHandlers(router, options.githubHost === undefined ? {} : { githubHost: options.githubHost });
  const mcpHealth = options.mcpHealth ?? mcp?.monitor;
  if (mcpHealth !== undefined) {
    registerMcpHealthHandlers(router, mcpHealth);
  }
  if (mcp !== undefined) {
    registerMcpManageHandlers(router, mcp);
  }
  if (options.mcpImport !== undefined) {
    const { workspaces } = options;
    const repoRoot =
      options.mcpImport.repoRoot ??
      ((repoId: string): string | undefined => {
        const repo = workspaces?.repo(repoId);
        return repo?.ok === true ? (repo.value.localPath ?? undefined) : undefined;
      });
    registerMcpImportHandlers(router, {
      service: options.mcpImport.service,
      repoRoot,
      ...(mcp === undefined ? {} : { onImported: mcp.resync }),
    });
  }
  if (options.workspaces !== undefined) {
    registerWorkspaceHandlers(router, {
      workspaces: options.workspaces,
      onChanged: (workspace) => {
        started.listener?.broadcast("workspace.changed", { workspace });
      },
      onDeleted: (id) => {
        started.listener?.broadcast("workspace.deleted", { id });
      },
      ...(sessions === undefined ? {} : { sessions }),
    });
  }
  if (options.repos !== undefined) {
    registerRepoHandlers(router, options.repos, options.workspaces);
  }
  if (options.files !== undefined) {
    registerFilesHandlers(router, options.files);
  }
  if (options.customization !== undefined) {
    registerCustomizationHandlers(router, options.customization);
  }
  if (options.review !== undefined) {
    registerGitHandlers(router, options.review);
  }
  if (options.github !== undefined) {
    registerGitHubHandlers(router, options.github);
  }
  if (options.gitInstall !== undefined) {
    registerGitInstallHandlers(router, options.gitInstall);
  }
  const listener = await SocketListener.start({
    socketPath: options.socketPath,
    router,
    log,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  started.listener = listener;
  if (mcpHealth !== undefined) {
    mcpHealth.subscribe((status) => {
      listener.broadcast("mcp.statusChanged", { status });
    });
  }
  if (mcp !== undefined) {
    listener.onClientHello(mcp.resync);
    listener.beforeClose(() => mcp.monitor.stop());
    mcp.resync();
  }
  return listener;
}

// The broker reads `keychain:` secrets from whichever app is connected; a session's runtime is
// reopened through the session service once it exists.
function startMcp(
  options: EngineMcpOptions,
  sessionOptions: EngineSessionOptions | undefined,
  scrubber: McpSecretRedactor,
  log: Logger,
  started: { readonly listener?: SocketListener },
  sessions: { readonly service?: SessionService | undefined },
): ComposedMcp {
  return composeMcp(options, {
    redactor: scrubber,
    log,
    keychain: createBrokerSecretSource((params) =>
      started.listener === undefined
        ? Promise.resolve({ ok: false, code: "client_disconnected", message: "the engine is still starting" })
        : started.listener.requestAnyClient("secrets.get", params),
    ),
    store: sessionOptions?.store,
    reconfigure: async (sessionId) => {
      if (sessions.service === undefined) {
        return { ok: false, error: { code: "invalid_state", message: "sessions are not served by this engine" } };
      }
      const reopened = await sessions.service.reconfigure(sessionId);
      return reopened.ok ? reopened : { ok: false, error: { code: reopened.error.code, message: reopened.error.message } };
    },
  });
}

function startSessions(
  router: MethodRouter,
  options: EngineSessionOptions,
  log: Logger,
  scrubber: McpSecretRedactor,
  onChanged: NonNullable<Parameters<typeof createSessionService>[0]["onChanged"]>,
  fanOut: { readonly workspaces?: WorkspaceService; readonly onChanged: (fanOut: FanOutInfo) => void },
  mcp: SessionMcp | undefined,
): SessionService {
  const usage = options.usage ?? {};
  const ledger = withUsageLedger(createRedactingEventLog(createEventLog(options.store.events), scrubber), {
    usage: ledgerUsage(options, log),
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
    ...(options.delegator === undefined ? {} : { delegator: options.delegator }),
    ...(options.defaultProfile === undefined ? {} : { defaultProfile: options.defaultProfile }),
    ...(options.permissionRules === undefined ? {} : { permissionRules: options.permissionRules }),
    ...(mcp === undefined ? {} : { mcp }),
    ...sessionHooks(options, eventLog, clock),
    ...lifecycleHooks(options.userHooks, log),
  });
  const recovered = service.recover();
  if (!recovered.ok) {
    throw new Error(`session recovery failed: ${recovered.error.message}`);
  }
  if (recovered.value.length > 0) {
    log.warn(`${String(recovered.value.length)} session(s) from the previous engine are resumable`);
  }
  registerSessionHandlers(router, { sessions: service, log: eventLog, events: options.store.events });
  registerSessionRootsHandlers(router, options.store);
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

function ledgerUsage(options: EngineSessionOptions, log: Logger): UsageRepository {
  if (options.metricsExport === undefined) {
    return options.store.usage;
  }
  options.metricsExport.start(log);
  return meteredUsage(options.store.usage, options.metricsExport.meter);
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
  const emit = emitPolicyDecisions(eventLog, clock);
  const hooks =
    options.readGate === undefined ? options.hooks : createReadGate({ ...options.readGate, onDecision: options.readGate.onDecision ?? emit });
  if (options.outputGuard !== undefined) {
    const onDecision = options.outputGuard.onDecision ?? emit;
    return { hooks: withOutputGuard(hooks, createOutputGuard({ ...options.outputGuard, onDecision })) };
  }
  return hooks === undefined ? {} : { hooks };
}

function lifecycleHooks(
  userHooks: UserHookDeps | undefined,
  log: Logger,
): Pick<Parameters<typeof createSessionService>[0], "lifecycle"> {
  if (userHooks === undefined) {
    return {};
  }
  const lifecycle = userHookLifecycle(userHooks, (report, sessionId) => {
    if (report.failure !== undefined) {
      log.warn(`session ${sessionId}: ${report.event} ${report.failure.code}: ${report.failure.message}`);
    }
  });
  return { lifecycle };
}
