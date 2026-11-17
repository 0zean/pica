import { toolKind } from "../agents/index.ts";
import type { JsonValue } from "../json.ts";
import type { PolicyContext, PolicyDecision, ToolCall } from "../policy/index.ts";
import type { ToolUseInput } from "../runtime/index.ts";

// What one delegation has spent so far. A delegation is one sub-agent run: the runtime gives each
// its own `agentId` (S-02), so two `task` calls to `code-writer` are counted apart.
interface DelegationUsage {
  toolCalls: number;
  writeBytes: number;
}

export interface DelegationLimiter {
  // A deny once the delegation has used its limit, else undefined; a call that passes is counted.
  check(input: ToolUseInput, call: ToolCall, context: PolicyContext): PolicyDecision | undefined;
}

const codeWriter = "code-writer";

// C-11: `routing.delegation.codeWriter` caps the tool calls and the file content one delegation may
// spend, under `balanced` and `strict`. A write's content is the sub-agent's output tokens, so the
// byte cap bounds the output a delegation produces; the call cap bounds its model calls. Past
// either, every further call is denied with a reason telling the sub-agent to stop and report.
export function createDelegationLimiter(): DelegationLimiter {
  const usage = new Map<string, DelegationUsage>();
  return {
    check(input, call, context) {
      const agentId = input.agentId;
      const limits = context.config.routing.delegation.codeWriter;
      if (agentId === undefined || call.agent !== codeWriter || context.config.routing.profile === "off") {
        return undefined;
      }
      const used = usage.get(agentId) ?? { toolCalls: 0, writeBytes: 0 };
      usage.set(agentId, used);
      const bytes = writtenBytes(input.toolName, input.arguments);
      const over =
        used.toolCalls >= limits.maxToolCalls
          ? `${String(limits.maxToolCalls)} tool calls`
          : used.writeBytes + bytes > limits.maxWriteBytes
            ? `${String(limits.maxWriteBytes)} bytes of writes`
            : undefined;
      if (over !== undefined) {
        return {
          outcome: "deny",
          ruleId: "cost.delegation-limit",
          ruleGroup: "cost",
          reason:
            `This delegation has used its limit of ${over}. Make no more tool calls. ` +
            "Reply now with the files you changed and what is left undone, so the caller can finish it.",
          call,
        };
      }
      used.toolCalls += 1;
      used.writeBytes += bytes;
      return undefined;
    },
  };
}

// The size of the content a write call sends: its arguments, serialized. Other calls write nothing.
function writtenBytes(toolName: string, args: JsonValue): number {
  return toolKind(toolName) === "write" ? new TextEncoder().encode(JSON.stringify(args)).length : 0;
}
