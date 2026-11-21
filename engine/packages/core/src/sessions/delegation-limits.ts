import { toolKind } from "../agents/index.ts";
import type { JsonValue } from "../json.ts";
import type { PolicyContext, PolicyDecision, ToolCall } from "../policy/index.ts";
import type { ToolUseInput } from "../runtime/index.ts";

// What one delegation has spent so far. A delegation is one sub-agent run: the runtime gives each
// its own `agentId` (S-02), so two `task` calls to `code-writer` are counted apart.
interface DelegationUsage {
  toolCalls: number;
  writeBytes: number;
  // Set by the first limit denial: the limit it hit. From then on the delegation has ended.
  ended?: string;
  // Calls denied after the delegation ended.
  deniedAfterEnd: number;
}

export interface DelegationLimiter {
  // A deny once the delegation has used its limit, else undefined; a call that passes is counted.
  check(input: ToolUseInput, call: ToolCall, context: PolicyContext): PolicyDecision | undefined;
}

const codeWriter = "code-writer";

// C-11: `routing.delegation.codeWriter` caps the tool calls and the file content one delegation may
// spend, under `balanced` and `strict`. A write's content is the sub-agent's output tokens, so the
// byte cap bounds the output a delegation produces; the call cap bounds its model calls.
//
// The first call past either limit ends the delegation: it and every later call in that delegation
// are denied, a smaller write included, with a reason telling the sub-agent to stop and report. The
// runtime gives a hook no way to end a sync sub-agent (Copilot SDK 1.0.28: a pre-tool-use hook can
// only allow, deny or ask, and a custom agent has no turn cap), so a worker that ignores the reason
// can still spend turns. What the engine can do is make no call run once the limit is hit, and say
// so more bluntly on each repeat. In the 2026-11-17 live run one `license-headers` delegation called
// `view` through 24 denials; those are worker-tier turns, not reasoning-tier input.
export function createDelegationLimiter(): DelegationLimiter {
  const usage = new Map<string, DelegationUsage>();
  return {
    check(input, call, context) {
      const agentId = input.agentId;
      const limits = context.config.routing.delegation.codeWriter;
      if (agentId === undefined || call.agent !== codeWriter || context.config.routing.profile === "off") {
        return undefined;
      }
      const used = usage.get(agentId) ?? { toolCalls: 0, writeBytes: 0, deniedAfterEnd: 0 };
      usage.set(agentId, used);
      if (used.ended !== undefined) {
        used.deniedAfterEnd += 1;
        return limitDenial(
          call,
          `This delegation ended when it reached its limit of ${used.ended}, and ${String(used.deniedAfterEnd)} ` +
            `${used.deniedAfterEnd === 1 ? "call has" : "calls have"} been denied since. No tool call will run in it again. ` +
            "Do not call any tool. Reply now, in text, with the files you changed and what is left undone.",
        );
      }
      const bytes = writtenBytes(input.toolName, input.arguments);
      const over =
        used.toolCalls >= limits.maxToolCalls
          ? `${String(limits.maxToolCalls)} tool calls`
          : used.writeBytes + bytes > limits.maxWriteBytes
            ? `${String(limits.maxWriteBytes)} bytes of writes`
            : undefined;
      if (over !== undefined) {
        used.ended = over;
        return limitDenial(
          call,
          `This delegation has used its limit of ${over}, so it has ended: this call and every later one will be denied. ` +
            "Make no more tool calls. Reply now with the files you changed and what is left undone, so the caller can finish it.",
        );
      }
      used.toolCalls += 1;
      used.writeBytes += bytes;
      return undefined;
    },
  };
}

function limitDenial(call: ToolCall, reason: string): PolicyDecision {
  return { outcome: "deny", ruleId: "cost.delegation-limit", ruleGroup: "cost", reason, call };
}

// The size of the content a write call sends: its arguments, serialized. Other calls write nothing.
function writtenBytes(toolName: string, args: JsonValue): number {
  return toolKind(toolName) === "write" ? new TextEncoder().encode(JSON.stringify(args)).length : 0;
}
