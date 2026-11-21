import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// H-05 fixtures: database files the engine must refuse to use as they are.
export type CorruptionKind =
  // Not a SQLite file at all: SQLITE_NOTADB on the first statement.
  | "not-a-database"
  // A valid header with damaged table pages: SQLITE_CORRUPT, or rows from the integrity check.
  | "damaged-pages"
  // The file cut off mid-table: the header names pages the file no longer holds.
  | "truncated";

const pageSize = 4096;

// Writes a damaged database to `path`. The damaged-pages and truncated kinds start from a
// database holding one table of 2,000 rows, so the damage is past the schema page.
export function writeCorruptDatabase(path: string, kind: CorruptionKind): void {
  if (kind === "not-a-database") {
    writeFileSync(path, Buffer.alloc(pageSize * 2, 0x07));
    return;
  }
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA page_size = ${String(pageSize)}; PRAGMA journal_mode = DELETE; CREATE TABLE filler (text TEXT NOT NULL);`);
  const insert = db.prepare("INSERT INTO filler (text) VALUES (?)");
  for (let row = 0; row < 2000; row += 1) {
    insert.run(`${"x".repeat(200)}${String(row)}`);
  }
  db.close();
  const bytes = readFileSync(path);
  if (kind === "truncated") {
    writeFileSync(path, bytes.subarray(0, pageSize * 4));
    return;
  }
  bytes.fill(0xab, pageSize * 3, pageSize * 6);
  writeFileSync(path, bytes);
}
