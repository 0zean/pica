import type { Result } from "../result.ts";
import { err, ok } from "../result.ts";
import type { SessionState } from "../store/index.ts";

// PLAN.md §4.4: starting → idle ⇄ running ⇄ awaiting_approval, then ended or failed. A session
// whose engine died is `resumable` until resumed or ended.
export const sessionStates = [
  "starting",
  "idle",
  "running",
  "awaiting_approval",
  "ended",
  "failed",
  "resumable",
] as const satisfies readonly SessionState[];

export const sessionTriggers = [
  "runtime_ready",
  "send",
  "approval_requested",
  "approval_resolved",
  "turn_ended",
  "resume",
  "engine_lost",
  "fail",
  "end",
] as const;

export type SessionTrigger = (typeof sessionTriggers)[number];

type TransitionRow = Readonly<Partial<Record<SessionTrigger, SessionState>>>;

const leave = { fail: "failed", end: "ended" } as const;

export const sessionTransitions: Readonly<Record<SessionState, TransitionRow>> = {
  starting: { runtime_ready: "idle", engine_lost: "resumable", ...leave },
  idle: { send: "running", engine_lost: "resumable", ...leave },
  running: { approval_requested: "awaiting_approval", turn_ended: "idle", engine_lost: "resumable", ...leave },
  awaiting_approval: { approval_resolved: "running", turn_ended: "idle", engine_lost: "resumable", ...leave },
  resumable: { resume: "idle", ...leave },
  ended: {},
  failed: {},
};

export interface SessionTransitionError {
  readonly code: "session.invalid_transition";
  readonly message: string;
  readonly from: SessionState;
  readonly trigger: SessionTrigger;
}

export function transitionSession(
  from: SessionState,
  trigger: SessionTrigger,
): Result<SessionState, SessionTransitionError> {
  const to = sessionTransitions[from][trigger];
  if (to === undefined) {
    return err({
      code: "session.invalid_transition",
      message: `a ${from} session cannot ${trigger.replaceAll("_", " ")}`,
      from,
      trigger,
    });
  }
  return ok(to);
}

export function isLiveSessionState(state: SessionState): boolean {
  return state === "starting" || state === "idle" || state === "running" || state === "awaiting_approval";
}
