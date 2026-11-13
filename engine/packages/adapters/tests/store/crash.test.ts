import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { latestSchemaVersion, schemaVersion } from "../../src/store/migrations.ts";
import { openSqliteStore } from "../../src/store/index.ts";
import { nextLine, seedStore, startNodeProcess, value, withTempDir } from "./helpers.ts";
import type { NodeProcess } from "./helpers.ts";

const sessionId = "session-1";
const committedBeforeCrash = 10;
const spilledWalBytes = 1024 * 1024;

function walBytes(path: string): number {
  return existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0;
}

async function killAfterLines(writer: NodeProcess, lines: number): Promise<string> {
  let last = "";
  for (let i = 0; i < lines; i += 1) {
    last = await nextLine(writer);
  }
  writer.child.kill("SIGKILL");
  const { signal } = await writer.exited;
  expect(signal).toBe("SIGKILL");
  return last;
}

function expectIntact(path: string): number[] {
  const store = value(openSqliteStore(path));
  const seqs = value(store.events.readAfter(sessionId, 0, 1_000_000)).map((event) => event.seq);
  expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  store.close();

  const db = new DatabaseSync(path);
  expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(schemaVersion(db)).toBe(latestSchemaVersion);
  db.close();
  return seqs;
}

describe("store after SIGKILL", () => {
  let cleanup = (): void => undefined;
  afterEach(() => {
    cleanup();
  });

  function seededPath(): string {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const path = join(temp.dir, "pica.db");
    const store = seedStore(path, [sessionId]);
    for (let i = 0; i < committedBeforeCrash; i += 1) {
      value(store.events.append(sessionId, { type: "t", payload: i, timestamp: "t" }));
    }
    store.close();
    return path;
  }

  // 1 row stays in the page cache; 5000 rows of 4 KB spill dirty pages into the WAL mid-transaction.
  it.each([
    { rows: 1, spills: false },
    { rows: 200, spills: false },
    { rows: 5000, spills: true },
  ])(
    "opens intact without the uncommitted rows when killed inside a transaction after $rows inserts",
    async ({ rows, spills }) => {
      const path = seededPath();
      const writer = startNodeProcess("crash-writer.ts", [path, "open-transaction", String(rows)]);
      expect(await killAfterLines(writer, 2)).toBe("in-transaction");
      if (spills) {
        expect(walBytes(path)).toBeGreaterThan(spilledWalBytes);
      }

      expect(expectIntact(path)).toHaveLength(committedBeforeCrash);
    },
    30_000,
  );

  it.each([1, 7, 50])(
    "opens intact with every acknowledged append when killed while committing (report every %i)",
    async (every) => {
      const path = seededPath();
      const writer = startNodeProcess("crash-writer.ts", [path, "committing", String(every)]);
      const last = await killAfterLines(writer, 20);
      const acknowledged = Number(last.replace("appended ", ""));
      expect(acknowledged).toBe(20 * every);

      expect(expectIntact(path).length).toBeGreaterThanOrEqual(committedBeforeCrash + acknowledged);
    },
    30_000,
  );
});
