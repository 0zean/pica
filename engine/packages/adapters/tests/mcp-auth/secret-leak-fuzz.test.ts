import {
  createEventLog,
  createMcpSecretRedactor,
  createMcpTokenManager,
  createRedactingEventLog,
  createRedactingLogger,
  createRuntimeEventRecorder,
  loginMcpServer,
  mcpAuthErrorData,
  resolveMcpServerSecrets,
  type McpRedactableLogger,
  type McpSecretRedactor,
  type Store,
} from "@pica/core";
import type { McpServerDef } from "@pica/protocol";
import { FakeRuntime, parseScenario } from "@pica/testkit";
import fc from "fast-check";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBrokerSecretSource,
  createEnvSecretSource,
  createMcpOAuthCrypto,
  createMcpOAuthHttp,
  createMemoryMcpGrantStore,
  type BrokerSecretsGetCall,
} from "../../src/index.ts";
import { seedStore, withTempDir } from "../store/helpers.ts";
import { approvingBrowser, oauthStub, recordingStatus, remoteServer, type TokenReply } from "./helpers.ts";

const sessionId = "session-1";

// Realistic token prefixes keep a generated secret from matching ordinary text by chance.
const secret = fc
  .tuple(
    fc.constantFrom("ghp_", "sk-", "xoxb-", "glpat-", "AKIA", "pk_7_", "dd-"),
    fc.string({ minLength: 6, maxLength: 40, unit: "binary" }),
  )
  .map(([prefix, rest]) => prefix + rest);

interface Secrets {
  readonly keychain: string;
  readonly env: string;
  readonly access: string;
  readonly refresh: string;
  readonly code: string;
}

interface Plan {
  readonly secrets: Secrets;
  readonly envSet: boolean;
  // A broker or authorization server that repeats a secret in its error text.
  readonly echoingFailures: boolean;
  readonly refreshOutcome: "rejected" | "unavailable" | "echoed" | "issued";
  readonly turnEchoes: readonly (keyof Secrets)[];
}

const plan: fc.Arbitrary<Plan> = fc.record({
  secrets: fc.record({ keychain: secret, env: secret, access: secret, refresh: secret, code: secret }),
  envSet: fc.boolean(),
  echoingFailures: fc.boolean(),
  refreshOutcome: fc.constantFrom("rejected", "unavailable", "echoed", "issued"),
  turnEchoes: fc.uniqueArray(fc.constantFrom("keychain", "env", "access", "refresh", "code"), { minLength: 1 }),
});

const localServer: McpServerDef = {
  id: "local",
  name: "Local",
  transport: {
    type: "stdio",
    command: "local-mcp",
    args: ["--token", "${secret:keychain:local/token}"],
    env: { API_KEY: { secretRef: "env:API_KEY" }, AUTH: "token ${secret:keychain:local/token}" },
    cwd: null,
  },
  toolAllowlist: null,
  scope: "repo",
};

function broker(plan: Plan): BrokerSecretsGetCall {
  return ({ secretRef }) =>
    Promise.resolve(
      secretRef === "keychain:local/token"
        ? { ok: true, result: { value: plan.secrets.keychain } }
        : { ok: false, code: "internal_error", message: plan.echoingFailures ? plan.secrets.keychain : "failed" },
    );
}

function refreshReply(plan: Plan): TokenReply {
  switch (plan.refreshOutcome) {
    case "rejected":
      return { status: 400, body: { error: "invalid_grant", error_description: plan.secrets.refresh } };
    case "unavailable":
      return { status: 502, body: { message: plan.secrets.access } };
    case "echoed":
      return { status: 400, body: { error: plan.secrets.refresh } };
    case "issued":
      return { status: 200, body: { access_token: `${plan.secrets.access}-2`, expires_in: 60 } };
  }
}

// The secrets the engine was given. An unset environment variable's value never reaches the engine,
// so only H-03's pattern scrubbing could catch it.
function handledSecrets(plan: Plan): readonly string[] {
  return (Object.keys(plan.secrets) as (keyof Secrets)[])
    .filter((key) => key !== "env" || plan.envSet)
    .map((key) => plan.secrets[key]);
}

function echoScenario(plan: Plan, launchText: string): string {
  const echoed = [...plan.turnEchoes.map((key) => plan.secrets[key]), launchText]
    .filter((text) => handledSecrets(plan).some((value) => text.includes(value)))
    .join(" ");
  return JSON.stringify({
    version: 1,
    models: [{ id: "frontier-1", name: "Frontier 1" }],
    defaultModel: "frontier-1",
    turns: [
      {
        steps: [
          { type: "toolCall", name: "local-env", arguments: { echo: echoed }, result: `tool output: ${echoed}` },
          { type: "text", content: `the server said ${echoed}`, deltas: [`the server said `, echoed] },
          { type: "error", code: "runtime.failed", message: `upstream rejected ${echoed}` },
        ],
      },
    ],
  });
}

async function runScenario(plan: Plan, store: Store, redactor: McpSecretRedactor, log: McpRedactableLogger): Promise<void> {
  const keychain = createBrokerSecretSource(broker(plan));
  const env = createEnvSecretSource(plan.envSet ? { API_KEY: plan.secrets.env } : {});
  const local = await resolveMcpServerSecrets(localServer, { keychain, env }, redactor);
  const launchText = local.ok ? JSON.stringify(local.value.transport) : "";
  if (!local.ok) {
    log.warn(`${local.error.message} ${JSON.stringify(mcpAuthErrorData(local.error))}`);
  }
  // A misconfigured reference reports the broker's failure text.
  const broken = await resolveMcpServerSecrets(
    { ...localServer, id: "broken", transport: { ...localServer.transport, args: ["${secret:keychain:other}"] } as McpServerDef["transport"] },
    { keychain, env },
    redactor,
  );
  if (!broken.ok) {
    log.error(broken.error.message);
  }

  const now = Date.parse("2026-11-13T10:00:00.000Z");
  const stub = oauthStub([
    { status: 200, body: { access_token: plan.secrets.access, refresh_token: plan.secrets.refresh, expires_in: 30 } },
    refreshReply(plan),
  ]);
  const status = recordingStatus();
  const grants = createMemoryMcpGrantStore();
  const http = createMcpOAuthHttp({ fetch: stub.fetch, now: () => now });
  const login = await loginMcpServer(
    { http, grants, status, redactor, browser: approvingBrowser(plan.secrets.code), crypto: createMcpOAuthCrypto(), clientName: "Pica" },
    remoteServer,
  );
  log.info(`login: ${JSON.stringify(login)}`);
  const tokens = createMcpTokenManager({ http, grants, status, redactor, now: () => now });
  const token = await tokens.accessToken(remoteServer);
  log.info(`token: ${token.ok ? "ok" : JSON.stringify(mcpAuthErrorData(token.error))} ${token.ok ? "" : token.error.message}`);
  for (const change of status.changes) {
    log.info(`mcp.statusChanged ${JSON.stringify(change)}`);
  }
  // A server's stderr is logged as it arrives; it may print its own credentials.
  log.warn(`local stderr: ${launchText}`);

  const scenario = parseScenario(echoScenario(plan, launchText), "fuzz");
  if (!scenario.ok) {
    throw new Error("scenario failed to parse");
  }
  const runtime = new FakeRuntime({ scenario: scenario.value });
  const created = await runtime.createSession({ workingDirectory: "/repo" });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const recorder = createRuntimeEventRecorder(createRedactingEventLog(createEventLog(store.events), redactor), {
    sessionId,
    rootAgent: "main",
  });
  const idle = new Promise<void>((resolve) => {
    created.value.subscribe((event) => {
      recorder.record(event);
      if (event.type === "session.idle") {
        resolve();
      }
    });
  });
  await created.value.send(`use ${plan.secrets.keychain} for this`);
  await idle;
}

function allRows(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    return tables
      .map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${String(table["name"])}"`).all()))
      .join("\n");
  } finally {
    db.close();
  }
}

// The secret as written, and as it appears inside a JSON string.
function forms(value: string): readonly string[] {
  return [value, JSON.stringify(value).slice(1, -1)];
}

describe("secret values", () => {
  it("never appear in any event, log line, or database row", async () => {
    await fc.assert(
      fc.asyncProperty(plan, async (generated) => {
        const temp = withTempDir();
        try {
          const path = join(temp.dir, "pica.db");
          const store = seedStore(path, [sessionId]);
          const redactor = createMcpSecretRedactor();
          const lines: string[] = [];
          const capture: McpRedactableLogger = {
            info: (line) => lines.push(line),
            warn: (line) => lines.push(line),
            error: (line) => lines.push(line),
          };
          await runScenario(generated, store, redactor, createRedactingLogger(capture, redactor));
          const events = store.events.readAfter(sessionId, 0);
          store.close();
          if (!events.ok) {
            throw new Error(events.error.message);
          }
          expect(events.value.length).toBeGreaterThan(3);
          const outputs = { events: JSON.stringify(events.value), logs: lines.join("\n"), rows: allRows(path) };
          for (const value of handledSecrets(generated)) {
            for (const [where, text] of Object.entries(outputs)) {
              for (const form of forms(value)) {
                expect(text.includes(form), `${JSON.stringify(value)} leaked into ${where}`).toBe(false);
              }
            }
          }
        } finally {
          temp.cleanup();
        }
      }),
      { numRuns: 150 },
    );
  });
});
