import { ok } from "@pica/core";
import type { StoreResult } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./database.ts";
import { attempt, fail } from "./errors.ts";
import { integer } from "./rows.ts";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

// Append only. A released migration is never edited; each earlier schema has a fixture in
// tests/store/fixtures that the migration tests upgrade from.
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "workspaces, repos, sessions, events",
    sql: `
      CREATE TABLE repos (
        id TEXT PRIMARY KEY,
        remote_url TEXT NOT NULL UNIQUE,
        local_path TEXT,
        managed INTEGER NOT NULL CHECK (managed IN (0, 1)),
        default_branch TEXT,
        clone_state TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sources TEXT NOT NULL,
        settings_overrides TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspace_pinned_repos (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        repo_id TEXT NOT NULL REFERENCES repos (id),
        position INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, repo_id)
      ) STRICT;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        state TEXT NOT NULL,
        write_roots TEXT NOT NULL,
        reference_roots TEXT NOT NULL,
        routing_profile TEXT NOT NULL,
        budget_max_credits REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sessions_by_workspace ON sessions (workspace_id);

      CREATE TABLE session_events (
        session_id TEXT NOT NULL REFERENCES sessions (id),
        seq INTEGER NOT NULL CHECK (seq > 0),
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    version: 2,
    name: "usage records",
    sql: `
      CREATE TABLE usage_records (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions (id),
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
        cached_tokens INTEGER NOT NULL CHECK (cached_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        credits REAL NOT NULL CHECK (credits >= 0),
        timestamp TEXT NOT NULL
      ) STRICT;

      CREATE INDEX usage_by_session ON usage_records (session_id, id);
    `,
  },
  {
    version: 3,
    name: "usage tier and time index",
    sql: `
      ALTER TABLE usage_records ADD COLUMN tier TEXT CHECK (tier IN ('reasoning', 'worker'));

      CREATE INDEX usage_by_time ON usage_records (julianday(timestamp));
    `,
  },
  {
    version: 4,
    name: "session titles and deletion",
    // A deleted session keeps its row (and so its usage records) with deleted_at set; its events go.
    sql: `
      ALTER TABLE sessions ADD COLUMN title TEXT;
      ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
    `,
  },
  {
    version: 5,
    name: "session model tiers",
    // JSON {reasoning?, worker?}: the session's own model per tier. NULL follows the config's routing.tiers.
    sql: `
      ALTER TABLE sessions ADD COLUMN model_tiers TEXT;
    `,
  },
];

export const latestSchemaVersion = migrations.length;

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  return row === undefined ? 0 : integer(row, "user_version");
}

// Each migration commits together with its version bump, so an interrupted upgrade resumes cleanly.
// The version is re-read inside the write lock because another connection may have migrated first.
export function migrate(db: DatabaseSync, targetVersion = latestSchemaVersion): StoreResult<number> {
  return attempt(() => {
    const current = schemaVersion(db);
    if (current > latestSchemaVersion) {
      return fail(
        "store.schema_too_new",
        `database schema version ${String(current)} is newer than this engine supports (${String(latestSchemaVersion)})`,
      );
    }
    for (const migration of migrations) {
      if (migration.version <= current || migration.version > targetVersion) {
        continue;
      }
      const applied = inTransaction(db, () => {
        if (schemaVersion(db) >= migration.version) {
          return ok(undefined);
        }
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${String(migration.version)}`);
        return ok(undefined);
      });
      if (!applied.ok) {
        return applied;
      }
    }
    return ok(schemaVersion(db));
  });
}
