// Writes to the store until it is killed. Usage: crash-writer.ts <db> <mode> <count>
//   open-transaction: inserts events inside one transaction that never commits, printing
//     "in-transaction" after every <count>.
//   committing: appends events one commit at a time, printing "appended <n>" after every <count>.
import { openDatabase } from "../../../src/store/database.ts";
import { openSqliteStore } from "../../../src/store/index.ts";

const [dbPath = "", mode = "", countText = "1"] = process.argv.slice(2);
const count = Number(countText);
const sessionId = "session-1";
const bulky = "x".repeat(4096);

const opened = openSqliteStore(dbPath);
if (!opened.ok) {
  process.stderr.write(`${opened.error.code}: ${opened.error.message}\n`);
  process.exit(1);
}
const store = opened.value;

if (mode === "open-transaction") {
  const db = openDatabase(dbPath);
  const insert = db.prepare(
    "INSERT INTO session_events (session_id, seq, type, payload, timestamp) VALUES (?, ?, ?, ?, ?)",
  );
  const committed = store.events.lastSeq(sessionId);
  const first = (committed.ok ? committed.value : 0) + 1;
  db.exec("BEGIN IMMEDIATE");
  for (let inserted = 1, seq = first; ; inserted += 1, seq += 1) {
    insert.run(sessionId, seq, "test.uncommitted", JSON.stringify(bulky), "2026-11-12T10:00:00.000Z");
    if (inserted % count === 0) {
      process.stdout.write("in-transaction\n");
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

if (mode === "committing") {
  for (let appended = 1; ; appended += 1) {
    const result = store.events.append(sessionId, {
      type: "test.committed",
      payload: bulky,
      timestamp: "2026-11-12T10:00:00.000Z",
    });
    if (!result.ok) {
      process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
      process.exit(1);
    }
    if (appended % count === 0) {
      process.stdout.write(`appended ${String(appended)}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

process.stderr.write(`unknown mode ${mode}\n`);
process.exit(2);
