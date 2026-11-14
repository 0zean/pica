import type { SessionEvent } from "@pica/protocol";
import type { SessionState } from "../store/index.ts";
import type { FanOutCounts, FanOutRun, FanOutRunStatus, FanOutState } from "./types.ts";

// A run as the fan-out tracks it: `aborted` remembers a `session.aborted` until the turn ends.
export interface TrackedRun extends FanOutRun {
  readonly aborted: boolean;
}

const terminalStatuses: ReadonlySet<FanOutRunStatus> = new Set(["succeeded", "failed", "cancelled"]);

export function isTerminalRun(status: FanOutRunStatus): boolean {
  return terminalStatuses.has(status);
}

export function isActiveRun(status: FanOutRunStatus): boolean {
  return status === "starting" || status === "running" || status === "awaiting_approval";
}

// Folds one stored event of the run's turn into the run. The turn ends when the session returns to
// `idle` (succeeded, or failed after a `session.error`, or cancelled after an abort) or leaves the
// live states.
export function observeRunEvent(run: TrackedRun, event: SessionEvent): TrackedRun {
  if (isTerminalRun(run.status)) {
    return run;
  }
  switch (event.type) {
    case "session.error":
      return { ...run, error: { code: event.payload.code, message: event.payload.message } };
    case "session.aborted":
      return event.payload.reason === "budget"
        ? { ...run, error: { code: "session.budget_denied", message: "the session's budget was not raised" } }
        : { ...run, aborted: true };
    case "session.state_changed":
      return onStateChanged(run, event.payload.to);
    default:
      return run;
  }
}

function onStateChanged(run: TrackedRun, to: SessionState): TrackedRun {
  switch (to) {
    case "running":
    case "awaiting_approval":
      return { ...run, status: to };
    case "idle":
      return { ...run, status: turnOutcome(run) };
    case "failed":
      return { ...run, status: "failed", error: run.error ?? { code: "session.failed", message: "the session failed" } };
    case "resumable":
      return { ...run, status: "failed", error: { code: "session.engine_lost", message: "the engine stopped during the run" } };
    case "ended":
      return { ...run, status: "cancelled" };
    default:
      return run;
  }
}

function turnOutcome(run: TrackedRun): FanOutRunStatus {
  if (run.error !== null) {
    return "failed";
  }
  return run.aborted ? "cancelled" : "succeeded";
}

export function fanOutCounts(runs: readonly FanOutRun[]): FanOutCounts {
  const count = (matches: (status: FanOutRunStatus) => boolean): number =>
    runs.filter((run) => matches(run.status)).length;
  return {
    queued: count((status) => status === "queued"),
    active: count(isActiveRun),
    succeeded: count((status) => status === "succeeded"),
    failed: count((status) => status === "failed"),
    cancelled: count((status) => status === "cancelled"),
  };
}

export function fanOutState(runs: readonly FanOutRun[], cancelRequested: boolean): FanOutState {
  const settled = runs.every((run) => isTerminalRun(run.status));
  if (cancelRequested) {
    return settled ? "cancelled" : "cancelling";
  }
  return settled ? "completed" : "running";
}

export function publicRun(run: TrackedRun): FanOutRun {
  return { repoId: run.repoId, sessionId: run.sessionId, status: run.status, error: run.error };
}
