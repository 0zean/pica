import { createEventLog, createRuntimeEventRecorder } from "@pica/core";
import type { IncomingRuntimeEvent, PicaSessionEvent as SessionEvent } from "@pica/core";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedStore, value, withTempDir } from "./helpers.ts";

const sessionId = "session-a";

function runtimeEvent(id: number, type: string, data: unknown): IncomingRuntimeEvent {
  return { id: `event-${String(id)}`, timestamp: `2026-11-13T10:00:00.${String(id).padStart(3, "0")}Z`, type, data };
}

const stream: readonly IncomingRuntimeEvent[] = [
  runtimeEvent(1, "user.message", { messageId: "m-1", content: "hi" }),
  runtimeEvent(2, "assistant.reasoning_delta", { reasoningId: "r-1", deltaContent: "thinking" }),
  runtimeEvent(3, "assistant.message_delta", { messageId: "m-2", deltaContent: "Hel" }),
  runtimeEvent(4, "assistant.message", null),
  runtimeEvent(5, "session.compaction_start", { reason: "context full" }),
  runtimeEvent(6, "assistant.message", { messageId: "m-2", content: "Hello" }),
];

describe("unmapped runtime events", () => {
  let cleanup = (): void => undefined;
  afterEach(() => {
    cleanup();
  });

  it("are logged as runtime.unknown and the events after them are still logged and delivered", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const log = createEventLog(store.events);
    const delivered: SessionEvent[] = [];
    log.subscribe(sessionId, 0, { onEvent: (event) => delivered.push(event) });
    const recorder = createRuntimeEventRecorder(log, { sessionId, rootAgent: "main" });

    for (const event of stream) {
      expect(recorder.record(event).errors).toEqual([]);
    }

    const logged = value(store.events.readAfter(sessionId, 0));
    expect(logged.map((event) => event.type)).toEqual([
      "user.message",
      "runtime.unknown",
      "assistant.delta",
      "runtime.unknown",
      "runtime.unknown",
      "assistant.message",
    ]);
    expect(logged[1]?.payload).toEqual({
      runtimeType: "assistant.reasoning_delta",
      raw: { ...stream[1] },
    });
    expect(logged[3]?.payload).toEqual({ runtimeType: "assistant.message", raw: { ...stream[3] } });
    expect(delivered.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(delivered.at(-1)).toMatchObject({ type: "assistant.message", payload: { text: "Hello" } });
    store.close();
  });

  it("keep their runtime event intact so a later version can map them on replay", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const recorder = createRuntimeEventRecorder(createEventLog(store.events), { sessionId, rootAgent: "main" });
    const odd = runtimeEvent(7, "session.future", { nested: { list: [1, "two", null, { deep: true }] } });

    const outcome = recorder.record(odd);

    expect(outcome.appended).toHaveLength(1);
    expect(value(store.events.readAfter(sessionId, 0))[0]?.payload).toEqual({ runtimeType: "session.future", raw: odd });
    store.close();
  });
});
