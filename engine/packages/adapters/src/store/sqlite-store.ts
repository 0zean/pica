import { ok } from "@pica/core";
import type { Store, StoreResult } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./database.ts";
import { attempt } from "./errors.ts";
import { sqliteEventRepository } from "./events.ts";
import { migrate } from "./migrations.ts";
import { sqliteRepoRepository } from "./repos.ts";
import { sqliteSessionRepository } from "./sessions.ts";
import { sqliteUsageRepository } from "./usage.ts";
import { sqliteWorkspaceRepository } from "./workspaces.ts";

export interface SqliteStoreOptions {
  // H-05: caps the database at this many pages, so tests can make writes fail as on a full disk.
  readonly maxPageCount?: number;
}

// Opens (creating if needed) the database at `path` and brings its schema up to date. A damaged
// file is `store.corrupt`; `openRecoveringSqliteStore` moves such a file aside.
export function openSqliteStore(path: string, options: SqliteStoreOptions = {}): StoreResult<Store> {
  return attempt(() => {
    const db = openDatabase(path);
    const ready = prepare(db, options);
    if (!ready.ok) {
      db.close();
      return ready;
    }
    return ok({
      workspaces: sqliteWorkspaceRepository(db),
      repos: sqliteRepoRepository(db),
      sessions: sqliteSessionRepository(db),
      events: sqliteEventRepository(db),
      usage: sqliteUsageRepository(db),
      close: () => {
        db.close();
      },
    });
  });
}

function prepare(db: DatabaseSync, options: SqliteStoreOptions): StoreResult<number> {
  return attempt(() => {
    if (options.maxPageCount !== undefined) {
      db.exec(`PRAGMA max_page_count = ${String(options.maxPageCount)}`);
    }
    return migrate(db);
  });
}
