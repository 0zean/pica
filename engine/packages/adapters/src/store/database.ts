import type { StoreResult } from "@pica/core";
import { DatabaseSync } from "node:sqlite";

const busyTimeoutMs = 5000;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = ${String(busyTimeoutMs)};
  `);
  return db;
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
