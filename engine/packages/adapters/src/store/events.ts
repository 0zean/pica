import { ok } from "@pica/core";
import type { EventRepository, SessionEvent } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./database.ts";
import { attempt, fail } from "./errors.ts";
import { integer, json, text } from "./rows.ts";
import type { Row } from "./rows.ts";

const defaultReadLimit = 1000;

export function sqliteEventRepository(db: DatabaseSync): EventRepository {
  const last = db.prepare(
    "SELECT coalesce(max(seq), 0) AS seq FROM session_events WHERE session_id = ?",
  );
  const insert = db.prepare(`
    INSERT INTO session_events (session_id, seq, type, payload, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  const after = db.prepare(`
    SELECT session_id, seq, type, payload, timestamp FROM session_events
    WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?
  `);

  function lastSeq(sessionId: string): number {
    const row = last.get(sessionId);
    return row === undefined ? 0 : integer(row, "seq");
  }

  return {
    // The next seq is read and written under one write lock, so concurrent appenders on other
    // connections queue behind it rather than claiming the same number.
    append: (sessionId, event) =>
      attempt(() =>
        inTransaction(db, () => {
          const seq = lastSeq(sessionId) + 1;
          insert.run(sessionId, seq, event.type, JSON.stringify(event.payload), event.timestamp);
          return ok({ sessionId, seq, ...event });
        }),
      ),
    readAfter: (sessionId, afterSeq, limit = defaultReadLimit) =>
      attempt(() => {
        if (!Number.isInteger(limit) || limit < 1) {
          return fail("store.failed", `read limit must be a positive integer, got ${String(limit)}`);
        }
        return ok(after.all(sessionId, afterSeq, limit).map(toEvent));
      }),
    lastSeq: (sessionId) => attempt(() => ok(lastSeq(sessionId))),
  };
}

function toEvent(row: Row): SessionEvent {
  return {
    sessionId: text(row, "session_id"),
    seq: integer(row, "seq"),
    type: text(row, "type"),
    payload: json(row, "payload"),
    timestamp: text(row, "timestamp"),
  };
}
