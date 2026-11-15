// S-03 spike: per-agent model and usage attribution against the real Copilot runtime (PLAN.md §10, Phase 0).
// Run with: node --experimental-strip-types --disable-warning=ExperimentalWarning spikes/s-03-attribution/s03.mjs <mode>
//   probe-limit  no prompt: tries sessionLimits.maxAiCredits 0.01, 1, 29.99 and 30 at session.create and
//                records which the runtime accepts. Saved to docs/spikes/S-03-probe-limit.json.
//   attribution  one delegating trial (S-02's fixture and deny hook) whose bulk-reader names a concrete
//                `model` (WORKER_MODEL, default claude-haiku-4.5). Saved to docs/spikes/S-03-attribution.json,
//                with every event run through Pica's adapter mapping and normalizer. Asserts check 1: the
//                configured, started and billed models are recorded; they are equal when models.list offers
//                more than `auto`, and the override is ignored when it offers only `auto`.
//                MODEL_POLICY=required records the same trial with modelPolicy "required" (not asserted).
//   agents       offline, from S-03-attribution.json (check 2): every assistant.usage belongs to exactly one
//                agent by envelope agentId, Pica names the same agent, and getMetrics.agentMetrics agrees.
//   credits      offline, from S-03-attribution.json (check 4): Σ assistant.usage cost equals getMetrics
//                within 1%.
//   limit        check 3: records the runtime's maxAiCredits floor (no prompt), then runs one delegating
//                trial with the runtime cap at that floor and C-09's SessionBudget fed from each
//                assistant.usage; main-agent crossings are approved, the first sub-agent crossing aborts.
//                Saved to docs/spikes/S-03-limit.json.
//   resolved     offline (check 5): A4 and A5 are resolved in PLAN.md with the plan they were tested on.
// Live modes need a Copilot login and are never run in CI. Saved files are redacted (login, paths, tokens).
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const docs = join(root, "docs/spikes");
const attributionFile = join(docs, "S-03-attribution.json");
const fixtureName = "services-registry.txt";
const limitBytes = 32 * 1024;
const nano = 1e9;
// Unredacted-path-free raw dumps, outside the repository.
const scratch = process.env.S03_RAW_DIR ?? tmpdir();

const modes = ["probe-limit", "attribution", "agents", "credits", "limit", "resolved"];
const mode = process.argv[2];
if (!modes.includes(mode)) {
  console.error(`usage: s03.mjs ${modes.join("|")}`);
  process.exit(2);
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok" : "FAIL"}: ${message}`);
  if (!condition) failures += 1;
}

// Pica's own code, imported from source so the spike compares against what ships.
const { toRuntimeEvent } = await import(join(root, "engine/packages/adapters/src/copilot/events.ts"));
const { normalizeRuntimeEvent, initialNormalizerState } = await import(join(root, "engine/packages/core/src/events/normalize.ts"));
const { createSessionBudget } = await import(join(root, "engine/packages/core/src/sessions/budget.ts"));

if (mode === "agents" || mode === "credits") {
  const saved = JSON.parse(readFileSync(attributionFile, "utf8"));
  if (mode === "agents") checkAgents(saved);
  else checkCredits(saved);
  process.exit(failures === 0 ? 0 : 1);
}
if (mode === "resolved") {
  const plan = readFileSync(join(root, "PLAN.md"), "utf8");
  const row = (id) => plan.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? "";
  for (const id of ["A4", "A5"]) {
    const text = row(id);
    check(/\*\*(Confirmed|Not confirmed|Partly confirmed)\b/.test(text), `${id} is marked resolved`);
    check(/Copilot (Free|Pro|Pro\+|Business|Enterprise)/.test(text), `${id} names the plan it was tested on`);
  }
  check(existsSync(join(docs, "S-03.md")), "docs/spikes/S-03.md exists");
  process.exit(failures === 0 ? 0 : 1);
}

const sdkEntry = join(root, "engine/packages/adapters/node_modules/@github/copilot-sdk/dist/index.js");
const { CopilotClient } = await import(sdkEntry);

let login;
const workdirs = [];
const maxString = 600;
// Paths and the login are replaced before long strings are cut, so a cut never leaves a partial path.
function redact(value) {
  let text = JSON.stringify(value);
  if (login) text = text.split(login).join("<login>");
  for (const dir of workdirs) text = text.split(dir).join("<workdir>");
  text = text.split("/private<workdir>").join("<workdir>");
  text = text.replace(/gh[opsu]_[A-Za-z0-9]{20,}/g, "<token>").replace(/github_pat_[A-Za-z0-9_]{20,}/g, "<token>");
  text = text.split(homedir()).join("~");
  return JSON.parse(text, (_key, field) =>
    typeof field === "string" && field.length > maxString ? `${field.slice(0, maxString)}…(${field.length} chars)` : field,
  );
}

const client = new CopilotClient({});
try {
  await client.start();
  const auth = await client.getAuthStatus();
  login = auth.login;
  console.log(JSON.stringify({ authType: auth.authType, isAuthenticated: auth.isAuthenticated }));
  if (!auth.isAuthenticated) {
    console.error(`FAIL: not signed in: ${auth.statusMessage ?? "(no status message)"}`);
    process.exit(1);
  }
  const models = await client.rpc.models.list({}).catch((error) => ({ error: String(error?.message ?? error) }));
  const offered = (models.models ?? []).map((model) => model.id);
  console.log(`models.list: ${offered.join(", ") || "(none)"}`);
  if (mode === "probe-limit") await probeLimit(offered);
  else if (mode === "attribution") await attribution(offered);
  else await limit(offered);
} finally {
  await client.stop().catch(() => undefined);
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);

function stopOnRefusal(events, sendError) {
  const refusal = sendError ?? events.find((event) => event.type === "session.error")?.data?.message;
  if (refusal && /quota|rate|limit|402|429|exceed/i.test(refusal)) {
    console.error(`STOP: the runtime refused a call: ${refusal}`);
    process.exit(1);
  }
}

// Session creation sends no prompt, so trying limits costs nothing.
async function limitFloor() {
  const tried = [];
  for (const maxAiCredits of [0.01, 1, 29.99, 30]) {
    const dir = mkdtempSync(join(tmpdir(), "pica-s03-"));
    workdirs.push(dir);
    try {
      const session = await client.createSession({ workingDirectory: dir, sessionLimits: { maxAiCredits }, onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }) });
      await session.disconnect().catch(() => undefined);
      tried.push({ maxAiCredits, accepted: true });
    } catch (error) {
      tried.push({ maxAiCredits, accepted: false, error: String(error?.message ?? error) });
    }
  }
  return tried;
}

async function probeLimit(offered) {
  const tried = await limitFloor();
  writeFileSync(join(docs, "S-03-probe-limit.json"), JSON.stringify(redact({ offered, tried }), null, 2) + "\n");
  console.log(JSON.stringify(redact(tried), null, 1));
  check(tried.some((entry) => entry.accepted), "some maxAiCredits value is accepted at session.create");
}

async function sendAndWait(session, prompt, timeoutMs = 240_000) {
  const idle = new Promise((done) => session.on("session.idle", done));
  let sendError;
  await session.send({ prompt }).catch((error) => (sendError = String(error?.message ?? error)));
  if (!sendError) {
    const reached = await Promise.race([idle.then(() => true), new Promise((done) => setTimeout(() => done(false), timeoutMs))]);
    if (!reached) sendError = `no session.idle within ${timeoutMs / 1000} s`;
  }
  return sendError;
}

function usageOf(events) {
  return events
    .filter((event) => event.type === "assistant.usage")
    .map((event) => ({
      eventId: event.id,
      agentId: event.agentId ?? null,
      model: event.data.model,
      isAuto: event.data.isAuto,
      inputTokens: event.data.inputTokens,
      outputTokens: event.data.outputTokens,
      cacheReadTokens: event.data.cacheReadTokens,
      cacheWriteTokens: event.data.cacheWriteTokens,
      nanoAiu: event.data.copilotUsage?.totalNanoAiu ?? null,
      aiCreditsStatus: event.data.aiCreditsStatus ?? null,
      parentToolCallId: event.data.parentToolCallId ?? null,
      initiator: event.data.initiator ?? null,
    }));
}

// ~220 KB of service records with one answer line, as in S-02.
function makeFixture(dir) {
  const services = ["kestrel", "osprey", "heron", "plover", "linnet", "wren", "shrike", "tern", "dunlin", "merlin"];
  const suffixes = ["ledger", "gateway", "indexer", "relay", "vault", "mailer", "scheduler", "billing", "audit", "search"];
  const target = "kestrel-ledger-prod-77";
  const answer = randomInt(100, 999);
  const lines = ["# Service registry export. One record per line: name | owner | region | retention_days | tier | notes"];
  const at = randomInt(800, 1600);
  for (let i = 0; i < 2300; i += 1) {
    if (i === at) {
      lines.push(`${target} | team-ledger | eu-west-2 | ${answer} | gold | canonical ledger record, do not purge early`);
      continue;
    }
    const name = `${services[i % 10]}-${suffixes[(i * 7) % 10]}-${["prod", "stage", "dev"][i % 3]}-${i}`;
    lines.push(`${name} | team-${suffixes[(i * 3) % 10]} | ${["us-east-1", "eu-west-2", "ap-south-1"][i % 3]} | ${30 + ((i * 13) % 400)} | ${["gold", "silver", "bronze"][i % 3]} | record ${i} checksum ${(i * 2654435761) % 4294967296}`);
  }
  const text = lines.join("\n") + "\n";
  writeFileSync(join(dir, fixtureName), text);
  return { bytes: Buffer.byteLength(text), answer: String(answer), target };
}

function sizeOf(path, cwd) {
  try {
    const stat = statSync(isAbsolute(path) ? path : join(cwd, path));
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

// One S-02 trial: the main agent's reads of the fixture are denied and it delegates to bulk-reader.
async function delegatingTrial({ workerModel, modelPolicy, sessionLimits, onUsage }) {
  const dir = mkdtempSync(join(tmpdir(), "pica-s03-"));
  workdirs.push(dir);
  const fixture = makeFixture(dir);
  const events = [];
  const onPreToolUse = (input) => {
    if (input.agentId) return { permissionDecision: "allow" };
    const args = input.toolArgs ?? {};
    const paths = ["path", "paths"].flatMap((key) => (Array.isArray(args[key]) ? args[key] : args[key] ? [args[key]] : []));
    const touches =
      (input.toolName === "view" && paths.some((path) => sizeOf(path, dir) > limitBytes)) ||
      (/^(grep|rg)$/.test(input.toolName) && (paths.length === 0 || JSON.stringify(args).includes(fixtureName) || paths.some((path) => sizeOf(path, dir) === 0))) ||
      (input.toolName === "bash" && String(args.command ?? "").includes(fixtureName));
    if (!touches) return { permissionDecision: "allow" };
    return {
      permissionDecision: "deny",
      permissionDecisionReason:
        `${fixtureName} is ${fixture.bytes} bytes (limit ${limitBytes}). The main agent may not read it directly. ` +
        `Delegate the question to the bulk-reader agent with the task tool; it reads the file and returns only the answer.`,
    };
  };
  const bulkReader = {
    name: "bulk-reader",
    displayName: "Bulk reader",
    description: "Reads large files on behalf of the main agent and answers a narrow question about them. Use it for any file over 32 KB.",
    tools: ["view", "grep", "glob"],
    prompt:
      "You are bulk-reader. You read large files so the main agent does not have to. Use view with view_range, or grep, " +
      "never an unranged view. Answer in at most three sentences and never paste file contents.",
    infer: true,
    ...(workerModel ? { model: workerModel } : {}),
    ...(modelPolicy ? { modelPolicy } : {}),
  };
  let session;
  session = await client.createSession({
    workingDirectory: dir,
    streaming: false,
    customAgents: [bulkReader],
    hooks: { onPreToolUse },
    ...(sessionLimits ? { sessionLimits } : {}),
    onPermissionRequest: (request) => (request.kind === "read" ? { kind: "approved" } : { kind: "denied-interactively-by-user" }),
    onEvent: (event) => {
      events.push(event);
      if (event.type === "assistant.usage" && onUsage) onUsage(session, event);
      if (event.type === "session_limits_exhausted.requested") {
        session.rpc.ui.handlePendingSessionLimitsExhausted({ requestId: event.data.requestId, response: { action: "cancel" } }).catch(() => undefined);
      }
    },
  });
  const started = Date.now();
  const prompt = `In ${fixtureName} in the current directory, what is the retention_days value for ${fixture.target}? Reply with just the number.`;
  const sendError = await sendAndWait(session, prompt);
  const metrics = await session.rpc.usage.getMetrics().catch((error) => ({ error: String(error?.message ?? error) }));
  await session.disconnect().catch(() => undefined);
  stopOnRefusal(events, sendError);
  const final = events.filter((event) => event.type === "assistant.message" && !event.agentId).at(-1)?.data?.content ?? "";
  // Raw copy first, so an analysis bug never wastes a prompt.
  writeFileSync(join(scratch, `s03-raw-${Date.now()}.json`), JSON.stringify(redact({ events, metrics }), null, 1));
  return { sendError, seconds: Math.round((Date.now() - started) / 100) / 10, fixture, final, events, metrics, dir };
}

function subagentEvent(event) {
  return /^subagent\./.test(event.type);
}

// Runs every SDK event through Pica's adapter mapping and normalizer, as a live session would.
function throughPica(events, dir) {
  const context = { sessionId: "s03", workingDirectory: dir, modifiedResult: () => undefined, deniedReason: () => undefined };
  let state = initialNormalizerState;
  const drafts = [];
  for (const event of events) {
    const runtimeEvent = toRuntimeEvent(event, context);
    if (!runtimeEvent) continue;
    const normalized = normalizeRuntimeEvent(state, runtimeEvent, { sessionId: "s03", rootAgent: "main" });
    state = normalized.state;
    for (const draft of normalized.drafts) drafts.push({ sdkEventId: event.id, ...draft });
  }
  return drafts;
}

async function attribution(offered) {
  const workerModel = process.env.WORKER_MODEL || "claude-haiku-4.5";
  // MODEL_POLICY=required records what a hard requirement does; it is saved apart and not asserted.
  const modelPolicy = process.env.MODEL_POLICY || undefined;
  const trial = await delegatingTrial({ workerModel, modelPolicy });
  const { events, metrics } = trial;
  const kept = events.filter((event) => !/^(model\.|hook\.)/.test(event.type) && event.type !== "session.usage_info");
  const subagents = events.filter(subagentEvent).map((event) => ({ type: event.type, envelopeAgentId: event.agentId ?? null, ...pick(event.data, ["agentName", "toolCallId", "model", "modelSelectionSource", "firstDispatchedModel", "totalTokens", "totalNanoAiu", "error"]) }));
  const usage = usageOf(events);
  const drafts = throughPica(events, trial.dir).filter((draft) => /^(usage\.recorded|subagent\.)/.test(draft.type));
  const summary = {
    offered,
    configuredWorkerModel: workerModel,
    modelPolicy: modelPolicy ?? "preferred (default)",
    errors: events.filter((event) => /error|failed/.test(event.type)).map((event) => ({ type: event.type, agentId: event.agentId ?? null, data: event.data })),
    finalAnswer: trial.final.slice(0, 200),
    sendError: trial.sendError,
    seconds: trial.seconds,
    correct: trial.final.includes(trial.fixture.answer),
    subagents,
    usage,
  };
  const out = modelPolicy ? join(docs, `S-03-attribution-${modelPolicy}.json`) : attributionFile;
  writeFileSync(out, JSON.stringify(redact({ summary, pica: drafts, metrics, events: kept }), null, 2) + "\n");
  console.log(JSON.stringify(redact(summary), null, 1));
  if (modelPolicy) return;

  const started = subagents.find((event) => event.type === "subagent.started");
  const subUsage = usage.filter((record) => record.agentId !== null);
  check(!trial.sendError, `trial reached session.idle (${trial.sendError ?? "ok"})`);
  check(started !== undefined && subUsage.length > 0, `bulk-reader ran and reported ${subUsage.length} assistant.usage event(s)`);
  if (!started) return;
  console.log(`configured ${workerModel}; subagent.started.model ${started.model} (${started.modelSelectionSource}); sub-agent assistant.usage.model ${[...new Set(subUsage.map((record) => record.model))].join(", ")}`);
  if (offered.some((id) => id !== "auto")) {
    check(offered.includes(workerModel), `models.list offers the worker model ${workerModel}`);
    check(started.model === workerModel && subUsage.every((record) => record.model === workerModel), "subagent.started.model and every sub-agent assistant.usage.model equal the configured worker model");
  } else {
    check(started.model === workerModel, "default-model-only plan: subagent.started.model reports the configured override");
    check(subUsage.every((record) => record.model !== workerModel), "default-model-only plan: no sub-agent assistant.usage ran on the override, so it is ignored");
    const plan = readFileSync(join(root, "PLAN.md"), "utf8");
    const a4 = plan.split("\n").find((line) => line.startsWith("| A4 |")) ?? "";
    check(/fallback/i.test(a4) && /default-model-only/i.test(a4), "A4's fallback is recorded as the decision for default-model-only plans (PLAN.md §2.4)");
  }
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));
}

function checkAgents(saved) {
  const { usage, subagents } = saved.summary;
  const startedIds = new Set(subagents.filter((event) => event.type === "subagent.started").map((event) => event.envelopeAgentId));
  const owner = (record) => (record.agentId === null ? "main" : startedIds.has(record.agentId) ? record.agentId : null);
  const unassigned = usage.filter((record) => owner(record) === null);
  check(usage.length > 0 && unassigned.length === 0, `${usage.length} assistant.usage events, each assigned to one agent by envelope agentId (main when absent); ${unassigned.length} unassigned`);
  const names = new Map(subagents.filter((event) => event.type === "subagent.started").map((event) => [event.envelopeAgentId, event.agentName]));
  const picaUsage = saved.pica.filter((draft) => draft.type === "usage.recorded");
  const byEvent = new Map(picaUsage.map((draft) => [draft.sdkEventId, draft.payload.agent]));
  const mismatched = usage.filter((record) => byEvent.get(record.eventId) !== (record.agentId === null ? "main" : names.get(record.agentId)));
  check(picaUsage.length === usage.length && mismatched.length === 0, `Pica's adapter and normalizer name the same agent for every usage event (${picaUsage.length} usage.recorded, ${mismatched.length} mismatched)`);
  const picaStarted = saved.pica.filter((draft) => draft.type === "subagent.started");
  check(picaStarted.length === startedIds.size, `Pica emits one subagent.started per sub-agent (${picaStarted.length})`);
  // getMetrics' own split by agent must agree with the envelope split.
  const metricAgents = saved.metrics?.agentMetrics ?? {};
  const sum = (records) => records.reduce((total, record) => total + (record.nanoAiu ?? 0), 0);
  const mainSum = sum(usage.filter((record) => record.agentId === null));
  const subSum = sum(usage.filter((record) => record.agentId !== null));
  const mainMetric = metricAgents.main?.totalNanoAiu ?? 0;
  const otherMetric = Object.entries(metricAgents).filter(([key]) => key !== "main").reduce((total, [, value]) => total + (value.totalNanoAiu ?? 0), 0);
  console.log(`getMetrics.agentMetrics keys: ${Object.keys(metricAgents).join(", ")}`);
  check(mainSum === mainMetric && subSum === otherMetric, `per-agent sums match getMetrics.agentMetrics (main ${mainSum} vs ${mainMetric}, sub-agents ${subSum} vs ${otherMetric} nano-AIU)`);
}

function checkCredits(saved) {
  const { usage } = saved.summary;
  const pica = usage.reduce((total, record) => total + (record.nanoAiu ?? 0), 0) / nano;
  const metrics = (saved.metrics?.totalNanoAiu ?? 0) / nano;
  const priced = saved.summary.offered.some((id) => id !== "auto");
  console.log(`method: ${priced ? "plan lists models; prices not checked by this run" : "no token prices on this plan; Σ assistant.usage.copilotUsage.totalNanoAiu / 1e9"}`);
  check(usage.every((record) => record.aiCreditsStatus === "complete" && record.nanoAiu !== null), "every assistant.usage reports a complete cost");
  const off = metrics === 0 ? Infinity : Math.abs(pica - metrics) / metrics;
  check(off <= 0.01, `Pica's ${pica.toFixed(6)} credits vs getMetrics ${metrics.toFixed(6)} (${(off * 100).toFixed(3)}% apart, limit 1%)`);
  const picaLedger = saved.pica.filter((draft) => draft.type === "usage.recorded").reduce((total, draft) => total + draft.payload.credits, 0);
  console.log(`for comparison, the shipped normalizer and ledger record ${picaLedger} credits before pricing; with no token prices the ledger leaves them at 0 (see S-03.md)`);
}

// Check 3. The runtime's floor is recorded first (no prompt). Then one delegating trial runs with the
// runtime cap at that floor and C-09's SessionBudget fed from each assistant.usage. A crossing caused
// by main-agent spending is approved (the budget is raised just past the spend, as the budget
// approval does); the first crossing caused by sub-agent spending aborts the session.
async function limit(offered) {
  const tried = await limitFloor();
  const floor = tried.find((entry) => entry.accepted)?.maxAiCredits;
  const engineLimit = Number(process.env.LIMIT_CREDITS ?? 0.05);
  const step = 0.001;
  const budget = createSessionBudget(engineLimit, 0);
  const steps = [];
  let abortedAt;
  const onUsage = (session, event) => {
    if (abortedAt !== undefined) return;
    const agentId = event.agentId || null;
    const warnings = budget.record((event.data.copilotUsage?.totalNanoAiu ?? 0) / nano);
    const crossed = budget.limit() !== null && budget.spent() >= budget.limit();
    const entry = { usageEventId: event.id, agentId, spent: budget.spent(), limit: budget.limit(), warnings: warnings.length, crossed };
    if (crossed && agentId === null) {
      budget.raise(budget.spent() + step);
      entry.action = `approved: limit raised to ${budget.limit()}`;
    } else if (crossed) {
      abortedAt = event.id;
      entry.action = "abort";
      session.abort().catch((error) => (entry.abortError = String(error?.message ?? error)));
    }
    steps.push(entry);
  };
  const trial = await delegatingTrial({ sessionLimits: floor === undefined ? undefined : { maxAiCredits: floor }, onUsage });
  const { events, metrics } = trial;
  const usage = usageOf(events);
  const abortIndex = events.findIndex((event) => event.id === abortedAt);
  const usageAfterAbort = abortIndex < 0 ? [] : usageOf(events.slice(abortIndex + 1));
  const runtimeExhausted = events.filter((event) => event.type.startsWith("session_limits_exhausted"));
  const kept = events.filter((event) => !/^(model\.|hook\.)/.test(event.type) && event.type !== "session.usage_info");
  const summary = {
    offered,
    runtimeLimitFloor: tried,
    runtimeMaxAiCredits: floor ?? null,
    runtimeExhausted: runtimeExhausted.map((event) => ({ type: event.type, data: event.data })),
    engineLimitCredits: engineLimit,
    engineBudget: steps,
    sendError: trial.sendError,
    seconds: trial.seconds,
    usage,
    usageAfterAbort,
    eventsAfterAbort: abortIndex < 0 ? [] : events.slice(abortIndex + 1).map((event) => `${event.type}${event.agentId ? " (sub-agent)" : ""}`),
    subagentEvents: events.filter(subagentEvent).map((event) => ({ type: event.type, envelopeAgentId: event.agentId ?? null, error: event.data?.error })),
    errors: events.filter((event) => event.type === "session.error").map((event) => event.data),
    finalAnswer: trial.final.slice(0, 200),
    metricsTotalAiu: (metrics.totalNanoAiu ?? 0) / nano,
  };
  writeFileSync(join(docs, "S-03-limit.json"), JSON.stringify(redact({ summary, events: kept }), null, 2) + "\n");
  console.log(JSON.stringify(redact(summary), null, 1));
  const floorText = tried.map((entry) => `${entry.maxAiCredits}: ${entry.accepted ? "accepted" : "refused"}`).join(", ");
  check(true, `runtime maxAiCredits at session.create: ${floorText}`);
  const spent = usage.reduce((total, record) => total + (record.nanoAiu ?? 0), 0) / nano;
  if (runtimeExhausted.length > 0) {
    check(true, "the runtime raised session_limits_exhausted (recorded)");
  } else {
    console.log(`the runtime cannot be set below ${floor}; this trial spent ${spent.toFixed(4)} credits, so it never fired: Free cannot enforce a low maxAiCredits`);
  }
  const abortStep = steps.find((entry) => entry.action === "abort");
  check(abortStep !== undefined && abortStep.agentId !== null, "C-09's session budget was crossed by a sub-agent call and the session was aborted");
  check(usageAfterAbort.length === 0, `no model call was billed after the abort (${usageAfterAbort.length})`);
  check(!trial.final.includes(trial.fixture.answer), "the session stopped before the main agent answered");
}
