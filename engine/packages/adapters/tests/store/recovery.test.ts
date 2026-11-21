import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeCorruptDatabase } from "@pica/testkit";
import type { CorruptionKind } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { latestSchemaVersion } from "../../src/store/migrations.ts";
import { openRecoveringSqliteStore, openSqliteStore } from "../../src/store/index.ts";
import { sampleWorkspace, seedStore, value, withTempDir } from "./helpers.ts";

const now = new Date("2026-11-21T10:15:00.123Z");
const options = { now: () => now };

let cleanup = (): void => undefined;
afterEach(() => {
  cleanup();
});

function tempPath(): string {
  const temp = withTempDir();
  cleanup = temp.cleanup;
  return join(temp.dir, "pica.db");
}

describe("H-05 corrupt database recovery", () => {
  it.each<CorruptionKind>(["not-a-database", "damaged-pages", "truncated"])(
    "moves a %s file aside, starts with an empty database and reports the backup path",
    (kind) => {
      const path = tempPath();
      writeCorruptDatabase(path, kind);
      const damaged = readFileSync(path);
      expect(openSqliteStore(path)).toMatchObject({ ok: false, error: { code: "store.corrupt" } });

      const { store, recovery } = value(openRecoveringSqliteStore(path, options));
      expect(recovery).toEqual({
        backupPath: `${path}.corrupt-20261121T101500Z`,
        reason: expect.any(String) as string,
        at: now.toISOString(),
      });
      expect(readFileSync(recovery?.backupPath ?? "")).toEqual(damaged);
      expect(value(store.workspaces.list())).toEqual([]);
      store.close();

      const db = new DatabaseSync(path);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: latestSchemaVersion });
      db.close();
    },
  );

  // SQLite may checkpoint or delete a damaged database's WAL when it closes the connection that
  // found the damage; whatever is left moves with the database, and none of it reaches the new one.
  it("keeps the damaged database's WAL and shared-memory files away from the new database", () => {
    const path = tempPath();
    writeCorruptDatabase(path, "not-a-database");
    writeFileSync(`${path}-wal`, "stale wal");
    writeFileSync(`${path}-shm`, "stale shm");

    const { store, recovery } = value(openRecoveringSqliteStore(path, options));
    const workspace = { ...sampleWorkspace, pinnedRepoIds: [] };
    value(store.workspaces.save(workspace));
    store.close();
    for (const suffix of ["-wal", "-shm"]) {
      const left = `${path}${suffix}`;
      expect(existsSync(left) ? readFileSync(left, "utf8") : "").not.toMatch(/^stale/);
      const moved = `${recovery?.backupPath ?? ""}${suffix}`;
      if (existsSync(moved)) {
        expect(readFileSync(moved, "utf8")).toMatch(/^stale/);
      }
    }
    const reopened = value(openSqliteStore(path));
    expect(value(reopened.workspaces.list())).toEqual([workspace]);
    reopened.close();
  });

  it("picks a new backup name when one from the same second exists", () => {
    const path = tempPath();
    writeCorruptDatabase(path, "not-a-database");
    value(openRecoveringSqliteStore(path, options)).store.close();
    writeCorruptDatabase(path, "not-a-database");

    const { store, recovery } = value(openRecoveringSqliteStore(path, options));
    store.close();
    expect(recovery?.backupPath).toBe(`${path}.corrupt-20261121T101500Z-2`);
    expect(existsSync(`${path}.corrupt-20261121T101500Z`)).toBe(true);
  });

  it("opens a healthy database as it is", () => {
    const path = tempPath();
    seedStore(path, ["session-1"]).close();

    const { store, recovery } = value(openRecoveringSqliteStore(path, options));
    expect(recovery).toBeNull();
    expect(value(store.sessions.get("session-1")).id).toBe("session-1");
    store.close();
  });

  it("does not move aside a database whose schema is newer than the engine", () => {
    const path = tempPath();
    seedStore(path, []).close();
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA user_version = ${String(latestSchemaVersion + 1)}`);
    db.close();

    expect(openRecoveringSqliteStore(path, options)).toMatchObject({ ok: false, error: { code: "store.schema_too_new" } });
    expect(existsSync(`${path}.corrupt-20261121T101500Z`)).toBe(false);
  });
});
