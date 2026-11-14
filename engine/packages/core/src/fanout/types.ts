import type { Result } from "../result.ts";
import { err } from "../result.ts";

export const fanOutRunStatuses = [
  "queued",
  "starting",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type FanOutRunStatus = (typeof fanOutRunStatuses)[number];

// `cancelling` lasts from `cancel` until every aborted session has ended its turn.
export const fanOutStates = ["running", "cancelling", "completed", "cancelled"] as const;

export type FanOutState = (typeof fanOutStates)[number];

export interface FanOutRunError {
  readonly code: string;
  readonly message: string;
}

export interface FanOutRun {
  readonly repoId: string;
  readonly sessionId: string | null;
  readonly status: FanOutRunStatus;
  readonly error: FanOutRunError | null;
}

export interface FanOutCounts {
  readonly queued: number;
  readonly active: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface FanOutInfo {
  readonly id: string;
  readonly workspaceId: string;
  readonly prompt: string;
  readonly concurrency: number;
  readonly state: FanOutState;
  readonly runs: readonly FanOutRun[];
  readonly counts: FanOutCounts;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const fanOutErrorCodes = ["fanout.not_found", "fanout.invalid_request"] as const;

export type FanOutErrorCode = (typeof fanOutErrorCodes)[number];

export interface FanOutError {
  readonly code: FanOutErrorCode;
  readonly message: string;
}

export type FanOutResult<T> = Result<T, FanOutError>;

export function fanOutFailure(
  code: FanOutErrorCode,
  message: string,
): { readonly ok: false; readonly error: FanOutError } {
  return err({ code, message });
}
