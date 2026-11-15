import { randomUUID } from "node:crypto";
import {
  err,
  ok,
  type AgentRuntime,
  type QuotaInfo,
  type ResumeOptions,
  type RuntimeModel,
  type RuntimeResult,
  type RuntimeSession,
  type SessionOptions,
} from "@pica/core";
import {
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type ModelInfo,
  type SessionConfig,
} from "@github/copilot-sdk";
import { CopilotRuntimeSession } from "./copilot-session.ts";
import { toRuntimeError } from "./errors.ts";
import { toSdkTools } from "./engine-tools.ts";
import { bridgeHooks } from "./hooks.ts";
import { isModelUsable, toQuotaInfo, toRuntimeModel } from "./models.ts";

export interface CopilotRuntimeOptions {
  // Passed to the SDK client. The default spawns the bundled Copilot runtime over stdio.
  readonly client?: CopilotClientOptions;
  readonly sessionIds?: () => string;
}

// `AgentRuntime` over `@github/copilot-sdk`. Every SDK failure becomes a `RuntimeError` with a
// stable code; nothing thrown by the SDK leaves this class.
export class CopilotRuntime implements AgentRuntime {
  // `session.create` refuses a lower `sessionLimits.maxAiCredits` (S-03, Copilot Free).
  readonly minSessionCredits = 30;
  private readonly client: CopilotClient;
  private readonly sessionIds: () => string;
  private connected = false;

  constructor(options: CopilotRuntimeOptions = {}) {
    this.client = new CopilotClient(options.client ?? {});
    this.sessionIds = options.sessionIds ?? randomUUID;
  }

  async listModels(): RuntimeResult<readonly RuntimeModel[]> {
    const models = await this.sdkModels();
    return models.ok ? ok(models.value.map(toRuntimeModel)) : models;
  }

  quota(): RuntimeResult<QuotaInfo> {
    return this.call(async () => toQuotaInfo((await this.client.rpc.account.getQuota({})).quotaSnapshots));
  }

  createSession(options: SessionOptions): RuntimeResult<RuntimeSession> {
    return this.open(options.sessionId ?? this.sessionIds(), options, (config) => this.client.createSession(config));
  }

  resumeSession(options: ResumeOptions): RuntimeResult<RuntimeSession> {
    return this.open(options.sessionId, options, (config) => this.client.resumeSession(options.sessionId, config));
  }

  // Stops the SDK client and, when it spawned one, the runtime process.
  async stop(): Promise<void> {
    await this.client.stop();
    this.connected = false;
  }

  private async open(
    sessionId: string,
    options: SessionOptions,
    start: (config: SessionConfig) => Promise<CopilotSession>,
  ): RuntimeResult<RuntimeSession> {
    const usable = await this.checkModel(options.model);
    if (!usable.ok) return usable;
    const session = new CopilotRuntimeSession(sessionId, options.workingDirectory);
    const config = sessionConfig(sessionId, options, session);
    const started = await this.call(() => start(config));
    if (!started.ok) return started;
    session.attach(started.value);
    return ok(session);
  }

  private async checkModel(model: string | undefined): RuntimeResult<undefined> {
    if (model === undefined) return ok(undefined);
    const models = await this.sdkModels();
    if (!models.ok) return models;
    const listed = models.value.find((candidate) => candidate.id === model);
    if (listed === undefined || !isModelUsable(listed)) {
      const why = listed === undefined ? "is not offered to this account" : "is disabled by policy";
      return err({ code: "runtime.model_unavailable", message: `model "${model}" ${why}` });
    }
    return ok(undefined);
  }

  private sdkModels(): RuntimeResult<ModelInfo[]> {
    return this.call(() => this.client.listModels());
  }

  private async call<T>(action: () => Promise<T>): RuntimeResult<T> {
    const ready = await this.connect();
    if (!ready.ok) return ready;
    try {
      return ok(await action());
    } catch (error) {
      return err(toRuntimeError(error));
    }
  }

  // Connects once, then checks sign-in. A failed check is not remembered, so signing in later works.
  private async connect(): RuntimeResult<undefined> {
    if (this.connected) return ok(undefined);
    try {
      await this.client.start();
      const auth = await this.client.getAuthStatus();
      if (!auth.isAuthenticated) {
        return err({ code: "runtime.auth_missing", message: auth.statusMessage ?? "not signed in to GitHub Copilot" });
      }
      this.connected = true;
      return ok(undefined);
    } catch (error) {
      return err(toRuntimeError(error));
    }
  }
}

function sessionConfig(sessionId: string, options: SessionOptions, session: CopilotRuntimeSession): SessionConfig {
  return {
    sessionId,
    workingDirectory: options.workingDirectory,
    streaming: true,
    onEvent: (event) => {
      session.handle(event);
    },
    onPermissionRequest: session.permissions.handler,
    hooks: bridgeHooks(options.hooks ?? {}, session.ledger, () => session.id),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.customAgents === undefined
      ? {}
      : {
          customAgents: options.customAgents.map((agent) => ({
            name: agent.name,
            description: agent.description,
            prompt: agent.prompt,
            ...(agent.model === undefined ? {} : { model: agent.model }),
            ...(agent.tools === undefined ? {} : { tools: [...agent.tools] }),
          })),
        }),
    // Hidden from the main agent only; sub-agents keep them (§2.1, `defaultAgent.excludedTools`).
    ...(options.excludedTools === undefined ? {} : { defaultAgent: { excludedTools: [...options.excludedTools] } }),
    ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: toSdkTools(options.tools) }),
    ...(options.maxAiCredits === undefined ? {} : { sessionLimits: { maxAiCredits: options.maxAiCredits } }),
  };
}
