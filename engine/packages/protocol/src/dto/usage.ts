import * as z from "zod";
import { Count, Credits, Id, Timestamp } from "../common.ts";

export const UsageRecord = z.object({
  sessionId: Id,
  agent: z.string().min(1),
  model: Id,
  inputTokens: Count,
  cachedInputTokens: Count,
  outputTokens: Count,
  credits: Credits,
  timestamp: Timestamp,
});

export const UsageGroupBy = z.enum(["session", "agent", "model", "workspace", "day"]);

export const UsageRollupRow = z.object({
  key: z.string(),
  calls: Count,
  inputTokens: Count,
  cachedInputTokens: Count,
  outputTokens: Count,
  credits: Credits,
});

// Worker-tier tokens repriced at the reasoning tier's rates, minus what they cost (PLAN.md §5.6).
export const SavingsEstimate = z.object({
  estimated: z.literal(true),
  credits: z.number(),
});
