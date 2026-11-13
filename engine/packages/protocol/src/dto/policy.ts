import * as z from "zod";
import { Id } from "../common.ts";

export const PolicyOutcome = z.enum(["allow", "deny", "ask", "rewrite"]);
export const PolicyRuleGroup = z.enum(["managed", "safety", "cost", "permission"]);

export const PolicyDecision = z.object({
  ruleId: z.string().min(1),
  ruleGroup: PolicyRuleGroup,
  outcome: PolicyOutcome,
  reason: z.string(),
  toolCallId: Id,
  toolName: z.string().min(1),
  agent: z.string().min(1),
});

export const ApprovalChoice = z.enum(["allow_once", "allow_always", "deny"]);

export const ApprovalRequest = z.object({
  id: Id,
  sessionId: Id,
  kind: z.enum(["tool_call", "budget"]),
  toolCallId: Id.nullable(),
  summary: z.string(),
});
