import type { McpServerDef, McpServerStatus } from "@pica/protocol";
import { estimateMcpToolListTokens } from "../mcp-attach/token-estimate.ts";
import type { McpToolCatalog, McpToolDefinition } from "../mcp-attach/types.ts";
import { err, type Result } from "../result.ts";
import { mcpHealthOptions, mcpRestartDelayMs, type McpHealthOptionsInput } from "./options.ts";
import type { McpCancelTimer, McpConnection, McpConnector, McpHealthClock, McpProbeFailure } from "./ports.ts";

export interface McpHealthMonitorDeps {
  readonly connector: McpConnector;
  readonly clock: McpHealthClock;
  readonly options?: McpHealthOptionsInput;
}

export type McpStatusListener = (status: McpServerStatus) => void;

export interface McpHealthMonitor {
  // Starts watching new definitions, reconnects changed ones, and stops removed ones.
  sync(definitions: readonly McpServerDef[]): void;
  status(serverId: string): McpServerStatus | undefined;
  // Sorted by server id.
  statuses(): McpServerStatus[];
  // Tool lists from the last successful check, for M-04's token estimates.
  catalog(): McpToolCatalog;
  // Reconnects now and clears the restart count: after a login, or to retry a server that gave up.
  restart(serverId: string): boolean;
  // Called on every status change; returns the unsubscribe function.
  subscribe(listener: McpStatusListener): () => void;
  stop(): Promise<void>;
}

interface Entry {
  definition: McpServerDef;
  key: string;
  // Bumped whenever the entry starts over, so callbacks from an older connection are ignored.
  generation: number;
  connection: McpConnection | undefined;
  connectedAt: number | undefined;
  attempts: number;
  tools: readonly McpToolDefinition[] | null;
  timer: McpCancelTimer | undefined;
  status: McpServerStatus;
}

type Update = Partial<Omit<McpServerStatus, "serverId">>;

export function createMcpHealthMonitor(deps: McpHealthMonitorDeps): McpHealthMonitor {
  const options = mcpHealthOptions(deps.options);
  const entries = new Map<string, Entry>();
  const listeners = new Set<McpStatusListener>();
  const { clock } = deps;

  function update(entry: Entry, change: Update): void {
    const next: McpServerStatus = { ...entry.status, ...change, checkedAt: new Date(clock.now()).toISOString() };
    entry.status = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  function setTimer(entry: Entry, delayMs: number, run: () => void): void {
    entry.timer?.();
    entry.timer = clock.setTimer(delayMs, () => {
      entry.timer = undefined;
      run();
    });
  }

  function release(entry: Entry): void {
    entry.generation += 1;
    entry.timer?.();
    entry.timer = undefined;
    const connection = entry.connection;
    entry.connection = undefined;
    if (connection !== undefined) {
      void connection.close();
    }
  }

  function start(entry: Entry): void {
    release(entry);
    const generation = entry.generation;
    update(entry, { state: "connecting" });
    void connect(entry, generation);
  }

  async function connect(entry: Entry, generation: number): Promise<void> {
    const connected = await withTimeout(
      deps.connector.connect(entry.definition, (reason) => {
        if (entry.generation === generation) {
          crash(entry, reason);
        }
      }),
      "connecting",
      (late) => {
        if (late.ok) {
          void late.value.close();
        }
      },
    );
    if (entry.generation !== generation) {
      if (connected.ok) {
        void connected.value.close();
      }
      return;
    }
    if (!connected.ok) {
      connectFailed(entry, connected.error);
      return;
    }
    entry.connection = connected.value;
    entry.connectedAt = clock.now();
    await check(entry, generation, connected.value);
  }

  async function check(entry: Entry, generation: number, connection: McpConnection): Promise<void> {
    const startedAt = clock.now();
    const listed = await withTimeout(connection.listTools(), "listing tools");
    if (entry.generation !== generation) {
      return;
    }
    if (!listed.ok) {
      checkFailed(entry, generation, listed.error);
      return;
    }
    const latencyMs = clock.now() - startedAt;
    const slow = latencyMs > options.slowMs;
    if (entry.connectedAt !== undefined && clock.now() - entry.connectedAt >= options.restart.stableAfterMs) {
      entry.attempts = 0;
    }
    entry.tools = listed.value;
    update(entry, {
      state: slow ? "degraded" : "healthy",
      lastError: slow ? `tools/list took ${String(latencyMs)} ms; slower than ${String(options.slowMs)} ms` : null,
      tools: listed.value.map((tool) => tool.name).sort(),
      latencyMs,
      toolDefinitionTokens: estimateMcpToolListTokens(entry.definition.id, listed.value),
      restarts: entry.attempts,
    });
    scheduleCheck(entry, generation);
  }

  function scheduleCheck(entry: Entry, generation: number): void {
    setTimer(entry, options.checkIntervalMs, () => {
      if (entry.generation !== generation) {
        return;
      }
      if (entry.connection === undefined) {
        start(entry);
      } else {
        void check(entry, generation, entry.connection);
      }
    });
  }

  function connectFailed(entry: Entry, failure: McpProbeFailure): void {
    if (failure.kind === "auth") {
      needsAuth(entry, failure);
    } else {
      crash(entry, failure.message);
    }
  }

  function checkFailed(entry: Entry, generation: number, failure: McpProbeFailure): void {
    if (failure.kind === "auth") {
      needsAuth(entry, failure);
    } else if (failure.kind === "exited" || failure.kind === "unreachable") {
      crash(entry, failure.message);
    } else {
      update(entry, { state: "degraded", lastError: failure.message });
      scheduleCheck(entry, generation);
    }
  }

  // Waits for `mcp.login` or a config change; checking again would only repeat the refusal.
  function needsAuth(entry: Entry, failure: McpProbeFailure): void {
    release(entry);
    update(entry, { state: "needs_auth", lastError: failure.message, latencyMs: null });
  }

  function crash(entry: Entry, reason: string): void {
    const connectedAt = entry.connectedAt;
    entry.connectedAt = undefined;
    release(entry);
    if (entry.definition.transport.type !== "stdio") {
      update(entry, { state: "failed", lastError: reason, latencyMs: null });
      scheduleCheck(entry, entry.generation);
      return;
    }
    if (connectedAt !== undefined && clock.now() - connectedAt >= options.restart.stableAfterMs) {
      entry.attempts = 0;
    }
    const { maxAttempts } = options.restart;
    if (entry.attempts >= maxAttempts) {
      update(entry, {
        state: "failed",
        lastError: `${reason}; gave up after ${String(maxAttempts)} restart attempts`,
        latencyMs: null,
        restarts: entry.attempts,
      });
      return;
    }
    entry.attempts += 1;
    update(entry, { state: "connecting", lastError: reason, latencyMs: null, restarts: entry.attempts });
    const generation = entry.generation;
    setTimer(entry, mcpRestartDelayMs(options.restart, entry.attempts), () => {
      if (entry.generation === generation) {
        void connect(entry, generation);
      }
    });
  }

  function withTimeout<T>(
    pending: Promise<Result<T, McpProbeFailure>>,
    activity: string,
    onLate?: (late: Result<T, McpProbeFailure>) => void,
  ): Promise<Result<T, McpProbeFailure>> {
    return new Promise((resolve) => {
      let settled = false;
      const cancel = clock.setTimer(options.timeoutMs, () => {
        settled = true;
        resolve(err({ kind: "timeout", message: `${activity} timed out after ${String(options.timeoutMs)} ms` }));
      });
      void pending.then((result) => {
        if (settled) {
          onLate?.(result);
          return;
        }
        settled = true;
        cancel();
        resolve(result);
      });
    });
  }

  function add(definition: McpServerDef): void {
    const entry: Entry = {
      definition,
      key: JSON.stringify(definition),
      generation: 0,
      connection: undefined,
      connectedAt: undefined,
      attempts: 0,
      tools: null,
      timer: undefined,
      status: initialStatus(definition.id),
    };
    entries.set(definition.id, entry);
    start(entry);
  }

  function remove(entry: Entry): void {
    release(entry);
    update(entry, { state: "stopped", latencyMs: null });
  }

  return {
    sync(definitions) {
      const wanted = new Map(definitions.map((definition) => [definition.id, definition]));
      for (const [id, entry] of entries) {
        if (!wanted.has(id)) {
          remove(entry);
          entries.delete(id);
        }
      }
      for (const definition of wanted.values()) {
        const entry = entries.get(definition.id);
        if (entry === undefined) {
          add(definition);
        } else if (entry.key !== JSON.stringify(definition)) {
          entry.definition = definition;
          entry.key = JSON.stringify(definition);
          entry.attempts = 0;
          entry.tools = null;
          start(entry);
        }
      }
    },
    status: (serverId) => entries.get(serverId)?.status,
    statuses: () =>
      [...entries.values()].map((entry) => entry.status).sort((a, b) => a.serverId.localeCompare(b.serverId)),
    catalog() {
      const catalog: Record<string, readonly McpToolDefinition[]> = {};
      for (const [id, entry] of entries) {
        if (entry.tools !== null) {
          catalog[id] = entry.tools;
        }
      }
      return catalog;
    },
    restart(serverId) {
      const entry = entries.get(serverId);
      if (entry === undefined) {
        return false;
      }
      entry.attempts = 0;
      start(entry);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async stop() {
      const closing: Promise<void>[] = [];
      for (const entry of entries.values()) {
        const connection = entry.connection;
        entry.connection = undefined;
        remove(entry);
        if (connection !== undefined) {
          closing.push(connection.close());
        }
      }
      entries.clear();
      await Promise.all(closing);
    },
  };
}

function initialStatus(serverId: string): McpServerStatus {
  return {
    serverId,
    state: "connecting",
    lastError: null,
    tools: [],
    latencyMs: null,
    toolDefinitionTokens: null,
    checkedAt: null,
    restarts: 0,
  };
}
