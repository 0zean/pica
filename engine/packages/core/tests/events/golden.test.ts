import { SessionEvent } from "@pica/protocol";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialNormalizerState, normalizeRuntimeEvent } from "../../src/index.ts";
import type { EventDraft, IncomingRuntimeEvent, NormalizerContext, RuntimeEventType } from "../../src/index.ts";

// Each <name>.runtime.ndjson is a recorded runtime event stream; <name>.pica.ndjson beside it is
// the reviewed list of Pica events it must map to, one per line. full-tour.runtime.ndjson is the
// FakeRuntime golden log from testkit, which contains every runtime event type.
const goldenDir = join(import.meta.dirname, "golden");
const context: NormalizerContext = { sessionId: "pica-session-1", rootAgent: "main" };

const cases = readdirSync(goldenDir)
  .filter((file) => file.endsWith(".runtime.ndjson"))
  .map((file) => file.slice(0, -".runtime.ndjson".length))
  .sort();

function readNdjson(file: string): unknown[] {
  return readFileSync(join(goldenDir, file), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
}

function normalizeAll(events: readonly IncomingRuntimeEvent[]): EventDraft[] {
  let state = initialNormalizerState;
  const drafts: EventDraft[] = [];
  for (const event of events) {
    const normalized = normalizeRuntimeEvent(state, event, context);
    state = normalized.state;
    drafts.push(...normalized.drafts);
  }
  return drafts;
}

const allRuntimeTypes: readonly RuntimeEventType[] = [
  "session.start",
  "session.resume",
  "user.message",
  "assistant.turn_start",
  "assistant.message_delta",
  "assistant.message",
  "tool.execution_start",
  "tool.execution_complete",
  "permission.requested",
  "permission.completed",
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
  "assistant.usage",
  "session_limits_exhausted.requested",
  "session_limits_exhausted.completed",
  "session.usage_info",
  "session.error",
  "abort",
  "assistant.turn_end",
  "session.idle",
];

describe("runtime event normalization goldens", () => {
  it("cover every runtime event type", () => {
    const seen = new Set(
      cases.flatMap((name) =>
        (readNdjson(`${name}.runtime.ndjson`) as IncomingRuntimeEvent[]).map((event) => event.type),
      ),
    );
    // session.resume is only emitted by resumeSession, which the full tour does not exercise.
    expect(allRuntimeTypes.filter((type) => !seen.has(type))).toEqual(["session.resume"]);
  });

  it("map session.resume to nothing, like the other lifecycle events", () => {
    const drafts = normalizeAll([
      { id: "e", timestamp: "2026-01-01T00:00:00.000Z", type: "session.resume", data: { sessionId: "s" } },
    ]);
    expect(drafts).toEqual([]);
  });

  it.each(cases)("%s maps to its golden Pica events", (name) => {
    const runtimeEvents = readNdjson(`${name}.runtime.ndjson`) as IncomingRuntimeEvent[];
    const drafts = normalizeAll(runtimeEvents);
    expect(JSON.parse(JSON.stringify(drafts))).toEqual(readNdjson(`${name}.pica.ndjson`));
  });

  it.each(cases)("%s produces events that satisfy the protocol schema", (name) => {
    const drafts = normalizeAll(readNdjson(`${name}.runtime.ndjson`) as IncomingRuntimeEvent[]);
    drafts.forEach((draft, index) => {
      const event = { sessionId: context.sessionId, seq: index + 1, ...draft };
      expect(SessionEvent.safeParse(event).error).toBeUndefined();
    });
  });
});
