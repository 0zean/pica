import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader, parseConfigFile } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, picaDataDir, silentLogger, startEngine } from "../../src/index.ts";
import type { ComposedEngine, SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { fakePicadScenarios } from "../processes/fake-picad-scenarios.ts";

// A-07 over `picad`'s production composition, playing the `approvals` scenario the app's UI test plays:
// four turns run `npm test` and a fifth `npm run lint`, and the runtime asks before each.

interface WireEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: JsonObject;
}

interface Running {
  readonly home: string;
  readonly client: TestClient;
  readonly sessionId: string;
  stop(): Promise<void>;
}

let running: Running | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as JsonObject;
}

async function start(): Promise<Running> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a07-")));
  const repo = join(home, "src", "api");
  mkdirSync(repo, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repo, env });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/api.git"], { cwd: repo, env });
  const scenario = scenarioSchema.parse(fakePicadScenarios["approvals"]);
  const composed: ComposedEngine = composeEngine({
    homeDir: home,
    userName: "tester",
    env,
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener: SocketListener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  const { workspace } = (await call(client, "workspace.create", { name: "Mine" })) as { workspace: { id: string } };
  const { repo: added } = (await call(client, "repo.addPath", { path: repo })) as { repo: { id: string } };
  const { session } = (await call(client, "session.create", { workspaceId: workspace.id, writeRepoIds: [added.id], referenceRepoIds: [] })) as {
    session: { id: string };
  };
  await call(client, "events.subscribe", { sessionId: session.id, afterSeq: 0 });
  return {
    home,
    client,
    sessionId: session.id,
    stop: async () => {
      client.close();
      await listener.close();
      await composed.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function events(client: TestClient): WireEvent[] {
  return client
    .notifications()
    .filter((message) => message["method"] === "events.event")
    .map((message) => (message["params"] as { event: WireEvent }).event);
}

async function until<T>(find: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function idle(client: TestClient, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const { session } = (await call(client, "session.get", { sessionId })) as { session: { state: string } };
    if (session.state === "idle") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("session never went idle");
}

// Sends a message, answers the turn's approval with `choice` (none expected when it is undefined), and returns
// the turn's events.
async function turn(run: Running, text: string, choice: string | undefined): Promise<WireEvent[]> {
  const before = events(run.client).length;
  await call(run.client, "session.send", { sessionId: run.sessionId, text, mode: "send" });
  if (choice !== undefined) {
    const requested = await until(
      () => events(run.client).slice(before).find((event) => event.type === "approval.requested"),
      "approval.requested",
    );
    await call(run.client, "approval.resolve", { approvalId: requested.payload["id"], choice });
  }
  await until(() => events(run.client).slice(before).find((event) => event.type === "assistant.message" && event.payload["text"] === "Done."), "the turn's end");
  await idle(run.client, run.sessionId);
  return events(run.client).slice(before);
}

function rulesIn(home: string): unknown {
  const file = join(picaDataDir(home), "config.jsonc");
  const parsed = parseConfigFile(file, readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return (parsed.value.value as { permissions?: { tools?: unknown } }).permissions?.tools;
}

const ofType = (turnEvents: WireEvent[], type: string): WireEvent[] => turnEvents.filter((event) => event.type === type);

describe("A-07 approvals", () => {
  it("allows once, denies, and always allows, which writes a rule that answers the next identical request", { timeout: 30_000 }, async () => {
    running = await start();
    // The user's own config, with a comment that must survive the write.
    mkdirSync(picaDataDir(running.home), { recursive: true });
    writeFileSync(join(picaDataDir(running.home), "config.jsonc"), '{\n  // mine\n  "budget": { "sessionCredits": 50 }\n}\n');

    const once = await turn(running, "one", "allow_once");
    expect(ofType(once, "approval.resolved").map((event) => event.payload["choice"])).toEqual(["allow_once"]);
    expect(ofType(once, "tool.completed")).toHaveLength(1);
    expect(rulesIn(running.home)).toBeUndefined();

    const denied = await turn(running, "two", "deny");
    expect(ofType(denied, "approval.resolved").map((event) => event.payload["choice"])).toEqual(["deny"]);
    expect(ofType(denied, "tool.failed")).toHaveLength(1);
    expect(rulesIn(running.home)).toBeUndefined();

    const always = await turn(running, "three", "allow_always");
    expect(ofType(always, "approval.resolved").map((event) => event.payload["choice"])).toEqual(["allow_always"]);
    expect(ofType(always, "tool.completed")).toHaveLength(1);
    expect(rulesIn(running.home)).toEqual([{ tool: "bash", match: "npm test", permission: "allow" }]);
    const text = readFileSync(join(picaDataDir(running.home), "config.jsonc"), "utf8");
    expect(text).toContain("// mine");
    expect(text).toContain('"sessionCredits": 50');

    // The identical request is answered by the rule: no approval, and the decision names the rule.
    const suppressed = await turn(running, "four", undefined);
    expect(ofType(suppressed, "approval.requested")).toEqual([]);
    expect(ofType(suppressed, "tool.completed")).toHaveLength(1);
    expect(ofType(suppressed, "policy.decision").map((event) => event.payload)).toContainEqual(
      expect.objectContaining({ ruleId: "permission.rule", outcome: "allow", toolName: "bash" }),
    );
    expect(ofType(suppressed, "session.state_changed").map((event) => event.payload["to"])).not.toContain("awaiting_approval");

    // Another command is another request: it still asks.
    const other = await turn(running, "five", "deny");
    expect(ofType(other, "approval.requested")).toHaveLength(1);
    expect(rulesIn(running.home)).toEqual([{ tool: "bash", match: "npm test", permission: "allow" }]);
  });

  it("keeps the approval pending when the rule cannot be written", { timeout: 30_000 }, async () => {
    running = await start();
    // A config.jsonc that does not parse cannot be edited safely.
    mkdirSync(picaDataDir(running.home), { recursive: true });
    writeFileSync(join(picaDataDir(running.home), "config.jsonc"), "{ not json\n");
    const before = events(running.client).length;
    await call(running.client, "session.send", { sessionId: running.sessionId, text: "one", mode: "send" });
    const { client } = running;
    const requested = await until(() => events(client).slice(before).find((event) => event.type === "approval.requested"), "approval.requested");
    const approvalId = requested.payload["id"];
    const refused = await running.client.request("approval.resolve", { approvalId, choice: "allow_always" });
    expect(JSON.stringify(refused["error"])).toContain("the permission rule was not saved");
    const { approvals } = (await call(running.client, "approval.list", { sessionId: running.sessionId })) as { approvals: { id: string }[] };
    expect(approvals.map((approval) => approval.id)).toEqual([approvalId]);
    await call(running.client, "approval.resolve", { approvalId, choice: "allow_once" });
    await idle(running.client, running.sessionId);
  });
});
