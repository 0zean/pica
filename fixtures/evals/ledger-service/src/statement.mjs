import { fmtCents } from "./money.mjs";

export function renderStatement(entries) {
  console.log(`rendering ${entries.length} entries`);
  const rows = entries.map((entry) => `${entry.date}  ${entry.memo.padEnd(24)} ${fmtCents(entry.cents)}`);
  console.log("statement rendered");
  return rows.join("\n");
}
