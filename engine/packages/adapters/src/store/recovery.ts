import { existsSync, renameSync } from "node:fs";
import { err, ok } from "@pica/core";
import type { Store, StoreResult } from "@pica/core";
import { storeError } from "./errors.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { SqliteStoreOptions } from "./sqlite-store.ts";

export interface StoreRecovery {
  // Where the damaged database now is. Its `-wal` and `-shm` files, if any, sit beside it.
  readonly backupPath: string;
  // Why the database could not be used: the error SQLite or the integrity check reported.
  readonly reason: string;
  readonly at: string;
}

export interface RecoveredStore {
  readonly store: Store;
  // Null when the database opened as it was.
  readonly recovery: StoreRecovery | null;
}

export interface RecoveryOptions extends SqliteStoreOptions {
  readonly now: () => Date;
}

const companions = ["-wal", "-shm", "-journal"] as const;

// H-05: opens the store at `path`; if the file is damaged, moves it (with its WAL and shared
// memory files) aside to `<path>.corrupt-<time>` and starts with an empty database. Only
// `store.corrupt` is recovered; a busy, too-new or unreadable database is still an error.
export function openRecoveringSqliteStore(path: string, options: RecoveryOptions): StoreResult<RecoveredStore> {
  const opened = openSqliteStore(path, options);
  if (opened.ok) {
    return ok({ store: opened.value, recovery: null });
  }
  if (opened.error.code !== "store.corrupt") {
    return opened;
  }
  const at = options.now();
  const backupPath = moveAside(path, at);
  if (!backupPath.ok) {
    return backupPath;
  }
  const fresh = openSqliteStore(path, options);
  if (!fresh.ok) {
    return fresh;
  }
  return ok({
    store: fresh.value,
    recovery: { backupPath: backupPath.value, reason: opened.error.message, at: at.toISOString() },
  });
}

function moveAside(path: string, at: Date): StoreResult<string> {
  const backupPath = freeBackupPath(path, at);
  try {
    renameSync(path, backupPath);
    for (const suffix of companions) {
      if (existsSync(path + suffix)) {
        renameSync(path + suffix, backupPath + suffix);
      }
    }
    return ok(backupPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storeError("store.failed", `could not move the damaged database aside: ${message}`));
  }
}

// `pica.db.corrupt-20261121T101500Z`, with `-2`, `-3`… when that name is taken.
function freeBackupPath(path: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = `${path}.corrupt-${stamp}`;
  let candidate = base;
  for (let n = 2; existsSync(candidate); n += 1) {
    candidate = `${base}-${String(n)}`;
  }
  return candidate;
}
