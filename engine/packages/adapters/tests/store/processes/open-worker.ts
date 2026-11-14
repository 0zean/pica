// Opens a store once told to. Usage: open-worker.ts <db>. Prints "ready", waits for a line on stdin
// so every worker opens together, then prints "opened" or exits 1 with the error on stderr.
import { createInterface } from "node:readline";
import { openSqliteStore } from "../../../src/store/index.ts";

const [dbPath = ""] = process.argv.slice(2);
process.stdout.write("ready\n");

const input = createInterface({ input: process.stdin });
await input[Symbol.asyncIterator]().next();
input.close();

const opened = openSqliteStore(dbPath);
if (!opened.ok) {
  process.stderr.write(`${opened.error.code}: ${opened.error.message}\n`);
  process.exit(1);
}
opened.value.close();
process.stdout.write("opened\n");
