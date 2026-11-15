import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  err,
  ok,
  type McpConnection,
  type McpExitListener,
  type McpLaunchTransport,
  type McpProbeFailure,
  type Result,
} from "@pica/core";
import {
  errorMessage,
  initializeMcpSession,
  isRecord,
  listMcpTools,
  responseResult,
  type McpRpcSession,
} from "./session.ts";

type StdioLaunch = Extract<McpLaunchTransport, { type: "stdio" }>;
type Rec = Readonly<Record<string, unknown>>;
type Pending = (result: Result<Rec, McpProbeFailure>) => void;

// Grace period between SIGTERM and SIGKILL when closing.
const killAfterMs = 2_000;

// MCP stdio transport: newline-delimited JSON-RPC on the child's stdin and stdout. Its stderr is
// drained and dropped, since a server may print its credentials there.
export async function connectStdioMcpServer(
  launch: StdioLaunch,
  onExit: McpExitListener,
  baseEnv: NodeJS.ProcessEnv,
): Promise<Result<McpConnection, McpProbeFailure>> {
  const child = spawn(launch.command, [...launch.args], {
    env: { ...baseEnv, ...launch.env },
    ...(launch.cwd === null ? {} : { cwd: launch.cwd }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const server = new StdioServer(child);
  const initialized = await initializeMcpSession(server);
  if (!initialized.ok) {
    await server.close();
    return initialized;
  }
  server.onUnexpectedExit(onExit);
  return ok({ listTools: () => listMcpTools(server), close: () => server.close() });
}

class StdioServer implements McpRpcSession {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private ended: McpProbeFailure | undefined;
  private closing = false;
  private exitListener: McpExitListener | undefined;
  private readonly exited: Promise<void>;

  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    createInterface({ input: child.stdout }).on("line", (line) => {
      this.receive(line);
    });
    this.exited = new Promise((resolve) => {
      child.once("error", (error) => {
        this.end({ kind: "unreachable", message: `could not start ${commandName(child)}: ${errorMessage(error)}` });
        resolve();
      });
      child.once("exit", (code, signal) => {
        const how = signal === null ? `code ${String(code)}` : `signal ${signal}`;
        this.end({ kind: "exited", message: `process exited with ${how}` });
        resolve();
      });
    });
  }

  onUnexpectedExit(listener: McpExitListener): void {
    if (this.ended !== undefined) {
      listener(this.ended.message);
      return;
    }
    this.exitListener = listener;
  }

  async request(method: string, params: object): Promise<Result<unknown, McpProbeFailure>> {
    if (this.ended !== undefined) {
      return err(this.ended);
    }
    const id = this.nextId++;
    const response = await new Promise<Result<Rec, McpProbeFailure>>((resolve) => {
      this.pending.set(id, resolve);
      this.write({ jsonrpc: "2.0", id, method, params });
    });
    return response.ok ? responseResult(response.value, method) : response;
  }

  notify(method: string, params: object): Promise<Result<void, McpProbeFailure>> {
    if (this.ended !== undefined) {
      return Promise.resolve(err(this.ended));
    }
    this.write({ jsonrpc: "2.0", method, params });
    return Promise.resolve(ok(undefined));
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.ended === undefined) {
      this.child.stdin.end();
      this.child.kill("SIGTERM");
      const kill = setTimeout(() => this.child.kill("SIGKILL"), killAfterMs);
      await this.exited;
      clearTimeout(kill);
    }
  }

  private write(message: object): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message["id"] !== "number" || !("result" in message || "error" in message)) {
      return;
    }
    const resolve = this.pending.get(message["id"]);
    this.pending.delete(message["id"]);
    resolve?.(ok(message));
  }

  private end(failure: McpProbeFailure): void {
    if (this.ended !== undefined) {
      return;
    }
    this.ended = failure;
    for (const resolve of this.pending.values()) {
      resolve(err(failure));
    }
    this.pending.clear();
    if (!this.closing) {
      this.exitListener?.(failure.message);
    }
  }
}

function commandName(child: ChildProcessWithoutNullStreams): string {
  return child.spawnfile;
}
