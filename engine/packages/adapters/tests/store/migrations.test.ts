import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/store/database.ts";
import { latestSchemaVersion, migrate, migrations, schemaVersion } from "../../src/store/migrations.ts";
import { openSqliteStore } from "../../src/store/index.ts";
import { sampleRepo, sampleSession, sampleWorkspace, value, withTempDir } from "./helpers.ts";

const earlierVersions = migrations.map((migration) => migration.version).filter((v) => v < latestSchemaVersion);

function fixturePath(version: number): string {
  return join(import.meta.dirname, "fixtures", `schema-v${String(version)}.sql`);
}

function normalizedSchema(db: DatabaseSync): unknown[] {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
    .map((row) => ({
      ...row,
      sql: typeof row.sql === "string" ? row.sql.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1") : row.sql,
    }));
}

function databaseAtVersion(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  value(migrate(db, version));
  return db;
}

function healthy(db: DatabaseSync): void {
  expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

describe("store migrations", () => {
  let cleanup = (): void => undefined;
  afterEach(() => {
    cleanup();
  });

  it("number migrations 1, 2, … with no gaps", () => {
    expect(migrations.map((migration) => migration.version)).toEqual(
      migrations.map((_, index) => index + 1),
    );
  });

  it("apply from an empty database to the latest version", () => {
    const db = new DatabaseSync(":memory:");
    expect(value(migrate(db))).toBe(latestSchemaVersion);
    expect(schemaVersion(db)).toBe(latestSchemaVersion);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "repos",
      "session_events",
      "sessions",
      "usage_records",
      "workspace_pinned_repos",
      "workspaces",
    ]);
    healthy(db);
  });

  it("do nothing when the database is already current", () => {
    const db = databaseAtVersion(latestSchemaVersion);
    const before = normalizedSchema(db);
    expect(value(migrate(db))).toBe(latestSchemaVersion);
    expect(normalizedSchema(db)).toEqual(before);
  });

  it("refuse a database from a newer engine", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA user_version = ${String(latestSchemaVersion + 1)}`);
    const result = migrate(db);
    expect(result.ok ? undefined : result.error.code).toBe("store.schema_too_new");
  });

  it.each(earlierVersions)("have a fixture for schema version %i", (version) => {
    expect(existsSync(fixturePath(version))).toBe(true);
  });

  it.each(earlierVersions)("match fixture %i to the schema its migrations produce", (version) => {
    const fromFixture = new DatabaseSync(":memory:");
    fromFixture.exec(readFileSync(fixturePath(version), "utf8"));
    expect(schemaVersion(fromFixture)).toBe(version);
    expect(normalizedSchema(fromFixture)).toEqual(normalizedSchema(databaseAtVersion(version)));
  });

  it.each(earlierVersions)("upgrade fixture %i to the latest schema and keep its rows", (version) => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const path = join(temp.dir, "pica.db");
    const seeded = openDatabase(path);
    seeded.exec(readFileSync(fixturePath(version), "utf8"));
    seeded.close();

    const store = value(openSqliteStore(path));
    expect(value(store.repos.get(sampleRepo.id))).toEqual(sampleRepo);
    expect(value(store.workspaces.get(sampleWorkspace.id))).toEqual(sampleWorkspace);
    expect(value(store.sessions.get("session-1"))).toEqual(sampleSession("session-1"));
    expect(value(store.events.readAfter("session-1", 0)).map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(value(store.events.append("session-1", { type: "t", payload: null, timestamp: "t" })).seq).toBe(4);
    value(
      store.usage.record({
        sessionId: "session-1",
        agent: "main",
        model: "model-a",
        inputTokens: 10,
        cachedTokens: 0,
        outputTokens: 2,
        credits: 0.1,
        tier: "worker",
        timestamp: "2026-11-12T10:00:03.000Z",
      }),
    );
    expect(value(store.usage.listBySession("session-1")).map((record) => record.tier).at(-1)).toBe("worker");
    store.close();

    const upgraded = new DatabaseSync(path);
    expect(schemaVersion(upgraded)).toBe(latestSchemaVersion);
    expect(normalizedSchema(upgraded)).toEqual(normalizedSchema(databaseAtVersion(latestSchemaVersion)));
    healthy(upgraded);
    upgraded.close();
  });

  it("keep usage rows from schema 2 with an unknown tier", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(fixturePath(2), "utf8"));
    value(migrate(db));
    expect(db.prepare("SELECT agent, credits, tier FROM usage_records").all()).toEqual([
      { agent: "main", credits: 0.25, tier: null },
    ]);
  });
});
