import {
  createMcpHealthMonitor,
  createMcpManager,
  createMcpTokenManager,
  createSecretResolvingMcpConnector,
  loginMcpServer,
  runtimeMcpOptions,
  withMcpBearerToken,
} from "@pica/core";
import type {
  ManagedMcpAllowlist,
  McpAuthErrorCode,
  McpAttachmentStore,
  McpDefinitions,
  McpHealthClock,
  McpHealthMonitor,
  McpHealthOptionsInput,
  McpLaunchAuthorizer,
  McpLaunchConnector,
  McpManager,
  McpOAuthBrowser,
  McpOAuthCrypto,
  McpOAuthGrantStore,
  McpOAuthHttp,
  McpSecretRedactor,
  McpSecretSource,
  McpServerFiles,
  McpSessionAccess,
  Result,
  SessionMcp,
  Store,
} from "@pica/core";
import type { McpServerDef } from "@pica/protocol";
import type { Logger } from "./logger.ts";

// A-13: how the engine reaches MCP servers and keeps their definitions and attachments.
export interface EngineMcpOptions {
  readonly files: McpServerFiles;
  readonly definitions: McpDefinitions;
  readonly attachments: McpAttachmentStore;
  // Every workspace id, so health covers each workspace's own servers.
  readonly workspaceIds: () => readonly string[];
  readonly launcher: McpLaunchConnector;
  // `env:` references (M-03); `keychain:` ones go to the app through `secrets.get`.
  readonly envSecrets: McpSecretSource;
  readonly agents?: () => readonly string[];
  readonly managedAllowlist?: () => ManagedMcpAllowlist | undefined;
  readonly clock?: McpHealthClock;
  readonly health?: McpHealthOptionsInput;
  // Without it `mcp.login` answers that sign-in is not available.
  readonly oauth?: EngineMcpOAuth;
}

export interface EngineMcpOAuth {
  readonly http: McpOAuthHttp;
  readonly browser: McpOAuthBrowser;
  readonly crypto: McpOAuthCrypto;
  readonly grants: McpOAuthGrantStore;
}

export interface ComposedMcp {
  readonly monitor: McpHealthMonitor;
  readonly manager: McpManager;
  readonly sessionMcp: SessionMcp;
  // Rechecks every configured server: after a file change, and when a client connects, since
  // `keychain:` secrets can be read only while the app is connected.
  readonly resync: () => void;
  readonly login: (serverId: string) => Promise<Result<undefined, McpLoginError>>;
}

export interface McpLoginError {
  readonly code: "not_found" | "invalid_state" | McpAuthErrorCode;
  readonly message: string;
}

export interface McpCompositionDeps {
  readonly redactor: McpSecretRedactor;
  readonly log: Logger;
  readonly keychain: McpSecretSource;
  readonly store: Pick<Store, "sessions"> | undefined;
  // Bound once the session service exists.
  readonly reconfigure: (sessionId: string) => Promise<Result<undefined, { readonly code: string; readonly message: string }>>;
}

const realClock: McpHealthClock = {
  now: () => Date.now(),
  setTimer: (delayMs, run) => {
    const timer = setTimeout(run, delayMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

export function composeMcp(options: EngineMcpOptions, deps: McpCompositionDeps): ComposedMcp {
  const sources = { keychain: deps.keychain, env: options.envSecrets };
  const authorize = options.oauth === undefined ? undefined : oauthAuthorizer(options.oauth, deps.redactor);
  // The definitions health last synced, by id: the connector is handed launches, not definitions.
  const known = new Map<string, McpServerDef>();
  const launcher: McpLaunchConnector =
    authorize === undefined
      ? options.launcher
      : {
          connect: async (launch, onExit) => {
            const definition = known.get(launch.serverId);
            return options.launcher.connect(definition === undefined ? launch : await authorize(definition, launch), onExit);
          },
        };
  const monitor = createMcpHealthMonitor({
    connector: createSecretResolvingMcpConnector({ sources, redactor: deps.redactor, launcher }),
    clock: options.clock ?? realClock,
    ...(options.health === undefined ? {} : { options: options.health }),
  });
  const agents = options.agents ?? (() => []);

  const allDefinitions = (): McpServerDef[] => {
    const byId = new Map<string, McpServerDef>();
    for (const workspaceId of [undefined, ...options.workspaceIds()]) {
      const listed = options.definitions(workspaceId);
      if (!listed.ok) {
        deps.log.warn(`MCP servers not read: ${listed.error.message}`);
        continue;
      }
      for (const server of listed.value) {
        // Two workspaces may define the same id; health follows the first one read.
        if (!byId.has(server.id)) byId.set(server.id, server);
      }
    }
    return [...byId.values()];
  };

  const resync = (): void => {
    const definitions = allDefinitions();
    known.clear();
    for (const definition of definitions) known.set(definition.id, definition);
    monitor.sync(definitions);
    for (const status of monitor.statuses()) {
      if (status.state === "needs_auth") monitor.restart(status.serverId);
    }
  };

  const sessions: McpSessionAccess = {
    get(sessionId) {
      const session = deps.store?.sessions.get(sessionId);
      if (session === undefined || !session.ok) {
        return { ok: false, error: { message: `no session ${sessionId}` } };
      }
      return { ok: true, value: { workspaceId: session.value.workspaceId, state: session.value.state } };
    },
    reconfigure: (sessionId) => deps.reconfigure(sessionId),
  };

  const manager = createMcpManager({
    files: options.files,
    definitions: options.definitions,
    attachments: options.attachments,
    sessions,
    catalog: () => monitor.catalog(),
    agents,
    ...(options.managedAllowlist === undefined ? {} : { managedAllowlist: options.managedAllowlist }),
    onServersChanged: resync,
  });

  const sessionMcp: SessionMcp = {
    seed(session) {
      const seeded = manager.seedSession(session.id, session.workspaceId);
      if (!seeded.ok) deps.log.warn(`session ${session.id}: MCP servers not attached: ${seeded.error.message}`);
    },
    forget(sessionId) {
      const forgotten = manager.forgetSession(sessionId);
      if (!forgotten.ok) deps.log.warn(`session ${sessionId}: MCP attachments not removed: ${forgotten.error.message}`);
    },
    async options(session) {
      const plan = manager.sessionPlan(session.id, session.workspaceId);
      if (!plan.ok) {
        deps.log.warn(`session ${session.id}: starts without MCP servers: ${plan.error.message}`);
        return { agents: {} };
      }
      return runtimeMcpOptions(plan.value, {
        sources,
        redactor: deps.redactor,
        ...(authorize === undefined ? {} : { authorize }),
        onSkipped: (serverId, message) => {
          deps.log.warn(`session ${session.id}: MCP server ${serverId} left out: ${message}`);
        },
      });
    },
  };

  const login = async (serverId: string): Promise<Result<undefined, McpLoginError>> => {
    if (options.oauth === undefined) {
      return { ok: false, error: { code: "invalid_state", message: "Signing in to MCP servers is not available in this engine." } };
    }
    const definition = allDefinitions().find((server) => server.id === serverId);
    if (definition === undefined) {
      return { ok: false, error: { code: "not_found", message: `No MCP server ${serverId} is configured.` } };
    }
    const signedIn = await loginMcpServer(
      { ...options.oauth, status: silentStatus, redactor: deps.redactor, clientName: "Pica" },
      definition,
    );
    if (!signedIn.ok) {
      return { ok: false, error: { code: signedIn.error.code, message: signedIn.error.message } };
    }
    monitor.restart(serverId);
    return { ok: true, value: undefined };
  };

  return { monitor, manager, sessionMcp, resync, login };
}

// Health reports the state itself from each check, so the sink has nothing to add.
const silentStatus = { needsAuth: () => undefined, authorized: () => undefined };

// A server signed in with `mcp.login` gets its bearer token on each start; one with no grant, or
// with its own Authorization header, is left as it is.
function oauthAuthorizer(oauth: EngineMcpOAuth, redactor: McpSecretRedactor): McpLaunchAuthorizer {
  const tokens = createMcpTokenManager({ http: oauth.http, grants: oauth.grants, status: silentStatus, redactor, now: () => Date.now() });
  return async (definition, launch) => {
    const transport = launch.transport;
    if (transport.type === "stdio" || Object.keys(transport.headers).some((name) => name.toLowerCase() === "authorization")) {
      return launch;
    }
    const grant = await oauth.grants.load(definition.id);
    if (!grant.ok || grant.value === null) {
      return launch;
    }
    const token = await tokens.accessToken(definition);
    return token.ok ? { ...launch, transport: withMcpBearerToken(transport, token.value) } : launch;
  };
}
