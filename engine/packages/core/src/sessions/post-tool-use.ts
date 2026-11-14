import { mainAgent, oversizedOutputRule } from "../policy/index.ts";
import type { PolicyContext, ToolCall } from "../policy/index.ts";
import type { PostToolUseInput, PostToolUseOutcome, RuntimeHooks } from "../runtime/index.ts";
import type { SessionArtifacts } from "./artifacts.ts";
import { truncateHeadTail, utf8ByteLength } from "./truncate-output.ts";

export interface OutputGuardDeps {
  readonly artifacts: SessionArtifacts;
  readonly policyContext: (sessionId: string) => PolicyContext;
}

export type PostToolUseHook = (input: PostToolUseInput) => Promise<PostToolUseOutcome>;

/** PLAN.md §5.3 "Oversized output": truncate head and tail, spill the full result, leave a pointer. */
export function createOutputGuard(deps: OutputGuardDeps): PostToolUseHook {
  return async (input) => {
    const { content } = input.result;
    const call: ToolCall = {
      id: input.toolCallId,
      tool: input.toolName,
      agent: input.agentId ?? mainAgent,
      target: { kind: "other" },
      result: { bytes: utf8ByteLength(content) },
    };
    const decision = oversizedOutputRule(call, deps.policyContext(input.sessionId));
    if (decision?.outcome !== "rewrite") {
      return { kind: "keep" };
    }
    const { maxBytes, originalBytes } = decision.rewrite;
    const spilled = await deps.artifacts.write(input.sessionId, `tool-output/${input.toolCallId}.txt`, content);
    const summary = `[pica] Output truncated to ${String(maxBytes)} of ${String(originalBytes)} bytes.`;
    const pointer = spilled.ok
      ? `${summary} Full output: ${spilled.value.path} (ask bulk-reader to read it).`
      : `${summary} The full output could not be saved: ${spilled.error.message}`;
    return { kind: "modify", result: { content: truncateHeadTail(content, maxBytes, pointer) } };
  };
}

/** Adds the output guard to whatever hooks a session already has; the guard owns `onPostToolUse`. */
export function withOutputGuard(
  hooks: ((sessionId: string) => RuntimeHooks) | undefined,
  guard: PostToolUseHook,
): (sessionId: string) => RuntimeHooks {
  return (sessionId) => ({ ...hooks?.(sessionId), onPostToolUse: guard });
}
