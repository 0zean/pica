// Generated source and docs that make the fixture repos big enough for delegation to pay for its
// extra main-agent turns (docs/evals/README.md, "Sizing"). Each generator is deterministic.

const domains = [
  "accounts", "balances", "batches", "cards", "customers", "disputes", "fees", "holds",
  "invoices", "journals", "ledgers", "limits", "merchants", "notes", "payouts", "rates",
  "refunds", "reserves", "returns", "reviews", "schedules", "settlements", "statements", "taxes",
  "terminals", "tokens", "transfers", "vaults", "versions", "wallets", "webhooks", "withdrawals",
];

const owners = ["platform", "identity", "payments", "messaging", "discovery", "risk", "growth", "data"];

function title(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

// One report module per domain in ledger-service: each formats amounts with `fmtCents` and logs with
// `console.log`, so the rename and logger tasks touch every one of them.
export function ledgerReports(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [index, domain] of domains.entries()) {
    const name = title(domain);
    const lines = [
      'import { fmtCents } from "../money.mjs";',
      "",
      `// Daily ${domain} report. Amounts are integer cents.`,
      `export function ${domain}Summary(rows) {`,
      "  let total = 0;",
      "  for (const row of rows) {",
      "    total += row.cents;",
      "  }",
      `  console.log(\`${domain}: \${rows.length} rows, \${fmtCents(total)}\`);`,
      "  return total;",
      "}",
      "",
      `export function ${domain}Lines(rows) {`,
      `  return rows.map((row) => \`\${row.id.padEnd(12)} \${row.memo.padEnd(32)} \${fmtCents(row.cents)}\`);`,
      "}",
      "",
      `export function ${domain}Largest(rows, count = ${String(3 + (index % 5))}) {`,
      "  const sorted = [...rows].sort((a, b) => b.cents - a.cents);",
      "  const top = sorted.slice(0, count);",
      `  console.log(\`largest ${domain}: \${top.map((row) => fmtCents(row.cents)).join(", ")}\`);`,
      "  return top;",
      "}",
      "",
      `export function ${domain}ByDay(rows) {`,
      "  const days = new Map();",
      "  for (const row of rows) {",
      "    const day = row.at.slice(0, 10);",
      "    days.set(day, (days.get(day) ?? 0) + row.cents);",
      "  }",
      "  return [...days.entries()].map(([day, cents]) => `${day} ${fmtCents(cents)}`);",
      "}",
      "",
      `export function ${domain}Thresholds(rows, limitCents) {`,
      "  const over = rows.filter((row) => row.cents > limitCents);",
      "  if (over.length > 0) {",
      `    console.log(\`${domain} over \${fmtCents(limitCents)}: \${over.length}\`);`,
      "  }",
      "  return over.map((row) => ({ id: row.id, amount: fmtCents(row.cents), excess: fmtCents(row.cents - limitCents) }));",
      "}",
      "",
      `export const ${domain}Columns = [`,
      ...Array.from({ length: 24 }, (_, column) => `  { key: "${domain}_${String(column)}", label: "${name} column ${String(column)}", width: ${String(8 + (column % 6) * 2)} },`),
      "];",
      "",
    ];
    files[`src/reports/${domain}.mjs`] = lines.join("\n");
  }
  return files;
}

// Helpers appended to `src/money.mjs`, so the file under test is too large to read whole under
// `balanced`. None of them names `fmtCents` or calls `console.log`.
export function moneyAppendix(): string {
  const currencies = ["usd", "eur", "gbp", "jpy", "chf", "cad", "aud", "nzd", "sek", "nok", "dkk", "pln", "czk", "huf", "mxn", "brl", "inr", "sgd", "hkd", "krw"];
  const blocks = currencies.flatMap((currency, index) => {
    const upper = currency.toUpperCase();
    const minor = currency === "jpy" || currency === "krw" ? 0 : 2;
    return [
      "",
      `export const ${currency}Rules = Object.freeze({ code: "${upper}", minorUnits: ${String(minor)}, roundingStep: ${String(1 + (index % 5))} });`,
      "",
      `export function roundTo${upper}(cents) {`,
      `  const step = ${currency}Rules.roundingStep;`,
      "  return Math.round(cents / step) * step;",
      "}",
      "",
      `export function split${upper}(cents, parts) {`,
      "  const base = Math.floor(cents / parts);",
      "  const remainder = cents - base * parts;",
      "  return Array.from({ length: parts }, (_, part) => base + (part < remainder ? 1 : 0));",
      "}",
      "",
      `export function allocate${upper}(cents, weights) {`,
      "  const total = weights.reduce((sum, weight) => sum + weight, 0);",
      "  const shares = weights.map((weight) => Math.floor((cents * weight) / total));",
      "  let left = cents - shares.reduce((sum, share) => sum + share, 0);",
      "  for (let index = 0; left > 0; index = (index + 1) % shares.length, left -= 1) {",
      "    shares[index] += 1;",
      "  }",
      "  return shares;",
      "}",
      "",
      `export const ${currency}Denominations = [`,
      ...Array.from({ length: 80 }, (_, step) => `  { name: "${upper}-${String(step)}", cents: ${String((step + 1) * (index + 3) * 25)}, coin: ${step < 12 ? "true" : "false"} },`),
      "];",
    ];
  });
  return `${blocks.join("\n")}\n`;
}

// Helpers appended to a web-toolkit module, so it is too large to read whole under `balanced`.
export function toolkitAppendix(prefix: string, count: number): string {
  const blocks = Array.from({ length: count }, (_, index) => [
    "",
    `export function ${prefix}Variant${String(index)}(input, options = {}) {`,
    `  const separator = options.separator ?? "${index % 2 === 0 ? "-" : "_"}";`,
    "  const parts = String(input)",
    "    .split(/\\s+/)",
    "    .filter((part) => part.length > 0)",
    `    .map((part) => part.slice(0, ${String(8 + (index % 7))}));`,
    `  return parts.join(separator).padEnd(${String(index % 9)}, separator);`,
    "}",
    "",
    `export const ${prefix}Variant${String(index)}Defaults = Object.freeze({ maxLength: ${String(40 + index)}, keepCase: ${index % 3 === 0 ? "true" : "false"} });`,
  ].join("\n"));
  return `${blocks.join("\n")}\n`;
}

// One small module per domain in web-toolkit, for the license-header task to cover many files.
export function toolkitModules(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [index, domain] of domains.entries()) {
    const lines = [
      `export function ${domain}Path(id) {`,
      `  return \`/${domain}/\${encodeURIComponent(id)}\`;`,
      "}",
      "",
      `export function ${domain}Query(filters) {`,
      "  const params = new URLSearchParams();",
      "  for (const [key, value] of Object.entries(filters)) {",
      "    if (value !== undefined) {",
      "      params.set(key, String(value));",
      "    }",
      "  }",
      "  return params.toString();",
      "}",
      "",
      `export function ${domain}Headers(token) {`,
      "  return {",
      '    "content-type": "application/json",',
      "    authorization: `Bearer ${token}`,",
      `    "x-${domain}-version": "${String(1 + (index % 4))}",`,
      "  };",
      "}",
      "",
      `export const ${domain}Fields = [`,
      ...Array.from({ length: 16 }, (_, field) => `  "${domain}_field_${String(field)}",`),
      "];",
      "",
    ];
    files[`src/${domain}.mjs`] = lines.join("\n");
  }
  return files;
}

// The service directory: a table of every service and its port, then a section per service. The
// ports task needs every row, so the whole table has to be read.
export function servicePorts(): Record<string, number> {
  const ports: Record<string, number> = { gateway: 8080 };
  for (const [index, domain] of domains.entries()) {
    ports[`${domain}-api`] = 8100 + index;
    ports[`${domain}-worker`] = 8300 + index;
  }
  return ports;
}

export function servicesDoc(): string {
  const ports = servicePorts();
  const rows = Object.entries(ports).map(([service, port], index) => `| ${service.padEnd(20)} | ${String(port)} | ${(owners[index % owners.length] ?? "platform").padEnd(9)} |`);
  const sections = Object.keys(ports).map((service, index) =>
    [
      `### ${service}`,
      "",
      `Owned by the ${owners[index % owners.length] ?? "platform"} team. It reads its settings from \`config/${service}.json\` and`,
      "writes structured logs to standard output. Deploys go out with the weekly train unless the owning",
      "team marks a change as urgent, in which case the on-call engineer ships it after review. The",
      "service exposes `/healthz` and `/readyz`; both answer on the same listener as its API.",
      "",
      "Runbook: when the service is degraded, check its dashboard first, then its upstream dependencies,",
      "then the most recent deploy. Roll back before debugging if the error rate is above the alert",
      "threshold for more than ten minutes. Escalate to the owning team's secondary after thirty minutes.",
      "Capacity reviews happen every quarter; the owning team files the forecast with the platform team",
      "two weeks before the review, including expected traffic growth and any planned migrations.",
      "",
      "Data handling: the service keeps request logs for fourteen days and audit records for a year.",
      "Personal data is never written to logs; identifiers are hashed before they leave the process.",
      "Backups are taken nightly and restored into staging every month to prove they work.",
      "",
      `Dependencies: ${Object.keys(ports).filter((_, other) => other !== index && (other + index) % 9 === 0).slice(0, 4).join(", ") || "none"}.`,
      "",
    ].join("\n"),
  );
  return [
    "# Services",
    "",
    "Every web service and the port it listens on in local development.",
    "",
    "| Service              | Port | Owner     |",
    "|----------------------|------|-----------|",
    ...rows,
    "",
    "The admin console runs inside `gateway` and has no port of its own.",
    "",
    "## Service notes",
    "",
    ...sections,
  ].join("\n");
}
