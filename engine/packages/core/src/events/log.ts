import { eventPayloads, SessionEvent as SessionEventSchema, Timestamp } from "@pica/protocol";
import type { SessionEvent } from "@pica/protocol";
import type { JsonValue } from "../json.ts";
import type { Result } from "../result.ts";
import { err, ok } from "../result.ts";
import type { EventRepository, StoreErrorCode } from "../store/index.ts";
import type { EventDraft } from "./normalize.ts";
import { checkPayload } from "./validate.ts";

export type EventLogErrorCode =
  | StoreErrorCode
  | "event_log.invalid_event"
  | "event_log.invalid_cursor"
  | "event_log.listener_failed";

export interface EventLogError {
  readonly code: EventLogErrorCode;
  readonly message: string;
}

export type EventLogResult<T> = Result<T, EventLogError>;

export interface EventLogListener {
  // `subscription` is the handle `subscribe` returns, usable before that call has returned.
  readonly onEvent: (event: SessionEvent, subscription: EventSubscription) => void;
  // Called at most once; the subscription is closed when it is.
  readonly onError?: (error: EventLogError) => void;
}

export interface EventSubscription {
  close(): void;
}

export interface EventLog {
  append(sessionId: string, draft: EventDraft): EventLogResult<SessionEvent>;
  // Delivers every event with seq > afterSeq, first from the log and then live, each exactly once
  // and in seq order. Delivery is synchronous: replay runs inside this call, live events inside
  // the `append` that wrote them.
  subscribe(sessionId: string, afterSeq: number, listener: EventLogListener): EventSubscription;
}

export interface EventLogOptions {
  readonly pageSize?: number;
}

const defaultPageSize = 500;

interface Subscriber {
  readonly drain: () => void;
}

// The engine is the only writer of its store, so every append passes through here and can wake
// subscribers; each subscriber reads forward from its own cursor, which makes gaps and duplicates
// impossible however appends and replay interleave.
export function createEventLog(events: EventRepository, options: EventLogOptions = {}): EventLog {
  const pageSize = options.pageSize ?? defaultPageSize;
  const subscribers = new Map<string, Set<Subscriber>>();

  function wake(sessionId: string): void {
    for (const subscriber of [...(subscribers.get(sessionId) ?? [])]) {
      subscriber.drain();
    }
  }

  return {
    append: (sessionId, draft) => {
      const checked = checkDraft(draft);
      if (!checked.ok) {
        return checked;
      }
      const appended = events.append(sessionId, checked.value);
      if (!appended.ok) {
        return appended;
      }
      const stored = parseStored(appended.value);
      if (stored.ok) {
        wake(sessionId);
      }
      return stored;
    },
    subscribe: (sessionId, afterSeq, listener) => {
      const set = subscribers.get(sessionId) ?? new Set<Subscriber>();
      subscribers.set(sessionId, set);
      const subscriber = startSubscriber(events, sessionId, afterSeq, pageSize, listener, () => {
        set.delete(subscriber);
        if (set.size === 0 && subscribers.get(sessionId) === set) {
          subscribers.delete(sessionId);
        }
      });
      set.add(subscriber);
      subscriber.drain();
      return subscriber.handle;
    },
  };
}

function startSubscriber(
  events: EventRepository,
  sessionId: string,
  afterSeq: number,
  pageSize: number,
  listener: EventLogListener,
  unregister: () => void,
): Subscriber & { readonly handle: EventSubscription } {
  let cursor = afterSeq;
  let closed = false;
  let draining = false;
  let woken = false;

  function close(): void {
    if (!closed) {
      closed = true;
      unregister();
    }
  }

  const handle: EventSubscription = { close };

  function fail(error: EventLogError): void {
    close();
    listener.onError?.(error);
  }

  // Returns true when it read a full page, so there may be more.
  function readPage(): boolean {
    const page = events.readAfter(sessionId, cursor, pageSize);
    if (!page.ok) {
      fail(page.error);
      return false;
    }
    for (const row of page.value) {
      if (closed) {
        return false;
      }
      const event = parseStored(row);
      if (!event.ok) {
        fail(event.error);
        return false;
      }
      cursor = event.value.seq;
      if (!deliver(event.value)) {
        return false;
      }
    }
    return page.value.length === pageSize;
  }

  // A throwing listener loses its subscription instead of breaking the appender or other subscribers.
  function deliver(event: SessionEvent): boolean {
    try {
      listener.onEvent(event, handle);
      return true;
    } catch (error) {
      fail({ code: "event_log.listener_failed", message: `listener threw at seq ${String(event.seq)}: ${String(error)}` });
      return false;
    }
  }

  // A listener that appends re-enters here; the outer loop picks its events up instead.
  function drain(): void {
    if (closed) {
      return;
    }
    if (draining) {
      woken = true;
      return;
    }
    draining = true;
    let more = true;
    while (more) {
      woken = false;
      more = readPage() || wokenWhileReading();
    }
    draining = false;
  }

  function wokenWhileReading(): boolean {
    return woken && !closed;
  }

  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    return {
      drain: () => {
        fail({ code: "event_log.invalid_cursor", message: `afterSeq must be a non-negative integer, got ${String(afterSeq)}` });
      },
      handle,
    };
  }
  return { drain, handle };
}

interface StoredDraft {
  readonly type: string;
  readonly payload: JsonValue;
  readonly timestamp: string;
}

function checkDraft(draft: EventDraft): EventLogResult<StoredDraft> {
  if (!Object.hasOwn(eventPayloads, draft.type)) {
    return invalid(`unknown event type "${draft.type}"`);
  }
  const timestamp = checkPayload(Timestamp, draft.timestamp);
  if (!timestamp.ok) {
    return invalid(`${draft.type}: timestamp: ${timestamp.error}`);
  }
  const payload = checkPayload(eventPayloads[draft.type], draft.payload);
  if (!payload.ok) {
    return invalid(`${draft.type}: ${payload.error}`);
  }
  return ok({ type: draft.type, payload: toJson(payload.value), timestamp: draft.timestamp });
}

// Payload schemas allow `unknown` fields (tool arguments, raw runtime events); the store keeps JSON.
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function parseStored(row: unknown): EventLogResult<SessionEvent> {
  const parsed = checkPayload(SessionEventSchema, row);
  if (!parsed.ok) {
    return invalid(`stored event does not match the protocol: ${parsed.error}`);
  }
  // The schema accepted it, so it is one of the union's variants.
  return ok(parsed.value as SessionEvent);
}

function invalid(message: string): { readonly ok: false; readonly error: EventLogError } {
  return err({ code: "event_log.invalid_event", message });
}
