import {
  computeCredits,
  err,
  ok,
  type ModelUsage,
  type PostToolUseOutcome,
  type PreToolUseDecision,
  type RuntimeError,
  type RuntimeEvent,
  type RuntimeEventDataMap,
  type RuntimeEventListener,
  type RuntimeEventType,
  type RuntimeHooks,
  type RuntimeResult,
  type RuntimeSession,
  type ToolResult,
  type ToolUseInput,
  type UsageMetrics,
} from "@pica/core";
import type { Clock, IdSource } from "./deterministic.ts";
import type { Scenario, ScenarioStep, SubagentStep, ToolCallStep } from "./scenario-schema.ts";

export interface FakeSessionContext {
  readonly id: string;
  readonly scenario: Scenario;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly record: (event: RuntimeEvent) => void;
}

export interface FakeSessionOptions {
  readonly hooks: RuntimeHooks;
  readonly maxAiCredits?: number | undefined;
}

type StepOutcome = "continue" | "stop";

const interrupted = Symbol("interrupted");

interface Interrupt {
  readonly promise: Promise<typeof interrupted>;
  readonly fire: () => void;
  readonly fired: () => boolean;
}

function createInterrupt(): Interrupt {
  let resolvePromise: ((value: typeof interrupted) => void) | undefined;
  let fired = false;
  const promise = new Promise<typeof interrupted>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    fire: () => {
      fired = true;
      resolvePromise?.(interrupted);
    },
    fired: () => fired,
  };
}

function agentField(agentId: string | undefined): { agentId?: string } {
  return agentId === undefined ? {} : { agentId };
}

function failure(code: RuntimeError["code"], message: string): { readonly ok: false; readonly error: RuntimeError } {
  return err({ code, message });
}

// Plays the scenario's turns in order, one per `send`. Every await is on a hook, a pending
// permission, or the turn's interrupt, so with an injected clock and ids the event order is fixed.
export class FakeSession implements RuntimeSession {
  readonly id: string;
  readonly #context: FakeSessionContext;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #permissions = new Map<string, (approved: boolean) => void>();
  readonly #usage = new Map<string, ModelUsage>();
  readonly #limitRequests = new Map<string, (maxAiCredits: number | null) => void>();
  #hooks: RuntimeHooks;
  #maxAiCredits: number | undefined;
  #usedAiCredits = 0;
  #nextTurn = 0;
  #interrupt: Interrupt | undefined;
  #closed = false;

  constructor(context: FakeSessionContext, options: FakeSessionOptions) {
    this.id = context.id;
    this.#context = context;
    this.#hooks = options.hooks;
    this.#maxAiCredits = options.maxAiCredits;
  }

  reopen(options: FakeSessionOptions): void {
    this.#hooks = options.hooks;
    this.#maxAiCredits = options.maxAiCredits;
    this.#closed = false;
    this.emit("session.resume", { sessionId: this.id });
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  send(prompt: string): RuntimeResult<{ readonly messageId: string }> {
    if (this.#closed) {
      return Promise.resolve(failure("runtime.session_closed", `session ${this.id} is closed`));
    }
    if (this.#interrupt !== undefined) {
      return Promise.resolve(failure("runtime.session_busy", `session ${this.id} is already running a turn`));
    }
    const messageId = this.#context.ids("message");
    const turnIndex = this.#nextTurn;
    this.#nextTurn += 1;
    const interrupt = createInterrupt();
    this.#interrupt = interrupt;
    this.emit("user.message", { messageId, content: prompt });
    void this.#runTurn(prompt, turnIndex, interrupt);
    return Promise.resolve(ok({ messageId }));
  }

  abort(): RuntimeResult<undefined> {
    this.#interrupt?.fire();
    return Promise.resolve(ok(undefined));
  }

  resolvePermission(requestId: string, approved: boolean): RuntimeResult<undefined> {
    const resolve = this.#permissions.get(requestId);
    if (resolve === undefined) {
      return Promise.resolve(failure("runtime.permission_not_found", `no pending permission request ${requestId}`));
    }
    this.#permissions.delete(requestId);
    resolve(approved);
    return Promise.resolve(ok(undefined));
  }

  resolveSessionLimit(requestId: string, maxAiCredits: number | null): RuntimeResult<undefined> {
    const resolve = this.#limitRequests.get(requestId);
    if (resolve === undefined) {
      return Promise.resolve(failure("runtime.limit_request_not_found", `no pending session limit request ${requestId}`));
    }
    if (maxAiCredits !== null && !(maxAiCredits > this.#usedAiCredits)) {
      return Promise.resolve(
        failure("runtime.invalid_argument", `the new limit must exceed the ${String(this.#usedAiCredits)} credits used`),
      );
    }
    this.#limitRequests.delete(requestId);
    resolve(maxAiCredits);
    return Promise.resolve(ok(undefined));
  }

  usage(): RuntimeResult<UsageMetrics> {
    const byModel = [...this.#usage.values()].sort((a, b) => a.model.localeCompare(b.model));
    const sum = (pick: (entry: ModelUsage) => number): number =>
      byModel.reduce((total, entry) => total + pick(entry), 0);
    return Promise.resolve(
      ok({
        inputTokens: sum((entry) => entry.inputTokens),
        cachedInputTokens: sum((entry) => entry.cachedInputTokens),
        outputTokens: sum((entry) => entry.outputTokens),
        byModel,
      }),
    );
  }

  close(): RuntimeResult<undefined> {
    this.#closed = true;
    this.#interrupt?.fire();
    return Promise.resolve(ok(undefined));
  }

  emit<T extends RuntimeEventType>(type: T, data: RuntimeEventDataMap[T]): void {
    const event = { id: this.#context.ids("event"), timestamp: this.#context.clock(), type, data } as RuntimeEvent;
    this.#context.record(event);
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }

  async #runTurn(prompt: string, turnIndex: number, interrupt: Interrupt): Promise<void> {
    const turnId = this.#context.ids("turn");
    this.emit("assistant.turn_start", { turnId });
    const turn = this.#context.scenario.turns[turnIndex];
    if (turn === undefined) {
      this.emit("session.error", { code: "runtime.failed", message: `scenario has no turn ${String(turnIndex + 1)}` });
    } else if (turn.prompt !== undefined && turn.prompt !== prompt) {
      this.emit("session.error", {
        code: "runtime.invalid_argument",
        message: `turn ${String(turnIndex + 1)} expects the prompt ${JSON.stringify(turn.prompt)}`,
      });
    } else {
      await this.#playSteps(turn.steps, undefined, interrupt);
    }
    if (interrupt.fired()) {
      this.emit("abort", { reason: this.#closed ? "session closed" : "aborted by host" });
    }
    this.#interrupt = undefined;
    this.emit("assistant.turn_end", { turnId });
    this.emit("session.idle", {});
  }

  async #playSteps(
    steps: readonly ScenarioStep[],
    agentId: string | undefined,
    interrupt: Interrupt,
  ): Promise<StepOutcome> {
    for (const step of steps) {
      const outcome = await this.#playStep(step, agentId, interrupt);
      if (outcome === "stop" || interrupt.fired()) {
        return "stop";
      }
    }
    return "continue";
  }

  async #playStep(step: ScenarioStep, agentId: string | undefined, interrupt: Interrupt): Promise<StepOutcome> {
    switch (step.type) {
      case "text":
        this.#playText(step.content, step.deltas, agentId);
        return "continue";
      case "usage":
        this.#recordUsage(step, agentId);
        return this.#checkSessionLimit(interrupt);
      case "contextUsage":
        this.emit("session.usage_info", { currentTokens: step.currentTokens, tokenLimit: step.tokenLimit });
        return "continue";
      case "usageCheckpoint":
        this.emit("session.usage_checkpoint", { billedCredits: step.billedCredits });
        return "continue";
      case "error":
        this.emit("session.error", { code: step.code, message: step.message });
        return "stop";
      case "toolCall":
        return this.#playToolCall(step, agentId, interrupt);
      case "subagent":
        return this.#playSubagent(step, interrupt);
    }
  }

  #playText(content: string, deltas: readonly string[] | undefined, agentId: string | undefined): void {
    const messageId = this.#context.ids("message");
    for (const deltaContent of deltas ?? []) {
      this.emit("assistant.message_delta", { messageId, deltaContent, ...agentField(agentId) });
    }
    this.emit("assistant.message", { messageId, content, ...agentField(agentId) });
  }

  #recordUsage(
    step: { model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; billedCredits?: number | undefined },
    agentId: string | undefined,
  ): void {
    const previous = this.#usage.get(step.model);
    this.#usage.set(step.model, {
      model: step.model,
      inputTokens: (previous?.inputTokens ?? 0) + step.inputTokens,
      cachedInputTokens: (previous?.cachedInputTokens ?? 0) + step.cachedInputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + step.outputTokens,
      calls: (previous?.calls ?? 0) + 1,
    });
    this.#usedAiCredits += step.billedCredits ?? this.#creditsFor(step);
    this.emit("assistant.usage", {
      model: step.model,
      inputTokens: step.inputTokens,
      cachedInputTokens: step.cachedInputTokens,
      outputTokens: step.outputTokens,
      ...(step.billedCredits === undefined ? {} : { billedCredits: step.billedCredits }),
      ...agentField(agentId),
    });
  }

  #creditsFor(step: { model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number }): number {
    const prices = this.#context.scenario.models.find((entry) => entry.id === step.model)?.tokenPrices;
    if (prices === undefined) {
      return 0;
    }
    const credits = computeCredits(step, prices);
    return credits.ok ? credits.value.total : 0;
  }

  // The soft cap of PLAN.md §2.1: checked after each model call, it holds the next call until the
  // host raises the limit or cancels, which ends the turn.
  async #checkSessionLimit(interrupt: Interrupt): Promise<StepOutcome> {
    while (this.#maxAiCredits !== undefined && this.#usedAiCredits >= this.#maxAiCredits) {
      const requestId = this.#context.ids("limit");
      const answer = new Promise<number | null>((resolve) => {
        this.#limitRequests.set(requestId, resolve);
      });
      this.emit("session_limits_exhausted.requested", {
        requestId,
        usedAiCredits: this.#usedAiCredits,
        maxAiCredits: this.#maxAiCredits,
      });
      const maxAiCredits = await Promise.race([answer, interrupt.promise]);
      if (maxAiCredits === interrupted) {
        this.#limitRequests.delete(requestId);
        return "stop";
      }
      this.emit("session_limits_exhausted.completed", { requestId, maxAiCredits });
      if (maxAiCredits === null) {
        return "stop";
      }
      this.#maxAiCredits = maxAiCredits;
    }
    return "continue";
  }

  async #playToolCall(step: ToolCallStep, agentId: string | undefined, interrupt: Interrupt): Promise<StepOutcome> {
    const input: ToolUseInput = {
      sessionId: this.id,
      toolCallId: this.#context.ids("tool"),
      toolName: step.name,
      arguments: step.arguments,
      ...agentField(agentId),
    };
    const complete = (success: boolean, result: ToolResult): void => {
      this.emit("tool.execution_complete", { toolCallId: input.toolCallId, success, result, ...agentField(agentId) });
    };
    this.emit("tool.execution_start", {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      arguments: input.arguments,
      ...agentField(agentId),
    });
    const decision = await this.#decide(input, interrupt);
    if (decision !== interrupted && decision.decision === "deny") {
      complete(false, { content: `Denied: ${decision.reason}` });
      return "continue";
    }
    if (decision === interrupted || step.hangs) {
      await interrupt.promise;
      complete(false, { content: "Aborted" });
      return "stop";
    }
    const result = { content: step.result };
    const outcome = await Promise.race([
      this.#postToolUse({ ...input, success: step.success, result }),
      interrupt.promise,
    ]);
    if (outcome === interrupted) {
      complete(false, { content: "Aborted" });
      return "stop";
    }
    complete(step.success, outcome.kind === "modify" ? outcome.result : result);
    return "continue";
  }

  async #decide(
    input: ToolUseInput,
    interrupt: Interrupt,
  ): Promise<Exclude<PreToolUseDecision, { decision: "ask" }> | typeof interrupted> {
    const decision = await Promise.race([this.#preToolUse(input), interrupt.promise]);
    if (decision === interrupted || decision.decision !== "ask") {
      return decision;
    }
    const requestId = this.#context.ids("permission");
    const answer = new Promise<boolean>((resolve) => {
      this.#permissions.set(requestId, resolve);
    });
    this.emit("permission.requested", {
      requestId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      arguments: input.arguments,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    });
    const approved = await Promise.race([answer, interrupt.promise]);
    if (approved === interrupted) {
      this.#permissions.delete(requestId);
      return interrupted;
    }
    this.emit("permission.completed", { requestId, approved });
    return approved ? { decision: "allow" } : { decision: "deny", reason: "the user declined" };
  }

  async #playSubagent(step: SubagentStep, interrupt: Interrupt): Promise<StepOutcome> {
    const toolCallId = this.#context.ids("tool");
    const agentId = this.#context.ids("agent");
    const identity = { toolCallId, agentId, agentName: step.agentName };
    this.emit("subagent.started", { ...identity, model: step.model });
    const outcome = await this.#playSteps(step.steps, agentId, interrupt);
    if (outcome === "stop") {
      this.emit("subagent.failed", { ...identity, error: "Aborted" });
      return "stop";
    }
    if (step.failure !== undefined) {
      this.emit("subagent.failed", { ...identity, error: step.failure });
      return "continue";
    }
    const totalTokens = step.steps.reduce(
      (total, inner) =>
        inner.type === "usage" ? total + inner.inputTokens + inner.cachedInputTokens + inner.outputTokens : total,
      0,
    );
    this.emit("subagent.completed", { ...identity, model: step.model, totalTokens });
    return "continue";
  }

  async #preToolUse(input: ToolUseInput): Promise<PreToolUseDecision> {
    const hook = this.#hooks.onPreToolUse;
    if (hook === undefined) {
      return { decision: "allow" };
    }
    try {
      return await hook(input);
    } catch (error) {
      return { decision: "deny", reason: `preToolUse hook failed: ${String(error)}` };
    }
  }

  async #postToolUse(input: Parameters<NonNullable<RuntimeHooks["onPostToolUse"]>>[0]): Promise<PostToolUseOutcome> {
    const hook = this.#hooks.onPostToolUse;
    if (hook === undefined) {
      return { kind: "keep" };
    }
    try {
      return await hook(input);
    } catch {
      return { kind: "keep" };
    }
  }
}
