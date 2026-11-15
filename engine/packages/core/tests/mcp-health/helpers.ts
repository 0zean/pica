import type { McpServerDef, McpServerStatus } from "@pica/protocol";
import type {
  McpConnection,
  McpConnector,
  McpExitListener,
  McpHealthClock,
  McpProbeFailure,
  McpToolDefinition,
  Result,
} from "../../src/index.ts";

interface Timer {
  readonly at: number;
  readonly seq: number;
  readonly run: () => void;
}

// A clock that only moves when the test says so. `advance` fires due timers in time order and lets
// the promise chains they start settle before firing the next.
export class FakeClock implements McpHealthClock {
  time = Date.UTC(2026, 10, 14);
  private timers: Timer[] = [];
  private seq = 0;

  now(): number {
    return this.time;
  }

  setTimer(delayMs: number, run: () => void): () => void {
    const timer = { at: this.time + delayMs, seq: this.seq++, run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  pendingDelays(): number[] {
    return this.timers.map((t) => t.at - this.time).sort((a, b) => a - b);
  }

  async advance(ms: number): Promise<void> {
    const until = this.time + ms;
    await settle();
    for (;;) {
      const due = this.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (due === undefined) {
        break;
      }
      this.timers = this.timers.filter((t) => t !== due);
      this.time = due.at;
      due.run();
      await settle();
    }
    this.time = until;
  }
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

export const tools: readonly McpToolDefinition[] = [
  { name: "search", description: "Search things", inputSchema: { type: "object", properties: {} } },
  { name: "get", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
];

export function stdioServer(id: string): McpServerDef {
  return {
    id,
    name: id,
    transport: { type: "stdio", command: "stub", args: [id], env: {}, cwd: null },
    toolAllowlist: null,
    scope: "global",
  };
}

export function httpServer(id: string): McpServerDef {
  return {
    id,
    name: id,
    transport: { type: "http", url: `https://${id}.example.com/mcp`, headers: {} },
    toolAllowlist: null,
    scope: "global",
  };
}

// How a stub server behaves on each connection attempt.
export type StubBehavior =
  | { readonly kind: "healthy" }
  | { readonly kind: "slow"; readonly latencyMs: number }
  | { readonly kind: "crash-on-start" }
  | { readonly kind: "crash-after-start" }
  | { readonly kind: "auth" };

export class StubConnector implements McpConnector {
  readonly connects: { readonly serverId: string; readonly at: number }[] = [];
  readonly closed: string[] = [];
  private readonly exits = new Map<string, McpExitListener>();

  private readonly clock: FakeClock;
  private readonly behaviors: Readonly<Record<string, StubBehavior>>;

  constructor(clock: FakeClock, behaviors: Readonly<Record<string, StubBehavior>>) {
    this.clock = clock;
    this.behaviors = behaviors;
  }

  connect(definition: McpServerDef, onExit: McpExitListener): Promise<Result<McpConnection, McpProbeFailure>> {
    const id = definition.id;
    this.connects.push({ serverId: id, at: this.clock.now() });
    const behavior = this.behaviors[id] ?? { kind: "healthy" };
    if (behavior.kind === "auth") {
      return Promise.resolve({ ok: false, error: { kind: "auth", message: "answered HTTP 401" } });
    }
    if (behavior.kind === "crash-on-start") {
      return Promise.resolve({ ok: false, error: { kind: "exited", message: "process exited with code 1" } });
    }
    this.exits.set(id, onExit);
    const clock = this.clock;
    const connection: McpConnection = {
      listTools: () => {
        if (behavior.kind === "crash-after-start") {
          onExit("process exited with code 3");
          return Promise.resolve({ ok: false, error: { kind: "exited", message: "process exited with code 3" } });
        }
        if (behavior.kind === "slow") {
          clock.time += behavior.latencyMs;
        }
        return Promise.resolve({ ok: true, value: tools });
      },
      close: () => {
        this.closed.push(id);
        return Promise.resolve();
      },
    };
    return Promise.resolve({ ok: true, value: connection });
  }

  exit(serverId: string, reason: string): void {
    this.exits.get(serverId)?.(reason);
  }

  connectTimes(serverId: string): number[] {
    return this.connects.filter((c) => c.serverId === serverId).map((c) => c.at);
  }
}

export function recordStatuses(subscribe: (listener: (s: McpServerStatus) => void) => unknown): McpServerStatus[] {
  const seen: McpServerStatus[] = [];
  subscribe((status) => seen.push(status));
  return seen;
}
