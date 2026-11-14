import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@pica/protocol";
import { fanOutCounts, fanOutState, observeRunEvent } from "../../src/index.ts";
import type { FanOutRunStatus, TrackedRun } from "../../src/index.ts";

const base: TrackedRun = { repoId: "r1", sessionId: "s1", status: "starting", error: null, aborted: false };

let seq = 0;
function event(draft: Pick<SessionEvent, "type" | "payload">): SessionEvent {
  seq += 1;
  return { ...draft, sessionId: "s1", seq, timestamp: "2026-11-14T09:00:00.000Z" } as SessionEvent;
}

const toState = (from: string, to: string): SessionEvent =>
  event({ type: "session.state_changed", payload: { from, to } } as Pick<SessionEvent, "type" | "payload">);

function play(events: readonly SessionEvent[]): TrackedRun {
  return events.reduce(observeRunEvent, base);
}

describe("observeRunEvent", () => {
  it("succeeds when the turn returns to idle cleanly", () => {
    expect(play([toState("idle", "running"), toState("running", "idle")]).status).toBe("succeeded");
  });

  it("tracks approvals while the turn runs", () => {
    expect(play([toState("idle", "running"), toState("running", "awaiting_approval")]).status).toBe("awaiting_approval");
  });

  it("fails a turn that reported a session error", () => {
    const run = play([
      toState("idle", "running"),
      event({ type: "session.error", payload: { code: "runtime.failed", message: "down" } }),
      toState("running", "idle"),
    ]);
    expect(run).toMatchObject({ status: "failed", error: { code: "runtime.failed", message: "down" } });
  });

  it("cancels a turn aborted by the user and fails one whose budget was denied", () => {
    const aborted = (reason: "user" | "budget"): TrackedRun =>
      play([toState("idle", "running"), event({ type: "session.aborted", payload: { reason } }), toState("running", "idle")]);
    expect(aborted("user").status).toBe("cancelled");
    expect(aborted("budget")).toMatchObject({ status: "failed", error: { code: "session.budget_denied" } });
  });

  it("fails on a failed or lost session and cancels on an ended one", () => {
    expect(play([toState("idle", "failed")]).status).toBe("failed");
    expect(play([toState("running", "resumable")])).toMatchObject({ status: "failed", error: { code: "session.engine_lost" } });
    expect(play([toState("running", "ended")]).status).toBe("cancelled");
  });

  it("ignores everything after the run settles", () => {
    const run = play([toState("idle", "running"), toState("running", "idle"), toState("idle", "running")]);
    expect(run.status).toBe("succeeded");
  });
});

describe("fan-out aggregate", () => {
  const runs = (statuses: readonly FanOutRunStatus[]): TrackedRun[] =>
    statuses.map((status, index) => ({ ...base, repoId: `r${String(index)}`, status }));

  it("counts runs by outcome", () => {
    expect(fanOutCounts(runs(["queued", "starting", "running", "awaiting_approval", "succeeded", "failed", "cancelled"]))).toEqual({
      queued: 1,
      active: 3,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
    });
  });

  it("is completed even when runs failed, and cancelling until aborted runs settle", () => {
    expect(fanOutState(runs(["succeeded", "failed"]), false)).toBe("completed");
    expect(fanOutState(runs(["succeeded", "running"]), false)).toBe("running");
    expect(fanOutState(runs(["cancelled", "running"]), true)).toBe("cancelling");
    expect(fanOutState(runs(["cancelled", "succeeded"]), true)).toBe("cancelled");
  });
});
