import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, picaDataDir, silentLogger, startEngine } from "../../src/index.ts";
import type { ComposedEngine, SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";

// E-11: `picad`'s production composition, driven over the socket with a FakeRuntime in place of
// the Copilot runtime. Everything else (store, config, read gate, output guard, delegator, ledger,
// audit, workspaces, repo registry) is what `main.ts` composes.

const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv, stdio: "pipe" });
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(path, "README.md"), "# Acme API\n");
  writeFileSync(join(path, "schema.sql"), "-- one line of SQL schema\n".repeat(8000));
  git(path, "add", ".");
  git(path, "commit", "--quiet", "-m", "Initial commit");
  git(path, "remote", "add", "origin", "https://github.com/acme/api.git");
  return path;
}

interface Running {
  readonly home: string;
  readonly repo: string;
  readonly client: TestClient;
  stop(): Promise<void>;
}

let running: Running | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(turns: (repo: string) => unknown[]): Promise<Running> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-e11-")));
  const repo = makeRepo(join(home, "src", "api"));
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: turns(repo) });
  const composed: ComposedEngine = composeEngine({
    homeDir: home,
    userName: "tester",
    env: gitEnv,
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-15T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener: SocketListener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  return {
    home,
    repo,
    client,
    stop: async () => {
      client.close();
      await listener.close();
      await composed.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as JsonObject;
}

async function waitForIdle(client: TestClient, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { session } = (await call(client, "session.get", { sessionId })) as { session: { state: string } };
    if (session.state === "idle") return;
    if (session.state === "failed") throw new Error("session failed");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("session never went idle");
}

const largeRead = (path: string): unknown => ({ type: "toolCall", name: "view", arguments: { path }, result: "contents" });

describe("E-11 picad production composition", () => {
  it("registers a workspace and a repo by path, then runs a gated, metered, audited session", async () => {
    running = await start((repoDir) => [
      {
        prompt: "what does the schema define?",
        steps: [
          { type: "usage", model: "model-a", inputTokens: 1200, cachedInputTokens: 800, outputTokens: 90 },
          largeRead(join(repoDir, "schema.sql")),
          { type: "text", content: "It defines the ledger tables." },
        ],
      },
    ]);
    const { client, repo, home } = running;
    const { workspace } = (await call(client, "workspace.create", { name: "Mine" })) as { workspace: { id: string } };
    const { repo: added } = (await call(client, "repo.addPath", { path: join(repo, ".") })) as {
      repo: { id: string; localPath: string; remoteUrl: string; cloneState: string };
    };
    expect(added).toMatchObject({ localPath: repo, cloneState: "cloned" });
    await call(client, "workspace.pinRepo", { workspaceId: workspace.id, repoId: added.id });
    const { repos } = (await call(client, "repo.list", { workspaceId: workspace.id })) as { repos: { id: string }[] };
    expect(repos.map((entry) => entry.id)).toEqual([added.id]);

    const { session } = (await call(client, "session.create", {
      workspaceId: workspace.id,
      writeRepoIds: [added.id],
      referenceRepoIds: [],
      prompt: "what does the schema define?",
    })) as { session: { id: string; routingProfile: string } };
    expect(session.routingProfile).toBe("balanced");
    await waitForIdle(client, session.id);

    const { rows } = (await call(client, "usage.rollup", { groupBy: "agent", sessionId: session.id })) as {
      rows: { key: string; inputTokens: number; outputTokens: number }[];
    };
    expect(rows).toEqual([expect.objectContaining({ key: "main", inputTokens: 1200, outputTokens: 90 })]);

    // C-04: the main agent's whole-file read of a 200 KB file is denied, naming bulk-reader, and
    // H-02: that decision is on the session log and in the audit log.
    const { subscriptionId } = (await call(client, "events.subscribe", { sessionId: session.id, afterSeq: 0 })) as { subscriptionId: string };
    const decision = (await client.next(
      (message) => message["method"] === "events.event" && JSON.stringify(message).includes('"policy.decision"'),
    )) as { params: { subscriptionId: string; event: { payload: { outcome: string; reason: string; toolName: string } } } };
    expect(decision.params.subscriptionId).toBe(subscriptionId);
    expect(decision.params.event.payload).toMatchObject({ outcome: "deny", toolName: "view" });
    expect(decision.params.event.payload.reason).toContain("bulk-reader");
    const audit = readFileSync(join(picaDataDir(home), "audit", "audit.jsonl"), "utf8").trim().split("\n");
    const audited = audit.map((line) => JSON.parse(line) as { kind: string; data: { outcome?: string; toolName?: string } });
    const denied = audited.filter((entry) => entry.kind === "policy.decision" && entry.data.outcome === "deny");
    expect(denied.map((entry) => entry.data.toolName)).toEqual(["view"]);
  });
});

describe("E-11 picad startup", () => {
  it("exits before its ready line when the user config does not validate, naming the file", { timeout: 30_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), "picad-"));
    try {
      const config = join(picaDataDir(home), "config.jsonc");
      mkdirSync(picaDataDir(home), { recursive: true });
      writeFileSync(config, '{ "routing": { "profile": "fastest" } }\n');
      const main = join(import.meta.dirname, "..", "..", "src", "main.ts");
      const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", main, "--socket", join(home, "s")], {
        env: { ...process.env, HOME: home },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain(config);
      expect(stderr).toContain("routing.profile");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
