// S-06 spike: MCP connectivity through the pinned Copilot SDK (PLAN.md §10, Phase 0).
// Usage: node spikes/s-06-mcp/s06.mjs connect|tokens [server...] | login <server>
//   Each server in §2.2 is attached to its own session (so one blocked server does not stop the
//   others), the session's tools are initialized without a prompt, and the script records the
//   server status, its tool list, the OAuth request the runtime raises (cancelled, never
//   answered), a passive OAuth probe, and `metadata.contextInfo` / `getContextAttribution`.
//   Everything goes to docs/spikes/S-06-results.json, redacted.
//   connect  asserts that every selected server connects and lists at least one tool.
//   tokens   asserts that `contextInfo.mcpToolsTokens` was recorded (> 0) for every selected server.
//   login    for the owner, not the checks: starts the runtime-owned OAuth login for one server
//            (`session.mcp.oauth.login`: discovery, dynamic client registration, PKCE, loopback
//            listener) and prints the authorization URL. The script never opens it. The owner opens
//            it and consents; the runtime stores the grant, and a later `connect` reuses it.
//            Waits PICA_S06_LOGIN_WAIT seconds (default 300) for the server to connect.
// Credentials: GitHub uses the `gh` login (`gh auth token`). The others take optional env vars:
//   PICA_S06_DATADOG_URL, PICA_S06_DATADOG_API_KEY + PICA_S06_DATADOG_APP_KEY,
//   PICA_S06_CLICKUP_URL, PICA_S06_SNOWFLAKE_URL, PICA_S06_SNOWFLAKE_TOKEN (PAT).
// Without them the runtime's own OAuth path is exercised as far as the auth request, which is
// cancelled. No browser is opened, no consent is given. Needs a Copilot login; never run in CI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const sdkEntry = join(root, "engine/packages/adapters/node_modules/@github/copilot-sdk/dist/index.js");
const { CopilotClient } = await import(sdkEntry);
const resultsPath = join(root, "docs/spikes/S-06-results.json");

const mode = process.argv[2];
if (mode !== "connect" && mode !== "tokens" && mode !== "login") {
  console.error("usage: s06.mjs connect|tokens [server...] | login <server>");
  process.exit(2);
}

const secrets = [];
function secret(value) {
  if (value) secrets.push(value);
  return value;
}
function env(name) {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function ghToken() {
  try {
    return secret(execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim());
  } catch {
    return undefined;
  }
}

// Each entry: the config handed to the SDK, how it authenticates, and whether the check needs it.
function serverPlans() {
  const plans = [];
  const gh = ghToken();
  plans.push({
    id: "github",
    asserted: true,
    auth: gh ? "PAT header (gh CLI OAuth token, `Authorization: Bearer`)" : "none (no gh login)",
    config: { type: "http", url: "https://api.githubcopilot.com/mcp/", tools: ["*"], ...(gh ? { headers: { Authorization: `Bearer ${gh}` } } : {}) },
  });
  plans.push({
    id: "github-signin",
    asserted: false,
    auth: "no header: the runtime attaches the Copilot sign-in itself",
    config: { type: "http", url: "https://api.githubcopilot.com/mcp/", tools: ["*"] },
  });

  const ddKey = secret(env("PICA_S06_DATADOG_API_KEY"));
  const ddApp = secret(env("PICA_S06_DATADOG_APP_KEY"));
  plans.push({
    id: "datadog",
    asserted: true,
    auth: ddKey && ddApp ? "API key + application key headers" : "runtime OAuth (no header)",
    config: {
      type: "http",
      url: env("PICA_S06_DATADOG_URL") ?? "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      tools: ["*"],
      ...(ddKey && ddApp ? { headers: { "DD-API-KEY": ddKey, "DD-APPLICATION-KEY": ddApp } } : {}),
    },
  });

  plans.push({
    id: "clickup",
    asserted: true,
    auth: "runtime OAuth (no header)",
    config: { type: "http", url: env("PICA_S06_CLICKUP_URL") ?? "https://mcp.clickup.com/mcp", tools: ["*"] },
  });

  const sfUrl = env("PICA_S06_SNOWFLAKE_URL");
  const sfToken = secret(env("PICA_S06_SNOWFLAKE_TOKEN"));
  plans.push({
    id: "snowflake",
    asserted: true,
    auth: sfToken ? "PAT header (`Authorization: Bearer`)" : "runtime OAuth (no header)",
    blocked: sfUrl ? undefined : "no endpoint: PICA_S06_SNOWFLAKE_URL is unset (the server is account-specific and created by an admin, Q-06)",
    config: sfUrl ? { type: "http", url: sfUrl, tools: ["*"], ...(sfToken ? { headers: { Authorization: `Bearer ${sfToken}` } } : {}) } : undefined,
  });
  return plans;
}

let login;
let workdir = "";
const maxString = 400;
function redact(value) {
  let text = JSON.stringify(value, (_key, field) =>
    typeof field === "string" && field.length > maxString ? `${field.slice(0, maxString)}…(${field.length} chars)` : field,
  );
  for (const value_ of secrets) text = text.split(value_).join("<secret>");
  text = text.replace(/\bgh[opusr]_[A-Za-z0-9]{20,}/g, "<secret>");
  if (login) text = text.split(login).join("<login>");
  if (workdir) text = text.split(workdir).join("<workdir>");
  return JSON.parse(text.split(homedir()).join("~"));
}

function errorText(error) {
  return String(error?.message ?? error);
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms))]);
}

// M-04's estimate (core/src/mcp-attach/token-estimate.ts), copied so the spike stays plain Node:
// ceil(utf8 bytes of canonical JSON { name: "server/tool", description?, input_schema } / 4) + 4.
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
    .join(",")}}`;
}
function m04ToolTokens(serverId, tool) {
  const payload = { name: `${serverId}/${tool.name}`, input_schema: tool.inputSchema ?? null };
  if (tool.description !== undefined) payload.description = tool.description;
  return Math.ceil(Buffer.byteLength(canonicalJson(payload), "utf8") / 4) + 4;
}

const settled = new Set(["connected", "failed", "needs-auth", "disabled", "not_configured"]);

async function probeServer(client, plan) {
  const started = Date.now();
  const record = { id: plan.id, asserted: plan.asserted, auth: plan.auth, url: plan.config?.url ?? null };
  if (plan.blocked) return { ...record, outcome: "blocked", blocked: plan.blocked };

  const events = [];
  const authRequests = [];
  const session = await client.createSession({
    workingDirectory: workdir,
    mcpServers: { [plan.id]: plan.config },
    onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }),
    // Pica never answers here in the spike: the request is recorded and cancelled, so no
    // browser opens and no consent is given.
    onMcpAuthRequest: (request) => {
      authRequests.push(request);
      return { kind: "cancelled" };
    },
    onEvent: (event) => {
      if (event.type.includes("mcp")) events.push({ type: event.type, data: event.data, ms: Date.now() - started });
    },
  });
  try {
    record.initialize = await withTimeout(session.rpc.tools.initializeAndValidate(), 90_000, "initializeAndValidate")
      .then(() => "ok")
      .catch(errorText);
    const deadline = Date.now() + 30_000;
    let server;
    while (Date.now() < deadline) {
      const list = await session.rpc.mcp.list().catch(() => undefined);
      server = list?.servers.find((entry) => entry.name === plan.id);
      const toolsLoaded = events.some((event) => event.type === "session.mcp_server_tools_loaded");
      if (server && settled.has(server.status) && (server.status !== "connected" || toolsLoaded)) break;
      await new Promise((resolve_) => setTimeout(resolve_, 500));
    }
    const list = await session.rpc.mcp.list().catch((error) => ({ error: errorText(error) }));
    server = list.servers?.find((entry) => entry.name === plan.id);
    record.status = server?.status ?? null;
    record.error = server?.error;
    record.displayName = server?.displayName;
    record.hostState = list.host;
    record.connectMs = Date.now() - started;

    const tools = await session.rpc.mcp.listTools({ serverName: plan.id }).catch((error) => ({ error: errorText(error) }));
    record.tools = tools.tools
      ? tools.tools.map((tool) => ({ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true, descriptionChars: tool.description?.length ?? 0 }))
      : { error: tools.error };
    record.toolCount = tools.tools?.length ?? 0;
    // listTools returns inputSchema at runtime although McpTools does not declare it.
    if (tools.tools) record.m04Estimate = tools.tools.reduce((sum, tool) => sum + m04ToolTokens(plan.id, tool), 0);

    record.probe = await session.rpc.mcp.oauth.probe({ serverName: plan.id }).catch((error) => ({ error: errorText(error) }));
    const context = await session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 }).catch((error) => ({ error: errorText(error) }));
    record.contextInfo = context.contextInfo ?? context;
    const attribution = await session.rpc.metadata.getContextAttribution().catch((error) => ({ error: errorText(error) }));
    // MCP tools appear as `toolDefinition:<server>-<tool>` entries; there is no `mcpServer` entry.
    const entries = attribution.contextAttribution?.entries ?? [];
    const serverTools = entries.filter((entry) => entry.kind === "toolDefinition" && entry.id.startsWith(`toolDefinition:${plan.id}-`));
    record.attribution = attribution.contextAttribution
      ? {
          modelId: attribution.contextAttribution.modelId,
          modelSource: attribution.contextAttribution.modelSource,
          categories: attribution.contextAttribution.categories,
          entryKinds: [...new Set(entries.map((entry) => entry.kind))],
          serverToolEntries: serverTools.length,
          serverToolTokens: serverTools.reduce((sum, entry) => sum + entry.tokens, 0),
          heaviestTools: serverTools.sort((a, b) => b.tokens - a.tokens).slice(0, 5).map((entry) => ({ label: entry.label, tokens: entry.tokens })),
        }
      : attribution;
    record.authRequests = authRequests;
    record.events = events;
    record.outcome = record.status === "connected" && record.toolCount > 0 ? "connected" : authRequests.length > 0 || record.status === "needs-auth" ? "needs-auth" : "failed";
  } finally {
    await session.disconnect().catch(() => undefined);
  }
  return record;
}

// The same session shape with no MCP server: what the built-in tools cost on their own.
async function baseline(client) {
  const session = await client.createSession({ workingDirectory: workdir, onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }) });
  try {
    await session.rpc.tools.initializeAndValidate();
    const context = await session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 });
    const servers = await session.rpc.mcp.list();
    return { contextInfo: context.contextInfo, servers: servers.servers.map((entry) => ({ name: entry.name, status: entry.status })) };
  } finally {
    await session.disconnect().catch(() => undefined);
  }
}

// Owner-driven: the runtime runs discovery, registration and PKCE and listens on loopback; the
// owner opens the printed URL. No onMcpAuthRequest handler, so the runtime keeps the flow.
async function runLogin(client, plan) {
  if (plan.blocked) {
    console.error(`FAIL: ${plan.id}: ${plan.blocked}`);
    return 1;
  }
  const session = await client.createSession({
    workingDirectory: workdir,
    mcpServers: { [plan.id]: plan.config },
    onPermissionRequest: () => ({ kind: "denied-interactively-by-user" }),
  });
  try {
    await session.rpc.tools.initializeAndValidate();
    const result = await session.rpc.mcp.oauth.login({ serverName: plan.id, clientName: "Pica (S-06 spike)", callbackSuccessMessage: "Pica: return to the terminal." });
    if (!result.authorizationUrl) {
      console.log(`${plan.id}: cached grant still valid, no browser step needed`);
    } else {
      console.log(`${plan.id}: open this URL in a browser and approve access:\n${result.authorizationUrl}`);
    }
    const waitMs = Number(env("PICA_S06_LOGIN_WAIT") ?? 300) * 1000;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const list = await session.rpc.mcp.list();
      const server = list.servers.find((entry) => entry.name === plan.id);
      if (server?.status === "connected") {
        console.log(`ok: ${plan.id} connected; rerun \`node spikes/s-06-mcp/s06.mjs connect\``);
        return 0;
      }
      await new Promise((resolve_) => setTimeout(resolve_, 2000));
    }
    console.error(`FAIL: ${plan.id} not connected after ${waitMs / 1000} s`);
    return 1;
  } finally {
    await session.disconnect().catch(() => undefined);
  }
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok" : "FAIL"}: ${message}`);
  if (!condition) failures += 1;
}

const selected = process.argv.slice(3);
const plans = serverPlans().filter((plan) => selected.length === 0 || selected.includes(plan.id));
const client = new CopilotClient({});
workdir = mkdtempSync(join(tmpdir(), "pica-s06-"));
const results = [];
let base;
try {
  await client.start();
  const auth = await client.getAuthStatus();
  login = auth.login;
  if (!auth.isAuthenticated) {
    console.error(`FAIL: not signed in to Copilot: ${auth.statusMessage ?? "(no status message)"}`);
    process.exit(1);
  }
  if (mode === "login") {
    if (plans.length !== 1) {
      console.error("usage: s06.mjs login <server>");
      process.exit(2);
    }
    const code = await runLogin(client, plans[0]);
    await client.stop().catch(() => undefined);
    rmSync(workdir, { recursive: true, force: true });
    process.exit(code);
  }
  base = await baseline(client).catch((error) => ({ error: errorText(error) }));
  for (const plan of plans) {
    const record = await probeServer(client, plan).catch((error) => ({ id: plan.id, asserted: plan.asserted, auth: plan.auth, outcome: "failed", error: errorText(error) }));
    results.push(record);
    console.log(
      JSON.stringify(
        redact({
          id: record.id,
          outcome: record.outcome,
          status: record.status,
          tools: record.toolCount,
          mcpToolsTokens: record.contextInfo?.mcpToolsTokens,
          m04Estimate: record.m04Estimate,
          auth: record.auth,
          error: record.error ?? record.blocked,
          authRequest: record.authRequests?.[0] && { reason: record.authRequests[0].reason, www: record.authRequests[0].wwwAuthenticateParams },
          probe: record.probe?.status ?? record.probe?.error,
        }),
      ),
    );
  }
} finally {
  await client.stop().catch(() => undefined);
}

// Merge with an earlier run so a partial run (one server) keeps the other servers' results.
let previous = {};
try {
  previous = JSON.parse(readFileSync(resultsPath, "utf8"));
} catch {
  previous = {};
}
const byId = Object.fromEntries((previous.servers ?? []).map((record) => [record.id, record]));
for (const record of results) byId[record.id] = { ...redact(record), recordedAt: new Date().toISOString().slice(0, 10) };
writeFileSync(
  resultsPath,
  JSON.stringify({ sdk: "@github/copilot-sdk@1.0.28", baseline: base ? redact(base) : previous.baseline, servers: Object.values(byId).sort((a, b) => a.id.localeCompare(b.id)) }, null, 2) + "\n",
);
rmSync(workdir, { recursive: true, force: true });

for (const record of results.filter((entry) => entry.asserted)) {
  if (mode === "connect") {
    check(record.outcome === "connected", `${record.id} connects and lists tools: ${record.outcome}, ${record.toolCount ?? 0} tools${record.blocked ? ` (${record.blocked})` : ""}`);
  } else {
    const tokens = record.contextInfo?.mcpToolsTokens;
    check(typeof tokens === "number" && tokens > 0, `${record.id} tool-definition tokens from contextInfo: ${tokens ?? "none"}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
