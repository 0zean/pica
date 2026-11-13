import type { JsonValue } from "@pica/core";
import type { PlayableFrame, TranscriptTool } from "./transcript-schema.ts";

export interface WireEvent {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly agentId?: string | undefined;
  readonly ephemeral?: boolean | undefined;
}

// What a playing turn needs from the session it runs in.
export interface TurnContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly hooksEnabled: boolean;
  emit(event: WireEvent): void;
  invokeHook(hookType: string, input: Readonly<Record<string, unknown>>): Promise<unknown>;
  // Resolves with the permission decision's `kind`, e.g. "approve-once" or "reject".
  awaitPermission(requestId: string): Promise<string>;
  nextId(kind: string): string;
  now(): number;
  readonly aborted: Promise<void>;
  isAborted(): boolean;
}

export async function playTurn(context: TurnContext, prompt: string, frames: readonly PlayableFrame[]): Promise<void> {
  context.emit({ type: "user.message", data: { content: prompt, messageId: context.nextId("user-message") } });
  await playFrames(context, frames);
  if (context.isAborted()) {
    context.emit({ type: "abort", data: { reason: "user_initiated" } });
  }
  context.emit({ type: "session.idle", data: context.isAborted() ? { aborted: true } : {}, ephemeral: true });
}

async function playFrames(context: TurnContext, frames: readonly PlayableFrame[]): Promise<void> {
  for (const frame of frames) {
    if (context.isAborted()) return;
    if ("event" in frame) {
      context.emit(frame.event);
    } else {
      await playTool(context, frame.tool);
    }
  }
}

async function playTool(context: TurnContext, tool: TranscriptTool): Promise<void> {
  const scope = tool.agentId === undefined ? {} : { agentId: tool.agentId };
  const complete = (data: Readonly<Record<string, unknown>>): void => {
    context.emit({ type: "tool.execution_complete", data: { toolCallId: tool.toolCallId, ...data }, ...scope });
  };
  context.emit({
    type: "tool.execution_start",
    data: { toolCallId: tool.toolCallId, toolName: tool.toolName, arguments: tool.arguments },
    ...scope,
  });
  const pre = context.hooksEnabled ? asRecord(await context.invokeHook("preToolUse", hookInput(context, tool, {}))) : {};
  const reason = typeof pre.permissionDecisionReason === "string" ? pre.permissionDecisionReason : undefined;
  if (pre.permissionDecision === "deny") {
    complete({ success: false, error: { message: `Denied by preToolUse hook: ${reason ?? "no reason given"}` } });
    return;
  }
  if (pre.permissionDecision === "ask" && !(await askPermission(context, tool, reason))) {
    complete({ success: false, error: { message: "The user rejected this tool call." } });
    return;
  }
  if (tool.hangs) {
    await context.aborted;
    complete({ success: false, error: { message: "Tool execution aborted." } });
    return;
  }
  await playFrames(context, tool.frames ?? []);
  if (context.hooksEnabled) {
    const toolResult = { textResultForLlm: tool.result, resultType: "success" };
    await context.invokeHook("postToolUse", hookInput(context, tool, { toolResult }));
  }
  complete({ success: true, result: { content: tool.result } });
}

async function askPermission(context: TurnContext, tool: TranscriptTool, reason: string | undefined): Promise<boolean> {
  const requestId = context.nextId("permission");
  context.emit({
    type: "permission.requested",
    data: {
      requestId,
      permissionRequest: {
        kind: "hook",
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        toolArgs: tool.arguments,
        ...(reason === undefined ? {} : { hookMessage: reason }),
      },
    },
  });
  const decision = await context.awaitPermission(requestId);
  const approved = decision.startsWith("approve");
  context.emit({
    type: "permission.completed",
    data: {
      requestId,
      toolCallId: tool.toolCallId,
      result: { kind: approved ? "approved" : "denied-interactively-by-user" },
    },
  });
  return approved;
}

// The hook payload follows the SDK's `BaseHookInput` wire form: `timestamp` in epoch ms and
// `cwd` for the working directory. It carries no `toolCallId`, as the public types say.
function hookInput(
  context: TurnContext,
  tool: TranscriptTool,
  extra: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, unknown>> {
  return {
    sessionId: context.sessionId,
    timestamp: context.now(),
    cwd: context.workingDirectory,
    toolName: tool.toolName,
    toolArgs: tool.arguments,
    ...(tool.agentId === undefined ? {} : { agentId: tool.agentId }),
    ...extra,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
