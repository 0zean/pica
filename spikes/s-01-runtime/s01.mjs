// S-01 spike: runtime access and auth against the real Copilot runtime (PLAN.md §10, Phase 0).
// Usage: node spikes/s-01-runtime/s01.mjs models|prompt
//   models  signs in as the current user, lists models, price units and the session's default
//           model, saves them to docs/spikes/S-01-models.json and asserts that a model is usable:
//           models.list is non-empty, or a session without an explicit model has a default (D-16).
//           Token prices are recorded when present, not required.
//   prompt  sends one short prompt (the cheapest priced model, or the session default when no
//           model is listed), saves the event log to docs/spikes/S-01-events.json and asserts
//           session.idle and >= 1 assistant.usage.
// Exits 0 only when the chosen assertions hold. Needs a Copilot login; never run in CI.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// The SDK version pinned by the adapter (engine/packages/adapters/package.json), not a copy.
const sdkEntry = join(root, "engine/packages/adapters/node_modules/@github/copilot-sdk/dist/index.js");
const { CopilotClient } = await import(sdkEntry);

const mode = process.argv[2];
if (mode !== "models" && mode !== "prompt") {
  console.error("usage: s01.mjs models|prompt");
  process.exit(2);
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok" : "FAIL"}: ${message}`);
  if (!condition) failures += 1;
}

// Identity stays out of committed files, and long strings (system prompt, message snapshots)
// are cut so the saved logs stay readable.
let login;
const maxString = 400;
function redact(value) {
  let text = JSON.stringify(value, (_key, field) =>
    typeof field === "string" && field.length > maxString ? `${field.slice(0, maxString)}…(${field.length} chars)` : field,
  );
  if (login) text = text.split(login).join("<login>");
  return JSON.parse(text.split(homedir()).join("~").split(workdir).join("<workdir>"));
}

const client = new CopilotClient({});
const workdir = mkdtempSync(join(tmpdir(), "pica-s01-"));
try {
  await client.start();
  const auth = await client.getAuthStatus();
  login = auth.login;
  console.log(JSON.stringify({ auth: { ...redact(auth), login: auth.login ? "<login>" : undefined } }));
  if (!auth.isAuthenticated) {
    console.error(`FAIL: not signed in: ${auth.statusMessage ?? "(no status message)"}`);
    process.exit(1);
  }

  const models = await client.listModels();
  // The raw RPC result keeps fields listModels() drops, such as `auto` and `imageModels`.
  const rawModels = await client.rpc.models.list({});
  const units = await client.rpc.models.listTokenPriceUnits({});
  const quota = await client.rpc.account.getQuota({}).catch((error) => ({ error: String(error?.message ?? error) }));

  if (mode === "models") {
    const priced = models.filter((model) => model.billing?.tokenPrices !== undefined);
    const defaults = await sessionDefaults();
    writeFileSync(
      join(root, "docs/spikes/S-01-models.json"),
      JSON.stringify(
        redact({ sdk: "@github/copilot-sdk@1.0.28", authType: auth.authType, host: auth.host, rawModels, tokenPriceUnits: units, quota, sessionDefaults: defaults }),
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ models: summarize(models, units), defaultModel: defaults.current?.modelId, auto: rawModels.auto }));
    const defaultModel = defaults.current?.modelId;
    check(
      models.length > 0 || (typeof defaultModel === "string" && defaultModel !== ""),
      `a usable model: ${models.length} listed, session default "${defaultModel ?? ""}"`,
    );
    console.log(`info: ${priced.length} of ${models.length} listed models carry billing.tokenPrices`);
  } else {
    await prompt(cheapest(models, units));
  }
} finally {
  await client.stop().catch(() => undefined);
  rmSync(workdir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);

function unitOf(units, id) {
  return units.units.find((entry) => entry.modelId === id)?.unit;
}

function summarize(models, units) {
  return models.map((model) => ({
    id: model.id,
    policy: model.policy?.state,
    multiplier: model.billing?.multiplier,
    prices: model.billing?.tokenPrices,
    unit: unitOf(units, model.id),
  }));
}

// The cheapest enabled model with published prices, by input + output price per batch, or
// undefined when none publishes prices. The synthetic `auto` model is skipped: it routes to
// some other model.
function cheapest(models, units) {
  const candidates = models
    .filter((model) => model.policy?.state !== "disabled" && model.id !== "auto")
    .filter((model) => model.billing?.tokenPrices?.inputPrice !== undefined)
    .map((model) => {
      const prices = model.billing.tokenPrices;
      const perToken = ((prices.inputPrice ?? 0) + (prices.outputPrice ?? 0)) / (prices.batchSize || 1);
      return { id: model.id, perToken, unit: unitOf(units, model.id) };
    })
    .sort((a, b) => a.perToken - b.perToken);
  if (candidates.length === 0) return undefined;
  const units_ = new Set(candidates.map((candidate) => candidate.unit));
  if (units_.size > 1) console.log(`note: price units differ across models: ${[...units_].join(", ")}`);
  console.log(`cheapest: ${candidates[0].id} (${candidates[0].perToken} ${candidates[0].unit ?? "?"} per in+out token)`);
  return candidates[0].id;
}

// What a session gets when the host names no model: the plan-agnostic path (D-16).
async function sessionDefaults() {
  const session = await client.createSession({
    workingDirectory: workdir,
    onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }),
  });
  try {
    const list = await session.rpc.model.list({}).catch((error) => ({ error: String(error?.message ?? error) }));
    const current = await session.rpc.model.getCurrent().catch((error) => ({ error: String(error?.message ?? error) }));
    return { current, list };
  } finally {
    await session.disconnect().catch(() => undefined);
  }
}

async function prompt(model) {
  const events = [];
  if (model === undefined) console.log("no priced model listed: prompting with the session default");
  const session = await client.createSession({
    ...(model === undefined ? {} : { model }),
    workingDirectory: workdir,
    streaming: true,
    onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }),
    onEvent: (event) => events.push(event),
  });
  const before = await session.rpc.model.getCurrent().catch((error) => ({ error: String(error?.message ?? error) }));
  const idle = new Promise((resolve) => session.on("session.idle", resolve));
  await session.send({ prompt: "Reply with the single word: ok" });
  const reached = await Promise.race([idle.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 120_000))]);
  const after = await session.rpc.model.getCurrent().catch((error) => ({ error: String(error?.message ?? error) }));
  const metrics = await session.rpc.usage.getMetrics().catch((error) => ({ error: String(error?.message ?? error) }));
  await session.disconnect().catch(() => undefined);

  writeFileSync(join(root, "docs/spikes/S-01-events.json"), JSON.stringify(redact({ requestedModel: model ?? null, currentModel: { before, after }, events, metrics }), null, 2) + "\n");
  const usage = events.filter((event) => event.type === "assistant.usage");
  const errors = events.filter((event) => event.type === "session.error");
  console.log(JSON.stringify({ types: events.map((event) => event.type), usage: usage.map((event) => event.data), errors: errors.map((event) => event.data), before, after }));
  check(reached && events.some((event) => event.type === "session.idle"), "prompt reached session.idle");
  check(usage.length > 0, `${usage.length} assistant.usage event(s)`);
}
