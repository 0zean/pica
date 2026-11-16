import { addCents, fmtCents } from "./money.mjs";

export function invoiceTotal(lines) {
  let total = 0;
  for (const line of lines) {
    total = addCents(total, line.quantity * line.unitCents);
  }
  console.log(`invoice total ${fmtCents(total)}`);
  return total;
}

export function invoiceLine(line) {
  return `${line.description}: ${fmtCents(line.quantity * line.unitCents)}`;
}
