import { err, ok, type RuntimeEvent, type RuntimeEventListener, type RuntimeResult, type RuntimeSession, type UsageMetrics } from "@pica/core";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { toRuntimeError } from "./errors.ts";
import { toRuntimeEvent } from "./events.ts";
import { PermissionDesk } from "./permissions.ts";
import { ToolCallLedger } from "./tool-calls.ts";
import { UsageTotals } from "./usage.ts";

type State = "idle" | "running" | "closed";

// One Copilot session behind the `RuntimeSession` port. It exists before the SDK session does,
// because the SDK delivers events (such as `session.start`) while `createSession` is in flight.
export class CopilotRuntimeSession implements RuntimeSession {
  readonly ledger = new ToolCallLedger();
  readonly permissions = new PermissionDesk();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly usageTotals = new UsageTotals();
  private sdk: CopilotSession | undefined;
  private state: State = "idle";

  constructor(
    readonly id: string,
    private readonly workingDirectory: string,
  ) {}

  attach(sdk: CopilotSession): void {
    this.sdk = sdk;
  }

  handle(sdkEvent: SessionEvent): void {
    if (sdkEvent.type === "tool.execution_start") {
      this.ledger.started(sdkEvent.data.toolCallId, sdkEvent.data.toolName);
    }
    if (sdkEvent.type === "permission.requested" && sdkEvent.data.resolvedByHook !== true) {
      this.permissions.register(sdkEvent.data.requestId);
    }
    const event = toRuntimeEvent(sdkEvent, {
      sessionId: this.id,
      workingDirectory: this.workingDirectory,
      modifiedResult: (toolCallId) => this.ledger.modifiedResult(toolCallId),
      deniedReason: (toolCallId) => this.ledger.deniedReason(toolCallId),
    });
    if (event === undefined) return;
    this.track(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(prompt: string): RuntimeResult<{ readonly messageId: string }> {
    const sdk = this.sdk;
    if (this.state === "closed" || sdk === undefined) {
      return err({ code: "runtime.session_closed", message: `session ${this.id} is closed` });
    }
    if (this.state === "running") {
      return err({ code: "runtime.session_busy", message: `session ${this.id} is already running a turn` });
    }
    this.state = "running";
    try {
      return ok({ messageId: await sdk.send({ prompt }) });
    } catch (error) {
      this.state = "idle";
      return err(toRuntimeError(error));
    }
  }

  async abort(): RuntimeResult<undefined> {
    if (this.state !== "running" || this.sdk === undefined) {
      return ok(undefined);
    }
    this.permissions.declineAll();
    try {
      await this.sdk.abort();
      return ok(undefined);
    } catch (error) {
      return err(toRuntimeError(error));
    }
  }

  resolvePermission(requestId: string, approved: boolean): RuntimeResult<undefined> {
    return Promise.resolve(
      this.permissions.answer(requestId, approved)
        ? ok(undefined)
        : err({ code: "runtime.permission_not_found", message: `no pending permission request ${requestId}` }),
    );
  }

  async resolveSessionLimit(requestId: string, maxAiCredits: number | null): RuntimeResult<undefined> {
    if (this.sdk === undefined) {
      return err({ code: "runtime.session_closed", message: `session ${this.id} is closed` });
    }
    const response = maxAiCredits === null ? { action: "cancel" as const } : { action: "set" as const, maxAiCredits };
    try {
      const answered = await this.sdk.rpc.ui.handlePendingSessionLimitsExhausted({ requestId, response });
      return answered.success
        ? ok(undefined)
        : err({ code: "runtime.limit_request_not_found", message: `no pending session limit request ${requestId}` });
    } catch (error) {
      return err(toRuntimeError(error));
    }
  }

  usage(): RuntimeResult<UsageMetrics> {
    return Promise.resolve(ok(this.usageTotals.metrics()));
  }

  async close(): RuntimeResult<undefined> {
    if (this.state === "closed" || this.sdk === undefined) {
      this.state = "closed";
      return ok(undefined);
    }
    this.state = "closed";
    this.permissions.declineAll();
    try {
      await this.sdk.disconnect();
      return ok(undefined);
    } catch (error) {
      return err(toRuntimeError(error));
    }
  }

  private track(event: RuntimeEvent): void {
    if (event.type === "assistant.usage") {
      this.usageTotals.add(event.data);
    } else if (event.type === "session.idle") {
      this.ledger.clear();
      if (this.state === "running") this.state = "idle";
    }
  }
}
