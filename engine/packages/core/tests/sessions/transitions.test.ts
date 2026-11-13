import { SessionState } from "@pica/protocol";
import { describe, expect, it } from "vitest";
import { sessionStates, sessionTriggers, transitionSession } from "../../src/index.ts";
import type { SessionState as State, SessionTrigger } from "../../src/index.ts";

// Every legal transition, written out independently of the implementation's table.
const legal: readonly (readonly [State, SessionTrigger, State])[] = [
  ["starting", "runtime_ready", "idle"],
  ["starting", "engine_lost", "resumable"],
  ["starting", "fail", "failed"],
  ["starting", "end", "ended"],
  ["idle", "send", "running"],
  ["idle", "engine_lost", "resumable"],
  ["idle", "fail", "failed"],
  ["idle", "end", "ended"],
  ["running", "approval_requested", "awaiting_approval"],
  ["running", "turn_ended", "idle"],
  ["running", "engine_lost", "resumable"],
  ["running", "fail", "failed"],
  ["running", "end", "ended"],
  ["awaiting_approval", "approval_resolved", "running"],
  ["awaiting_approval", "turn_ended", "idle"],
  ["awaiting_approval", "engine_lost", "resumable"],
  ["awaiting_approval", "fail", "failed"],
  ["awaiting_approval", "end", "ended"],
  ["resumable", "resume", "idle"],
  ["resumable", "fail", "failed"],
  ["resumable", "end", "ended"],
];

const legalTarget = new Map(legal.map(([from, trigger, to]) => [`${from}/${trigger}`, to]));
const allPairs = sessionStates.flatMap((from) => sessionTriggers.map((trigger) => [from, trigger] as const));
const illegal = allPairs.filter(([from, trigger]) => !legalTarget.has(`${from}/${trigger}`));

describe("session transition table", () => {
  it("covers exactly the protocol's session states", () => {
    expect([...sessionStates].sort()).toEqual([...SessionState.options].sort());
  });

  it.each(legal)("accepts %s --%s--> %s", (from, trigger, to) => {
    expect(transitionSession(from, trigger)).toEqual({ ok: true, value: to });
  });

  it.each(illegal)("rejects %s --%s-->", (from, trigger) => {
    const result = transitionSession(from, trigger);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "session.invalid_transition", from, trigger });
  });

  it("checks every state and trigger pair", () => {
    expect(legal.length + illegal.length).toBe(sessionStates.length * sessionTriggers.length);
  });

  it("leaves ended and failed sessions terminal", () => {
    for (const trigger of sessionTriggers) {
      expect(transitionSession("ended", trigger).ok).toBe(false);
      expect(transitionSession("failed", trigger).ok).toBe(false);
    }
  });
});
