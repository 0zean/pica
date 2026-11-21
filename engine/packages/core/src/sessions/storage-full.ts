import type { EventLog } from "../events/index.ts";
import type { Session } from "../store/index.ts";

// H-05: a session whose writes hit a full disk is failed. The store may be unable to record that
// too, so the service remembers it and reports the session as failed until the engine restarts;
// a restart then finds the session as the store last recorded it (docs/reliability.md).
export interface StorageFailures {
  // Passes every append through `notice`.
  watch(log: EventLog): EventLog;
  // Calls `onFull` once per session, after the write that hit the full disk has returned.
  notice(sessionId: string, error: { readonly code: string; readonly message: string }): void;
  // Marks the session failed for `overlay` and `reason`.
  record(sessionId: string, message: string): void;
  // Why the session failed, or undefined when it has not.
  reason(sessionId: string): string | undefined;
  overlay(session: Session): Session;
}

export const storageFullCode = "storage_full";

export function createStorageFailures(onFull: (sessionId: string, message: string) => void): StorageFailures {
  const failed = new Map<string, string>();
  const noticed = new Set<string>();
  const notice: StorageFailures["notice"] = (sessionId, error) => {
    if (error.code !== "store.full" || noticed.has(sessionId)) {
      return;
    }
    noticed.add(sessionId);
    // Deferred, so failing the session does not re-enter the code that was writing.
    queueMicrotask(() => {
      onFull(sessionId, error.message);
    });
  };
  return {
    watch: (log) => ({
      subscribe: (sessionId, afterSeq, listener) => log.subscribe(sessionId, afterSeq, listener),
      append: (sessionId, draft) => {
        const appended = log.append(sessionId, draft);
        if (!appended.ok) {
          notice(sessionId, appended.error);
        }
        return appended;
      },
    }),
    notice,
    record: (sessionId, message) => {
      failed.set(sessionId, message);
    },
    reason: (sessionId) => failed.get(sessionId),
    overlay: (session) => (failed.has(session.id) && session.state !== "failed" ? { ...session, state: "failed" } : session),
  };
}
