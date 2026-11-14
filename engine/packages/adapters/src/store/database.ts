import type { StoreResult } from "@pica/core";
import { DatabaseSync } from "node:sqlite";

const busyTimeoutMs = 5000;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)};`);
  enableWal(db);
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  return db;
}

// SQLite does not apply the busy timeout to switching a new file into WAL mode: when two engines
// open the same new database at once, one gets "database is locked" immediately. Retry until the
// same deadline the busy timeout would have given.
function enableWal(db: DatabaseSync): void {
  const deadline = Date.now() + busyTimeoutMs;
  for (;;) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (error) {
      if (!isLocked(error) || Date.now() >= deadline) {
        throw error;
      }
      sleepSync(walRetryMs);
    }
  }
}

const walRetryMs = 10;

function isLocked(error: unknown): boolean {
  return error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// BEGIN IMMEDIATE takes the write lock up front, so a read-then-write inside the body cannot race
// another connection; a deferred transaction would fail with SQLITE_BUSY_SNAPSHOT instead of waiting.
export function inTransaction<T>(db: DatabaseSync, body: () => StoreResult<T>): StoreResult<T> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (thrown) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw thrown;
  }
}
