import { ok } from "@pica/core";
import type { Store, StoreResult } from "@pica/core";
import { openDatabase } from "./database.ts";
import { attempt } from "./errors.ts";
import { sqliteEventRepository } from "./events.ts";
import { migrate } from "./migrations.ts";
import { sqliteRepoRepository } from "./repos.ts";
import { sqliteSessionRepository } from "./sessions.ts";
import { sqliteUsageRepository } from "./usage.ts";
import { sqliteWorkspaceRepository } from "./workspaces.ts";

// Opens (creating if needed) the database at `path` and brings its schema up to date.
export function openSqliteStore(path: string): StoreResult<Store> {
  return attempt(() => {
    const db = openDatabase(path);
    const migrated = migrate(db);
    if (!migrated.ok) {
      db.close();
      return migrated;
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
