// Appends events to the store from its own connection. Usage: append-worker.ts <db> <worker> <plan>
// where <plan> is a JSON array of session IDs, one append each, in order. Prints "ready", waits for
// a line on stdin so every worker starts together, then prints the assigned seqs as JSON.
import { createInterface } from "node:readline";
import { openSqliteStore } from "../../../src/store/index.ts";

const [dbPath = "", worker = "", planJson = "[]"] = process.argv.slice(2);
const plan = JSON.parse(planJson) as string[];

const opened = openSqliteStore(dbPath);
if (!opened.ok) {
  process.stderr.write(`${opened.error.code}: ${opened.error.message}\n`);
  process.exit(1);
}
const store = opened.value;
process.stdout.write("ready\n");

const input = createInterface({ input: process.stdin });
await input[Symbol.asyncIterator]().next();
input.close();

const appended: { sessionId: string; seq: number; index: number }[] = [];
for (const [index, sessionId] of plan.entries()) {
  const result = store.events.append(sessionId, {
    type: "test.appended",
    payload: { worker, index },
    timestamp: "2026-11-12T10:00:00.000Z",
  });
  if (!result.ok) {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    process.exit(1);
  }
  appended.push({ sessionId, seq: result.value.seq, index });
}
store.close();
process.stdout.write(`${JSON.stringify(appended)}\n`);
