import type { StoreResult } from "@pica/core";
import { DatabaseSync } from "node:sqlite";

const busyTimeoutMs = 5000;

// H-05: thrown when the integrity check finds damage that SQLite did not raise as SQLITE_CORRUPT.
export class CorruptDatabaseError extends Error {}

// Closes the connection when setting it up throws (a file that is not a database throws here),
// so a caller can move the file aside. The integrity check runs before the switch to WAL, which
// would write to a damaged file's header.
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)};`);
    quickCheck(db);
    enableWal(db);
    db.exec(`
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
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

// quick_check reads every page but skips the index cross-checks of integrity_check, so it is cheap
// enough to run at each open. Damage is either thrown by SQLite or returned as rows.
function quickCheck(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA quick_check").all();
  const problems = rows.map((row) => String(row["quick_check"])).filter((message) => message !== "ok");
  if (problems.length > 0) {
    throw new CorruptDatabaseError(`database failed its integrity check: ${problems.slice(0, 3).join("; ")}`);
  }
}

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
