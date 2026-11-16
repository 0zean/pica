import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceLine, invoiceTotal } from "../src/invoice.mjs";
import { fmtCents } from "../src/money.mjs";

test("invoiceTotal sums quantity times unit price", () => {
  assert.equal(invoiceTotal([{ quantity: 2, unitCents: 150 }, { quantity: 1, unitCents: 99 }]), 399);
});

test("invoiceLine formats the line amount", () => {
  assert.equal(invoiceLine({ description: "Widget", quantity: 3, unitCents: 250 }), `Widget: ${fmtCents(750)}`);
});
