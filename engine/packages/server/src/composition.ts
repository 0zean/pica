import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CopilotRuntime,
  appendPermissionRule,
  setConfigValue,
  builtinAgentsDir,
  createJsonlAuditStore,
  createMcpImportFiles,
  createSessionArtifacts,
  fileSize,
  MarkdownAgentLoader,
  openSqliteStore,
  realPath,
  sha256Hex,
  userAgentsDir,
  userConfigPath,
} from "@pica/adapters";
import {
  agentTier,
  catalogTierResolver,
  createMcpImportService,
  createModelCatalog,
  createRuntimeNativeDelegator,
  defaultCommandDenyList,
  fallbackPriceTable,
  isRoutingProfile,
  sessionDefaultProfile,
  managedBudgetSettings,
  managedPolicyContext,
  openAuditLog,
  resolveTier,
} from "@pica/core";
import type { AgentRuntime, JsonObject, JsonValue, ModelCatalog, PolicyContext, SessionRoutingProfile, Store, TierSettingsInput, TokenPrices } from "@pica/core";
import { loadEngineConfig } from "./composition-config.ts";
import type { EngineConfig, EngineConfigOptions } from "./composition-config.ts";
import { workspaceOptions } from "./composition-workspaces.ts";
import type { EngineMcpImportOptions, EngineOptions, EngineSessionOptions } from "./engine.ts";
import type { Logger } from "./logger.ts";

export interface ProductionOptions {
  readonly homeDir: string;
  readonly userName: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Logger;
  // Tests stand in a FakeRuntime; production drives the Copilot CLI runtime (E-09).
  readonly runtime?: AgentRuntime;
  readonly managedPolicy?: EngineConfigOptions["managedPolicy"];
}

export interface ComposedEngine {
  readonly options: Omit<EngineOptions, "socketPath" | "log">;
  // Stops the runtime and closes the store; the caller closes the listener first.
  close(): Promise<void>;
}

// PLAN.md §4.6: everything Pica keeps for a user lives here.
export function picaDataDir(homeDir: string): string {
  return join(homeDir, "Library", "Application Support", "Pica");
}

// E-11: the production composition of `picad`. Throws when the store, config or audit log cannot
// be opened, so `picad` exits before it prints its ready line.
export function composeEngine(options: ProductionOptions): ComposedEngine {
  const dataDir = picaDataDir(options.homeDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const opened = openSqliteStore(join(dataDir, "pica.db"));
  if (!opened.ok) {
    throw new Error(`store: ${opened.error.message}`);
  }
  const store = opened.value;
  const { runtime, stopRuntime } = ownedRuntime(options.runtime);
  try {
    const config = loadEngineConfig(options);
    const workspaces = workspaceOptions({ store, dataDir, env: options.env });
    return {
      options: {
        sessions: sessionOptions({ store, runtime, config, dataDir, homeDir: options.homeDir, log: options.log }),
        mcpImport: mcpImportOptions(options.homeDir),
        ...workspaces,
      },
      close: async () => {
        await stopRuntime();
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

// Only a runtime the engine created is stopped by it.
function ownedRuntime(given: AgentRuntime | undefined): { runtime: AgentRuntime; stopRuntime: () => Promise<void> } {
  if (given !== undefined) return { runtime: given, stopRuntime: () => Promise.resolve() };
  const copilot = new CopilotRuntime();
  return { runtime: copilot, stopRuntime: () => copilot.stop() };
}

// The production MCP import (M-07): platform files under the user's home directory, written to
// Pica's own `mcp.jsonc`. Repo ids resolve through the composed workspaces.
export function mcpImportOptions(homeDir: string): EngineMcpImportOptions {
  return { service: createMcpImportService({ files: createMcpImportFiles({ homeDir }), home: homeDir }) };
}

interface SessionComposition {
  readonly store: Store;
  readonly runtime: AgentRuntime;
  readonly config: EngineConfig;
  readonly dataDir: string;
  readonly homeDir: string;
  readonly log: Logger;
}

const catalogMaxAgeMs = 10 * 60_000;
const catalogRetryAfterMs = 30_000;

function sessionOptions(deps: SessionComposition): EngineSessionOptions {
  const { store, runtime, config, log } = deps;
  const policy = config.policy;
  const catalog = createModelCatalog({
    runtime,
    priceTable: fallbackPriceTable,
    now: () => Date.now(),
    maxAgeMs: catalogMaxAgeMs,
    retryAfterMs: catalogRetryAfterMs,
    onWarning: (warning) => {
      log.warn(warning.message);
    },
  });
  const tiers = (): TierSettingsInput => config.current().routing.tiers;
  const models = policy?.models ?? {};
  const agents = new MarkdownAgentLoader([
    { layer: "builtin", dir: builtinAgentsDir },
    { layer: "user", dir: userAgentsDir(deps.homeDir) },
  ]);
  const loadedAgents = agents.load();
  if (!loadedAgents.ok) {
    throw new Error(`agent definitions: ${loadedAgents.error.message}`);
  }
  const audit = openAuditLog({ store: createJsonlAuditStore(join(deps.dataDir, "audit", "audit.jsonl")), hash: sha256Hex });
  if (!audit.ok) {
    throw new Error(`audit log: ${audit.error.message}`);
  }
  const budget = config.current().budget;
  return {
    store,
    runtime,
    readGate: {
      sessions: store.sessions,
      config: config.current,
      fileSize,
      realPath,
      managed: managedPolicyContext(policy).managed,
      commandDenyList: defaultCommandDenyList,
    },
    outputGuard: {
      artifacts: createSessionArtifacts(join(deps.dataDir, "sessions")),
      policyContext: (sessionId) => sessionPolicyContext(store, config, sessionId),
    },
    delegator: createRuntimeNativeDelegator({
      agents,
      resolveTier: catalogTierResolver(catalog, tiers, () => models),
    }),
    usage: {
      pricesFor: (model) => catalogPrices(catalog, model),
      tierOf: agentTier({ rootAgent: "main", agents: loadedAgents.value }),
      reasoningPrices: () => {
        const resolved = resolveTier("reasoning", tiers().reasoning, catalog.current()?.models ?? [], models);
        return resolved.resolvedModelId === null ? null : catalogPrices(catalog, resolved.resolvedModelId);
      },
    },
    budget: managedBudgetSettings(
      { sessionCredits: budget.sessionCredits, workspaceDailyCredits: budget.workspaceDailyCredits },
      policy,
    ),
    audit: audit.value,
    newSessionId: randomUUID,
    defaultProfile: (workspaceId) => defaultProfileFor(store, config, workspaceId),
    catalog: { catalog, agents: () => loadedAgents.value, tiers, models },
    config: {
      resolved: config.resolved,
      policyId: policy?.id,
      setUserValue: (keyPath, value) => setConfigValue(config.userFile, keyPath, value),
    },
    // A-07: rules are read from the config as last loaded, so a written rule applies on the next prompt.
    permissionRules: {
      current: () => config.current().permissions.tools ?? [],
      add: (rule) => appendPermissionRule(userConfigPath(deps.homeDir), rule),
    },
  };
}

// The workspace's `routing.profile` override, unless managed policy locks the key; else the user
// config's, which defaults to `off` (D-22).
function defaultProfileFor(store: Store, config: EngineConfig, workspaceId: string): SessionRoutingProfile {
  const lockedRouting = config.policy?.configLocks?.["routing"];
  const workspace = store.workspaces.get(workspaceId);
  return sessionDefaultProfile({
    configured: config.current().routing.profile,
    locked: isJsonObject(lockedRouting) && "profile" in lockedRouting,
    workspaceRouting: workspace.ok ? workspace.value.settingsOverrides["routing"] : undefined,
  });
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogPrices(catalog: Pick<ModelCatalog, "current">, model: string): TokenPrices | null {
  return catalog.current()?.models.find((entry) => entry.id === model)?.prices ?? null;
}

// The output guard needs the session's roots only to judge paths; relative paths resolve against
// its first write root, the directory the runtime runs in.
function sessionPolicyContext(store: Store, config: EngineConfig, sessionId: string): PolicyContext {
  const session = store.sessions.get(sessionId);
  const roots = session.ok ? session.value : { writeRoots: [], referenceRoots: [] };
  const current = config.current();
  // The session's own profile, chosen at creation, as the read gate uses it.
  const profile = session.ok && isRoutingProfile(session.value.routingProfile) ? session.value.routingProfile : current.routing.profile;
  return {
    cwd: roots.writeRoots[0] ?? "/",
    writeRoots: roots.writeRoots,
    referenceRoots: roots.referenceRoots,
    config: { ...current, routing: { ...current.routing, profile } },
    ...managedPolicyContext(config.policy),
    commandDenyList: defaultCommandDenyList,
  };
}
