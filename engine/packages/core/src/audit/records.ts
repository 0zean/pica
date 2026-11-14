import type { SessionEvent } from "@pica/protocol";
import type { EventDraftOf } from "../events/index.ts";
import type { PolicyDecision } from "../policy/index.ts";
import type { AuditRecord } from "./types.ts";

// Only identifiers, outcomes and sizes are kept: arguments, results, error text and approval
// summaries can carry file contents or secrets, and the audit log is exported off the machine.
export function auditRecordOf(event: SessionEvent): AuditRecord | undefined {
  const base = { sessionId: event.sessionId, eventSeq: event.seq, timestamp: event.timestamp };
  switch (event.type) {
    case "tool.started":
    case "tool.failed": {
      const { toolCallId, toolName, agent, parentToolCallId } = event.payload;
      return { ...base, kind: event.type, data: { toolCallId, toolName, agent, parentToolCallId } };
    }
    case "tool.completed": {
      const { toolCallId, toolName, agent, parentToolCallId, resultBytes } = event.payload;
      return { ...base, kind: event.type, data: { toolCallId, toolName, agent, parentToolCallId, resultBytes } };
    }
    case "policy.decision": {
      const { ruleId, ruleGroup, outcome, reason, toolCallId, toolName, agent } = event.payload;
      return { ...base, kind: event.type, data: { ruleId, ruleGroup, outcome, reason, toolCallId, toolName, agent } };
    }
    case "approval.requested": {
      const { id, kind, toolCallId } = event.payload;
      return { ...base, kind: event.type, data: { approvalId: id, approvalKind: kind, toolCallId } };
    }
    case "approval.resolved": {
      const { approvalId, choice } = event.payload;
      return { ...base, kind: event.type, data: { approvalId, choice } };
    }
    default:
      return undefined;
  }
}

/** PLAN.md §4.4: every policy decision is emitted as a `policy.decision` event. */
export function policyDecisionEvent(decision: PolicyDecision, timestamp: string): EventDraftOf<"policy.decision"> {
  const { ruleId, ruleGroup, outcome, reason, call } = decision;
  return {
    type: "policy.decision",
    timestamp,
    payload: { ruleId, ruleGroup, outcome, reason, toolCallId: call.id, toolName: call.tool, agent: call.agent },
  };
}
