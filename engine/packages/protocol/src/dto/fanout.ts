import * as z from "zod";
import { Count, Id, Timestamp } from "../common.ts";

export const FanOutRunStatus = z.enum([
  "queued",
  "starting",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

export const FanOutState = z.enum(["running", "cancelling", "completed", "cancelled"]);

export const FanOutRun = z.object({
  repoId: Id,
  sessionId: Id.nullable(),
  status: FanOutRunStatus,
  error: z.object({ code: z.string().min(1), message: z.string() }).nullable(),
});

export const FanOut = z.object({
  id: Id,
  workspaceId: Id,
  prompt: z.string().min(1),
  concurrency: z.int().min(1),
  state: FanOutState,
  runs: z.array(FanOutRun),
  counts: z.object({ queued: Count, active: Count, succeeded: Count, failed: Count, cancelled: Count }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
