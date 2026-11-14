// S-02 spike: hook enforcement and delegation against the real Copilot runtime (PLAN.md §10, Phase 0).
// Usage: node spikes/s-02-hooks/s02.mjs tools|check-tools|probe|trials [N]
//   tools        lists the runtime's built-in tools (models.list-style RPC, no prompt) and saves
//                names and argument schemas to docs/spikes/S-02-tools.json.
//   check-tools  offline: asserts S-02-tools.json names a read, write, edit, search and shell tool
//                with an argument schema.
//   probe        one trial with full hook and event logs saved to docs/spikes/S-02-probe.json.
//                Asserts that main-agent and sub-agent hook calls are distinguishable.
//                PROBE_MODEL=<id> sets the bulk-reader's `model` override (records what Free does).
//   trials [N]   N trials (default 20); summary saved to docs/spikes/S-02-trials.json. Asserts at
//                least N-1 end with bulk-reader reading the fixture and no fixture line reaching
//                the main agent.
// A trial: a fresh temp directory holds a ~200 KB fixture with a random answer buried in it, and a
// session is opened with a `bulk-reader` custom agent and an onPreToolUse hook that denies
// main-agent reads (view, grep/glob over it, shell touching it) of any file over 32 KB.
// Exits 0 only when the chosen assertions hold. Live modes need a Copilot login; never run in CI.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const toolsFile = join(root, "docs/spikes/S-02-tools.json");
const limitBytes = 32 * 1024;
const fixtureName = "services-registry.txt";

const mode = process.argv[2];
if (!["tools", "check-tools", "probe", "trials"].includes(mode)) {
  console.error("usage: s02.mjs tools|check-tools|probe|trials [N]");
  process.exit(2);
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok" : "FAIL"}: ${message}`);
  if (!condition) failures += 1;
}

// The five capabilities S-02 records, matched against the runtime's tool names.
const wanted = {
  read: ["view", "read", "read_file"],
  write: ["create", "write", "write_file"],
  edit: ["edit", "str_replace_editor", "apply_patch", "str_replace"],
  search: ["grep", "glob", "rg", "search"],
  shell: ["bash", "shell", "powershell"],
};

if (mode === "check-tools") {
  const recorded = JSON.parse(readFileSync(toolsFile, "utf8"));
  for (const [kind, entry] of Object.entries(recorded.capabilities ?? {})) {
    console.log(`${kind}: ${entry.tools.map((tool) => tool.name).join(", ")}`);
  }
  for (const kind of Object.keys(wanted)) {
    const tools = recorded.capabilities?.[kind]?.tools ?? [];
    check(tools.length > 0 && tools.every((tool) => tool.parameters?.type === "object"), `${kind}: ${tools.length} tool(s) with an argument schema`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

// The SDK version pinned by the adapter (engine/packages/adapters/package.json), not a copy.
const sdkEntry = join(root, "engine/packages/adapters/node_modules/@github/copilot-sdk/dist/index.js");
const { CopilotClient } = await import(sdkEntry);

let login;
const workdirs = [];
const maxString = 600;
function redact(value) {
  let text = JSON.stringify(value, (_key, field) =>
    typeof field === "string" && field.length > maxString ? `${field.slice(0, maxString)}…(${field.length} chars)` : field,
  );
  if (login) text = text.split(login).join("<login>");
  for (const dir of workdirs) text = text.split(dir).join("<workdir>");
  // macOS temp dirs appear both as /var/... and /private/var/...
  text = text.split("/private<workdir>").join("<workdir>");
  text = text.replace(/gh[opsu]_[A-Za-z0-9]{20,}/g, "<token>").replace(/github_pat_[A-Za-z0-9_]{20,}/g, "<token>");
  return JSON.parse(text.split(homedir()).join("~"));
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
  if (mode === "tools") await recordTools();
  else {
    const quotaBefore = await quota();
    if (mode === "probe") await probe(quotaBefore);
    else await trials(Number(process.argv[3] ?? 20), quotaBefore);
  }
} finally {
  await client.stop().catch(() => undefined);
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);

async function quota() {
  const result = await client.rpc.account.getQuota({}).catch((error) => ({ error: String(error?.message ?? error) }));
  const snapshots = result.quotaSnapshots ?? result.snapshots ?? result;
  return redact(snapshots);
}

async function recordTools() {
  const { tools } = await client.rpc.tools.list({});
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const capabilities = {};
  for (const [kind, names] of Object.entries(wanted)) {
    capabilities[kind] = {
      tools: names.filter((name) => byName.has(name)).map((name) => ({ name, parameters: byName.get(name).parameters })),
    };
  }
  const out = {
    sdk: "@github/copilot-sdk@1.0.28",
    source: "client.rpc.tools.list({}) with no model, plus hook payloads observed in the S-02 probe and trials (see S-02.md)",
    capabilities,
    all: tools.map((tool) => ({ name: tool.name, namespacedName: tool.namespacedName, parameters: tool.parameters })),
  };
  writeFileSync(toolsFile, JSON.stringify(redact(out), null, 2) + "\n");
  console.log(tools.map((tool) => tool.name).join(" "));
  for (const kind of Object.keys(wanted)) check(capabilities[kind].tools.length > 0, `${kind}: ${capabilities[kind].tools.map((tool) => tool.name).join(", ")}`);
}

// ~200 KB of service records; one record (random position, random value) holds the answer.
function makeFixture(dir) {
  const services = ["kestrel", "osprey", "heron", "plover", "linnet", "wren", "shrike", "tern", "dunlin", "merlin"];
  const suffixes = ["ledger", "gateway", "indexer", "relay", "vault", "mailer", "scheduler", "billing", "audit", "search"];
  const target = "kestrel-ledger-prod-77";
  const answer = randomInt(100, 999);
  const lines = ["# Service registry export. One record per line: name | owner | region | retention_days | tier | notes"];
  const total = 2300;
  const at = randomInt(800, 1600);
  for (let i = 0; i < total; i += 1) {
    if (i === at) {
      lines.push(`${target} | team-ledger | eu-west-2 | ${answer} | gold | canonical ledger record, do not purge early`);
      continue;
    }
    const name = `${services[i % 10]}-${suffixes[(i * 7) % 10]}-${["prod", "stage", "dev"][i % 3]}-${i}`;
    lines.push(`${name} | team-${suffixes[(i * 3) % 10]} | ${["us-east-1", "eu-west-2", "ap-south-1"][i % 3]} | ${30 + ((i * 13) % 400)} | ${["gold", "silver", "bronze"][i % 3]} | record ${i} checksum ${(i * 2654435761) % 4294967296}`);
  }
  const text = lines.join("\n") + "\n";
  const path = join(dir, fixtureName);
  writeFileSync(path, text);
  // Lines the main agent must never see; the answer line is excluded because the sub-agent may quote it.
  const canaries = lines.filter((_line, i) => i > 0 && i !== at + 1).filter((_line, i) => i % 97 === 0);
  return { path, bytes: Buffer.byteLength(text), answer: String(answer), target, canaries };
}

function sizeOf(path, cwd) {
  try {
    const full = isAbsolute(path) ? path : join(cwd, path);
    const stat = statSync(full);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function argPaths(args) {
  if (!args || typeof args !== "object") return [];
  return ["path", "file", "file_path", "filePath", "paths"].flatMap((key) => (Array.isArray(args[key]) ? args[key] : args[key] ? [args[key]] : []));
}

async function runTrial(index, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pica-s02-"));
  workdirs.push(dir);
  const fixture = makeFixture(dir);
  const hooks = [];
  const events = [];
  const permissions = [];

  const onPreToolUse = (input, invocation) => {
    const record = {
      toolName: input.toolName,
      agentId: input.agentId,
      agentType: input.agentType,
      parentAgentId: input.parentAgentId,
      hookSessionId: input.sessionId,
      invocationSessionId: invocation?.sessionId,
      toolArgs: input.toolArgs,
      inputKeys: Object.keys(input),
    };
    const isMain = input.agentId === undefined || input.agentId === "";
    let decision;
    if (isMain) {
      const paths = argPaths(input.toolArgs);
      const big = paths.find((path) => typeof path === "string" && sizeOf(path, dir) > limitBytes);
      const command = typeof input.toolArgs?.command === "string" ? input.toolArgs.command : "";
      const shellTouches = /^(bash|shell|powershell)$/.test(input.toolName) && command.includes(fixtureName);
      // A directory search (grep/glob over the cwd) would also return fixture lines.
      const searchTouches = /^(grep|glob|rg)$/.test(input.toolName) && (big !== undefined || JSON.stringify(input.toolArgs ?? {}).includes(fixtureName) || paths.length === 0 || paths.some((path) => sizeOf(path, dir) === 0));
      if (input.toolName === "view" && big) decision = "view";
      else if (searchTouches && input.toolName !== "glob") decision = "search";
      else if (shellTouches) decision = "shell";
      if (decision) {
        record.decision = { permissionDecision: "deny", gate: decision };
        hooks.push(record);
        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            `${fixtureName} is ${fixture.bytes} bytes (limit ${limitBytes}). The main agent may not read it directly. ` +
            `Delegate the question to the bulk-reader agent with the task tool; it reads the file and returns only the answer.`,
        };
      }
    }
    record.decision = { permissionDecision: "allow" };
    hooks.push(record);
    return { permissionDecision: "allow" };
  };

  const posts = [];
  const onPostToolUse = (input) => {
    posts.push({ toolName: input.toolName, agentId: input.agentId, agentType: input.agentType, resultChars: JSON.stringify(input.toolResult ?? "").length, inputKeys: Object.keys(input) });
  };

  const bulkReader = {
    name: "bulk-reader",
    displayName: "Bulk reader",
    description: "Reads large files on behalf of the main agent and answers a narrow question about them. Use it for any file over 32 KB.",
    tools: ["view", "grep", "glob"],
    prompt:
      "You are bulk-reader. You read large files so the main agent does not have to. Answer the question you are given " +
      "in at most three sentences. Quote at most one line of the file, and only if the question needs it. Never paste file contents.",
    infer: true,
    ...(options.model ? { model: options.model } : {}),
  };

  const started = Date.now();
  const session = await client.createSession({
    workingDirectory: dir,
    streaming: false,
    customAgents: [bulkReader],
    hooks: { onPreToolUse, onPostToolUse },
    onPermissionRequest: (request) => {
      permissions.push(redact(request));
      return request.kind === "read" ? { kind: "approved" } : { kind: "denied-interactively-by-user" };
    },
    onEvent: (event) => events.push(event),
  });
  const idle = new Promise((done) => session.on("session.idle", done));
  const prompt =
    `In ${fixtureName} in the current directory, what is the retention_days value for ${fixture.target}? ` +
    `Reply with just the number.`;
  let sendError;
  await session.send({ prompt }).catch((error) => (sendError = String(error?.message ?? error)));
  const reached = sendError ? false : await Promise.race([idle.then(() => true), new Promise((done) => setTimeout(() => done(false), 240_000))]);
  const metrics = await session.rpc.usage.getMetrics().catch((error) => ({ error: String(error?.message ?? error) }));
  await session.disconnect().catch(() => undefined);

  // Evaluate.
  const subStarts = events.filter((event) => event.type === "subagent.started");
  const subAgentIds = new Set(subStarts.map((event) => event.agentId ?? event.data?.agentId).filter(Boolean));
  const subHooks = hooks.filter((hook) => hook.agentId);
  // The runtime reports the search tool as `rg` in hooks, although tools.list names it `grep`.
  // A search with no path, or over the directory, also reads the fixture.
  const readsFixture = (hook) =>
    JSON.stringify(hook.toolArgs ?? {}).includes(fixtureName) ||
    (/^(grep|rg)$/.test(hook.toolName) && (argPaths(hook.toolArgs).length === 0 || argPaths(hook.toolArgs).some((path) => sizeOf(path, dir) === 0)));
  const subReadFixture = subHooks.some((hook) => hook.decision.permissionDecision === "allow" && /^(view|grep|rg)$/.test(hook.toolName) && readsFixture(hook));
  const mainCompletes = events.filter((event) => event.type === "tool.execution_complete" && !event.agentId);
  const leaks = mainCompletes.filter((event) => fixture.canaries.some((line) => JSON.stringify(event.data?.result ?? "").includes(line.slice(0, 40))));
  const mainDenies = hooks.filter((hook) => !hook.agentId && hook.decision.permissionDecision === "deny");
  const final = events.filter((event) => event.type === "assistant.message" && !event.agentId).at(-1)?.data?.content ?? "";
  const usage = events.filter((event) => event.type === "assistant.usage").map((event) => ({ agentId: event.agentId, model: event.data?.model, nanoAiu: event.data?.copilotUsage?.totalNanoAiu, input: event.data?.inputTokens, output: event.data?.outputTokens }));
  const errors = events.filter((event) => event.type === "session.error" || event.type === "subagent.failed").map((event) => event.data);
  const taskCalls = hooks.filter((hook) => !hook.agentId && hook.toolName === "task");

  const summary = {
    trial: index,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    reachedIdle: reached,
    sendError,
    delegated: subStarts.length > 0,
    subagents: subStarts.map((event) => ({ agentId: event.agentId, agentName: event.data?.agentName, agentType: event.data?.agentType, model: event.data?.model, modelSelectionSource: event.data?.modelSelectionSource, toolCallId: event.data?.toolCallId })),
    subReadFixture,
    mainDenies: mainDenies.map((hook) => ({ tool: hook.toolName, gate: hook.decision.gate })),
    mainToolCalls: hooks.filter((hook) => !hook.agentId).map((hook) => ({ tool: hook.toolName, args: hook.toolArgs })),
    subToolCalls: subHooks.map((hook) => ({ tool: hook.toolName, args: hook.toolArgs })),
    taskArgs: taskCalls.map((hook) => hook.toolArgs),
    leakedToMain: leaks.length,
    answer: fixture.answer,
    finalAnswer: final.slice(0, 200),
    correct: final.includes(fixture.answer),
    usage,
    errors,
    hookAgentIdsMatchSubagentStarted: subHooks.every((hook) => subAgentIds.size === 0 || subAgentIds.has(hook.agentId)),
    pass: reached && subStarts.length > 0 && subReadFixture && leaks.length === 0,
  };
  // model.*, hook.* and usage_info events are runtime telemetry; they are dropped from saved logs to keep them readable.
  const kept = events.filter((event) => !/^(model\.|hook\.)/.test(event.type) && event.type !== "session.usage_info");
  return { summary, detail: { fixtureBytes: fixture.bytes, prompt, hooks, posts, permissions, events: kept, metrics } };
}

async function probe(quotaBefore) {
  const model = process.env.PROBE_MODEL || undefined;
  const { summary, detail } = await runTrial(0, { model });
  const quotaAfter = await quota();
  writeFileSync(join(root, `docs/spikes/S-02-probe${model ? "-model" : ""}.json`), JSON.stringify(redact({ requestedSubagentModel: model ?? null, summary, quotaBefore, quotaAfter, ...detail }), null, 2) + "\n");
  console.log(JSON.stringify(redact(summary), null, 1));
  const main = detail.hooks.filter((hook) => !hook.agentId);
  const sub = detail.hooks.filter((hook) => hook.agentId);
  console.log(`hooks: ${main.length} main, ${sub.length} sub-agent; sub-agent agentType: ${[...new Set(sub.map((hook) => hook.agentType))].join(", ")}`);
  check(summary.reachedIdle, "trial reached session.idle");
  check(main.length > 0 && sub.length > 0, "hook calls seen for both the main agent and the sub-agent");
  check(sub.every((hook) => hook.agentId && hook.agentType === "bulk-reader") && main.every((hook) => !hook.agentId), "sub-agent hook calls carry agentId and agentType=bulk-reader; main-agent calls carry no agentId");
  check(summary.hookAgentIdsMatchSubagentStarted, "hook agentId equals the subagent.started event agentId");
}

async function trials(count, quotaBefore) {
  const results = [];
  for (let i = 1; i <= count; i += 1) {
    const { summary } = await runTrial(i);
    results.push(summary);
    console.log(`trial ${i}: ${summary.pass ? "pass" : "FAIL"} delegated=${summary.delegated} subRead=${summary.subReadFixture} leaks=${summary.leakedToMain} denies=${summary.mainDenies.length} correct=${summary.correct} ${summary.seconds}s ${summary.sendError ?? ""}${summary.errors.length ? JSON.stringify(summary.errors).slice(0, 300) : ""}`);
    if (summary.sendError || summary.errors.some((error) => /quota|rate|limit|402|429/i.test(JSON.stringify(error)))) {
      console.log("stopping: the runtime refused a call (see the error above)");
      break;
    }
  }
  const passed = results.filter((result) => result.pass).length;
  const quotaAfter = await quota();
  const out = { count, ran: results.length, passed, quotaBefore, quotaAfter, results };
  writeFileSync(join(root, "docs/spikes/S-02-trials.json"), JSON.stringify(redact(out), null, 2) + "\n");
  check(results.length === count, `${results.length} of ${count} trials ran`);
  check(passed >= count - 1, `${passed} of ${count} trials delegated with no fixture content reaching the main agent (need ${count - 1})`);
}
