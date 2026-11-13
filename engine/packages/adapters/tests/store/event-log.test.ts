import { createEventLog } from "@pica/core";
import type { EventLog, EventLogError, PicaSessionEvent as SessionEvent } from "@pica/core";
import fc from "fast-check";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedStore, value, withTempDir } from "./helpers.ts";

const sessionId = "session-a";
const otherSessionId = "session-b";
const timestamp = "2026-11-13T10:00:00.000Z";

function message(text: string): { type: "user.message"; payload: { text: string; mode: "send" }; timestamp: string } {
  return { type: "user.message", payload: { text, mode: "send" }, timestamp };
}

function appendOrThrow(log: EventLog, session: string, text: string): SessionEvent {
  const result = log.append(session, message(text));
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

interface SubscriberPlan {
  // Picks afterSeq relative to the log length when the subscriber starts; may lie beyond it.
  readonly afterSeqPick: number;
  // When set, the listener appends one event of its own on its first delivery (re-entrant append).
  readonly appendsFromListener: boolean;
  readonly closesAfter: number | null;
}

const subscriberArbitrary: fc.Arbitrary<SubscriberPlan> = fc.record({
  afterSeqPick: fc.nat({ max: 1000 }),
  appendsFromListener: fc.boolean(),
  closesAfter: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
});

describe("event log subscriptions", () => {
  let cleanup = (): void => undefined;
  afterEach(() => {
    cleanup();
  });

  it("deliver every event after afterSeq exactly once and in order, whenever the subscriber starts during concurrent appends", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 2, maxLength: 4 }),
        fc.array(subscriberArbitrary, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 6 }),
        async (scheduler, producerCounts, subscriberPlans, pageSize) => {
          const temp = withTempDir();
          cleanup = temp.cleanup;
          const store = seedStore(join(temp.dir, "pica.db"), [sessionId, otherSessionId]);
          const log = createEventLog(store.events, { pageSize });

          const producers = producerCounts.map(async (count, producer) => {
            for (let index = 0; index < count; index += 1) {
              await scheduler.schedule(Promise.resolve(), `producer ${String(producer)} #${String(index)}`);
              appendOrThrow(log, sessionId, `p${String(producer)}-${String(index)}`);
              appendOrThrow(log, otherSessionId, `noise-${String(producer)}-${String(index)}`);
            }
          });

          const subscribers = subscriberPlans.map(async (plan, subscriber) => {
            await scheduler.schedule(Promise.resolve(), `subscriber ${String(subscriber)} starts`);
            const lastAtStart = value(store.events.lastSeq(sessionId));
            const afterSeq = plan.afterSeqPick % (lastAtStart + 3);
            const seen: SessionEvent[] = [];
            const errors: EventLogError[] = [];
            let appended = false;
            log.subscribe(sessionId, afterSeq, {
              onEvent: (event, subscription) => {
                seen.push(event);
                if (plan.appendsFromListener && !appended) {
                  appended = true;
                  appendOrThrow(log, sessionId, `from-listener-${String(subscriber)}`);
                }
                if (plan.closesAfter !== null && seen.length >= plan.closesAfter) {
                  subscription.close();
                }
              },
              onError: (error) => errors.push(error),
            });
            return { plan, afterSeq, seen, errors };
          });

          await scheduler.waitFor(Promise.all(producers));
          const results = await scheduler.waitFor(Promise.all(subscribers));

          const stored = value(store.events.readAfter(sessionId, 0, 10_000));
          const listenerAppends = results.filter((result) => result.plan.appendsFromListener && result.seen.length > 0).length;
          expect(stored).toHaveLength(producerCounts.reduce((sum, count) => sum + count, 0) + listenerAppends);

          for (const { plan, afterSeq, seen, errors } of results) {
            expect(errors).toEqual([]);
            let expected = stored.filter((event) => event.seq > afterSeq);
            if (plan.closesAfter !== null) {
              expected = expected.slice(0, plan.closesAfter);
            }
            expect(seen.map((event) => event.seq)).toEqual(expected.map((event) => event.seq));
            expect(seen).toEqual(expected);
          }
          store.close();
          temp.cleanup();
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  it("deliver an event appended from inside a listener even when nothing is appended after it", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const log = createEventLog(store.events, { pageSize: 10 });
    const seen: number[] = [];
    log.subscribe(sessionId, 0, {
      onEvent: (event) => {
        seen.push(event.seq);
        if (event.seq < 3) {
          appendOrThrow(log, sessionId, `reply-${String(event.seq)}`);
        }
      },
    });
    appendOrThrow(log, sessionId, "first");
    expect(seen).toEqual([1, 2, 3]);
    store.close();
  });

  it("rejects an event whose payload does not match the protocol, without writing it", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const log = createEventLog(store.events);
    const result = log.append(sessionId, {
      type: "context.usage",
      payload: { currentTokens: -1, tokenLimit: 10 },
      timestamp,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("event_log.invalid_event");
    expect(value(store.events.lastSeq(sessionId))).toBe(0);
    store.close();
  });

  it("closes only the subscription whose listener throws", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const log = createEventLog(store.events);
    const errors: EventLogError[] = [];
    const healthy: number[] = [];
    log.subscribe(sessionId, 0, {
      onEvent: () => {
        throw new Error("boom");
      },
      onError: (error) => errors.push(error),
    });
    log.subscribe(sessionId, 0, { onEvent: (event) => healthy.push(event.seq) });
    appendOrThrow(log, sessionId, "one");
    appendOrThrow(log, sessionId, "two");
    expect(healthy).toEqual([1, 2]);
    expect(errors.map((error) => error.code)).toEqual(["event_log.listener_failed"]);
    store.close();
  });

  it("refuses a negative or fractional afterSeq", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), [sessionId]);
    const log = createEventLog(store.events);
    const codes: string[] = [];
    log.subscribe(sessionId, -1, { onEvent: () => undefined, onError: (error) => codes.push(error.code) });
    log.subscribe(sessionId, 1.5, { onEvent: () => undefined, onError: (error) => codes.push(error.code) });
    expect(codes).toEqual(["event_log.invalid_cursor", "event_log.invalid_cursor"]);
    store.close();
  });
});
