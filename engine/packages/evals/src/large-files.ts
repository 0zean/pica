// The large files in the fixture repos, generated rather than committed so the needle each question
// looks for is visible here. Every file is well over the read gate's `minBytes` (PLAN.md §4.6), so
// under `balanced` the main agent cannot read it whole.

export const schemaNeedle = { table: "payout_reconciliations", column: "settlement_batch_ref" } as const;
export const logNeedle = { requestId: "req-9c41e07d" } as const;
export const errorCodeNeedle = { name: "LEDGER_FROZEN", code: 47213 } as const;

const nouns = [
  "account", "ledger", "payout", "invoice", "merchant", "refund", "transfer", "statement",
  "balance", "fee", "dispute", "settlement", "card", "customer", "journal", "batch",
];
const qualifiers = [
  "events", "snapshots", "holds", "lines", "audits", "limits", "rates", "notes", "links", "versions",
  "batches", "flags", "reviews", "exports", "imports", "schedules", "alerts", "locks", "quotas", "tags",
  "drafts", "archives", "comments", "tokens", "windows",
];

// A fixed linear congruential sequence, so every generated file is byte-for-byte reproducible.
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

export function schemaSql(): string {
  const next = sequence(7);
  const tables: string[] = [];
  for (const noun of nouns) {
    for (const qualifier of qualifiers) {
      const name = `${noun}_${qualifier}`;
      const columns = ["  id bigint PRIMARY KEY", "  created_at timestamptz NOT NULL DEFAULT now()"];
      for (let index = 0; index < 8; index += 1) {
        const other = nouns[next() % nouns.length] ?? "account";
        columns.push(`  ${other}_${String(index)}_id bigint REFERENCES ${other}_events (id)`);
      }
      columns.push("  settlement_batch_id bigint");
      tables.push(`CREATE TABLE ${name} (\n${columns.join(",\n")}\n);\n`);
    }
  }
  const needle = [
    "  id bigint PRIMARY KEY",
    "  payout_events_id bigint REFERENCES payout_events (id)",
    `  ${schemaNeedle.column} text NOT NULL`,
    "  reconciled_at timestamptz",
  ];
  tables.splice(97, 0, `CREATE TABLE ${schemaNeedle.table} (\n${needle.join(",\n")}\n);\n`);
  return `-- ledger-service schema. Generated; do not edit.\n\n${tables.join("\n")}`;
}

export function settlementLog(): string {
  const next = sequence(11);
  const lines: string[] = [];
  const start = Date.UTC(2026, 10, 14, 2, 0, 0);
  for (let index = 0; index < 4000; index += 1) {
    const at = new Date(start + index * 1370).toISOString();
    const request = `req-${(next() % 0xffffffff).toString(16).padStart(8, "0")}`;
    const merchant = `m-${String(1000 + (next() % 9000))}`;
    const amount = String(next() % 250000);
    const level = index % 97 === 13 ? "WARN " : "INFO ";
    const status = level === "WARN " ? "retrying" : "settled";
    lines.push(`${at} ${level} settlement batch=B-0412 request=${request} merchant=${merchant} amount_cents=${amount} status=${status}`);
  }
  lines[2933] =
    `${new Date(start + 2933 * 1370).toISOString()} ERROR settlement batch=B-0412 request=${logNeedle.requestId} ` +
    "merchant=m-4471 amount_cents=99120 status=failed reason=ledger_frozen";
  return `${lines.join("\n")}\n`;
}

export function errorCodesModule(): string {
  const entries: string[] = [];
  let index = 0;
  for (const noun of nouns) {
    for (const qualifier of qualifiers) {
      for (const suffix of ["MISSING", "INVALID", "EXPIRED", "LOCKED", "DUPLICATE", "OVER_LIMIT", "STALE", "REVOKED", "PENDING", "UNSUPPORTED"]) {
        entries.push(`  ${noun.toUpperCase()}_${qualifier.toUpperCase()}_${suffix}: ${String(10000 + index * 7)},`);
        index += 1;
      }
    }
  }
  entries.splice(613, 0, `  ${errorCodeNeedle.name}: ${String(errorCodeNeedle.code)},`);
  return `// Generated from the error catalog; do not edit.\nexport const ERROR_CODES = Object.freeze({\n${entries.join("\n")}\n});\n`;
}
