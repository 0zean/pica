import { createServer, type Server, type Socket } from "node:net";
import { sequentialIds, steppingClock, type Clock, type IdSource } from "../runtime/deterministic.ts";
import { readMessages, writeMessage, type JsonRpcMessage } from "./framing.ts";
import { playTurn, type TurnContext, type WireEvent } from "./replay-turn.ts";
import type { RpcErrorBody, Transcript } from "./transcript-schema.ts";

export interface ReplayServerOptions {
  readonly clock?: Clock;
  readonly ids?: IdSource;
}

export interface ReplayRequest {
  readonly method: string;
  readonly params: unknown;
}

export interface ReplayServer {
  // `host:port`, as `RuntimeConnection.forUri` takes it.
  readonly url: string;
  // Every request the client sent, in arrival order.
  readonly requests: readonly ReplayRequest[];
  close(): Promise<void>;
}

const methodNotFound = -32601;
const invalidParams = -32602;

interface ReplaySession {
  readonly id: string;
  readonly workingDirectory: string;
  readonly hooksEnabled: boolean;
  turnsPlayed: number;
  running: boolean;
  abort: () => void;
  readonly pendingPermissions: Map<string, (kind: string) => void>;
}

// Emulates the Copilot runtime's JSON-RPC server for one transcript. Listens on loopback only.
export async function startReplayServer(transcript: Transcript, options: ReplayServerOptions = {}): Promise<ReplayServer> {
  const state = {
    transcript,
    clock: options.clock ?? steppingClock(),
    ids: options.ids ?? sequentialIds(),
    sessions: new Map<string, ReplaySession>(),
    requests: [] as ReplayRequest[],
  };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    new ReplayConnection(socket, state).listen();
  });
  const port = await listen(server);
  return {
    url: `127.0.0.1:${String(port)}`,
    requests: state.requests,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

interface ServerState {
  readonly transcript: Transcript;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly sessions: Map<string, ReplaySession>;
  readonly requests: ReplayRequest[];
}

class RpcFailure extends Error {
  constructor(readonly body: RpcErrorBody) {
    super(body.message);
  }
}

class ReplayConnection {
  private nextRequestId = 1;
  private readonly pendingReplies = new Map<number, (result: unknown) => void>();
  private lastEventId: string | null = null;

  constructor(
    private readonly socket: Socket,
    private readonly state: ServerState,
  ) {}

  listen(): void {
    readMessages(this.socket, (message) => {
      if (typeof message.method === "string") {
        void this.answer(message);
      } else if (typeof message.id === "number") {
        this.pendingReplies.get(message.id)?.(message.result);
        this.pendingReplies.delete(message.id);
      }
    });
  }

  private async answer(message: JsonRpcMessage): Promise<void> {
    const method = message.method as string;
    const params = asRecord(message.params);
    this.state.requests.push({ method, params: message.params });
    if (message.id === undefined) return;
    try {
      const configured = this.state.transcript.rpcErrors[method];
      if (configured !== undefined) throw new RpcFailure(configured);
      const result = await this.handle(method, params);
      writeMessage(this.socket, { jsonrpc: "2.0", id: message.id, result: result ?? null });
    } catch (error) {
      const body = error instanceof RpcFailure ? error.body : { code: -32603, message: String(error) };
      writeMessage(this.socket, { jsonrpc: "2.0", id: message.id, error: body });
    }
  }

  private handle(method: string, params: Readonly<Record<string, unknown>>): unknown {
    const { transcript } = this.state;
    switch (method) {
      case "connect":
      case "ping":
        return { protocolVersion: transcript.protocolVersion, message: "replay", timestamp: this.state.clock() };
      case "status.get":
        return { version: "replay", protocolVersion: transcript.protocolVersion };
      case "auth.getStatus":
        return transcript.auth;
      case "models.list":
        return { models: transcript.models };
      case "account.getQuota":
        return transcript.quota;
      case "session.create":
        return this.createSession(params);
      case "session.resume":
        return this.resumeSession(params);
      case "session.send":
        return this.send(params);
      case "session.abort":
        this.session(params).abort();
        return {};
      case "session.permissions.handlePendingPermissionRequest":
        return this.resolvePermission(params);
      case "session.detach":
        return { success: true };
      case "session.options.update":
      case "session.eventLog.registerInterest":
        return {};
      default:
        throw new RpcFailure({ code: methodNotFound, message: `Unhandled method ${method}` });
    }
  }

  private createSession(params: Readonly<Record<string, unknown>>): unknown {
    const id = requireString(params, "sessionId");
    const workingDirectory = typeof params.workingDirectory === "string" ? params.workingDirectory : "/";
    const session: ReplaySession = {
      id,
      workingDirectory,
      hooksEnabled: params.hooks === true,
      turnsPlayed: 0,
      running: false,
      abort: () => undefined,
      pendingPermissions: new Map(),
    };
    this.state.sessions.set(id, session);
    const model = typeof params.model === "string" ? params.model : this.defaultModel();
    this.emit(id, {
      type: "session.start",
      data: {
        sessionId: id,
        version: 1,
        producer: "pica-replay",
        copilotVersion: "replay",
        startTime: this.state.clock(),
        selectedModel: model,
        context: { cwd: workingDirectory },
      },
    });
    return { sessionId: id, workspacePath: `/replay/session-state/${id}`, capabilities: {} };
  }

  private resumeSession(params: Readonly<Record<string, unknown>>): unknown {
    const id = requireString(params, "sessionId");
    if (!this.state.sessions.has(id)) {
      throw new RpcFailure({ code: -32603, message: `Session not found: ${id}` });
    }
    this.emit(id, { type: "session.resume", data: { resumeTime: this.state.clock(), eventCount: 0 } });
    return { workspacePath: `/replay/session-state/${id}`, capabilities: {} };
  }

  private send(params: Readonly<Record<string, unknown>>): unknown {
    const session = this.session(params);
    const prompt = requireString(params, "prompt");
    const turn = this.state.transcript.turns[session.turnsPlayed];
    if (turn === undefined) {
      throw new RpcFailure({ code: -32603, message: `Transcript has no turn ${String(session.turnsPlayed + 1)}` });
    }
    session.turnsPlayed += 1;
    session.running = true;
    const messageId = this.state.ids("message");
    const context = this.turnContext(session);
    // The runtime answers `session.send` before the turn's first event, so play after the reply.
    setImmediate(() => {
      void playTurn(context, prompt, turn.frames).finally(() => {
        session.running = false;
        session.abort = () => undefined;
      });
    });
    return { messageId };
  }

  private turnContext(session: ReplaySession): TurnContext {
    let aborted = false;
    const abortedPromise = new Promise<void>((resolve) => {
      session.abort = () => {
        aborted = true;
        for (const reject of session.pendingPermissions.values()) reject("reject");
        session.pendingPermissions.clear();
        resolve();
      };
    });
    return {
      sessionId: session.id,
      workingDirectory: session.workingDirectory,
      hooksEnabled: session.hooksEnabled,
      emit: (event) => {
        this.emit(session.id, event);
      },
      invokeHook: async (hookType, input) =>
        asRecord(await this.request("hooks.invoke", { sessionId: session.id, hookType, input })).output,
      awaitPermission: (requestId) =>
        new Promise((resolve) => {
          session.pendingPermissions.set(requestId, resolve);
        }),
      nextId: (kind) => this.state.ids(kind),
      now: () => Date.parse(this.state.clock()),
      aborted: abortedPromise,
      isAborted: () => aborted,
    };
  }

  private resolvePermission(params: Readonly<Record<string, unknown>>): unknown {
    const session = this.session(params);
    const requestId = requireString(params, "requestId");
    const resolve = session.pendingPermissions.get(requestId);
    if (resolve === undefined) {
      throw new RpcFailure({ code: invalidParams, message: `No pending permission request ${requestId}` });
    }
    session.pendingPermissions.delete(requestId);
    resolve(String(asRecord(params.result).kind));
    return { success: true };
  }

  private session(params: Readonly<Record<string, unknown>>): ReplaySession {
    const id = requireString(params, "sessionId");
    const session = this.state.sessions.get(id);
    if (session === undefined) {
      throw new RpcFailure({ code: -32603, message: `Session not found: ${id}` });
    }
    return session;
  }

  private defaultModel(): string {
    const first = this.state.transcript.models[0];
    return typeof first?.id === "string" ? first.id : "";
  }

  private emit(sessionId: string, event: WireEvent): void {
    const id = this.state.ids("event");
    const envelope = { ...event, id, parentId: this.lastEventId, timestamp: this.state.clock() };
    this.lastEventId = id;
    writeMessage(this.socket, { jsonrpc: "2.0", method: "session.event", params: { sessionId, event: envelope } });
  }

  private request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve) => {
      this.pendingReplies.set(id, resolve);
      writeMessage(this.socket, { jsonrpc: "2.0", id, method, params });
    });
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("replay server has no TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcFailure({ code: invalidParams, message: `${key} must be a non-empty string` });
  }
  return value;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
