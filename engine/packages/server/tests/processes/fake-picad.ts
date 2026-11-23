// `picad` as `main.ts` composes it, with a FakeRuntime in place of the Copilot runtime, for the
// app's tests (A-01). The app starts it the way it starts the real engine: `--socket <path>`, the
// ready line on stdout, JSON log lines on stderr, SIGTERM to stop, exit code 1 when the
// composition fails. PICA_TEST_HOME stands in for the home directory, so the data directory is
// `$PICA_TEST_HOME/Library/Application Support/Pica/`. PICA_TEST_SCENARIO names the FakeRuntime's
// scenario in `fake-picad-scenarios.ts` (default `empty`). PICA_TEST_MANAGED_POLICY names a policy
// file (JSONC, docs/managed-policy.md) to load as if root owned it (A-14). PICA_TEST_GITHUB (`signed-in` or
// `signed-out`) points GitHub discovery at the stub server in `fake-github.ts` (A-12). The `mcp` scenario
// also starts a stub MCP server and sends the GitHub preset's endpoint to it; it asks for the bearer
// token `fakePicadMcpToken` (A-13). PICA_TEST_PRECONDITIONS names the file onboarding's checks read
// (`fake-preconditions.ts`, A-15); without PICA_TEST_GITHUB it also starts the stub GitHub server.
// PICA_TEST_RESUMABLE lists, comma-separated, the session ids an earlier engine left that the runtime can resume;
// a session not listed cannot be resumed, as after Copilot lost its state.
import { parseArgs } from "node:util";
import { ManagedPolicyLoader, nodeManagedPolicyFileSystem } from "@pica/adapters";
import type { ManagedPolicyFileSystem } from "@pica/adapters";
import { createSecretScrubber, createStructuredLog } from "@pica/core";
import { FakeRuntime, redirectingFetch, scenarioSchema, sequentialIds, startStubMcpServer, steppingClock } from "@pica/testkit";
import type { McpHttpFetch } from "@pica/adapters";
import { composeEngine, startEngine } from "../../src/index.ts";
import { fakePicadScenarios } from "./fake-picad-scenarios.ts";
import { startFakeGitHub } from "./fake-github.ts";
import type { FakeGitHubMode } from "./fake-github.ts";
import { fakeCopilotAccount, fakeGitInstall, readFakePreconditions } from "./fake-preconditions.ts";

const log = createStructuredLog({
  write: (line) => {
    process.stderr.write(`${line}\n`);
  },
  clock: () => new Date().toISOString(),
  redactor: createSecretScrubber(),
}).logger("picad");

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { socket: { type: "string" } } });
  const socketPath = values.socket;
  const homeDir = process.env["PICA_TEST_HOME"];
  if (socketPath === undefined || homeDir === undefined) {
    throw new Error("fake-picad needs --socket and PICA_TEST_HOME");
  }
  const scenarioName = process.env["PICA_TEST_SCENARIO"] ?? "empty";
  const named = fakePicadScenarios[scenarioName];
  if (named === undefined) {
    throw new Error(`fake-picad has no scenario ${JSON.stringify(scenarioName)}`);
  }
  const scenario = scenarioSchema.parse(named);
  const mcpFetch = scenarioName === "mcp" ? await stubMcpFetch() : undefined;
  const preconditions = process.env["PICA_TEST_PRECONDITIONS"];
  const github = await fakeGitHub(gitHubMode(process.env["PICA_TEST_GITHUB"], preconditions));
  const resumable = process.env["PICA_TEST_RESUMABLE"];
  const runtime = new FakeRuntime({
    scenario,
    clock: steppingClock("2026-11-16T10:00:00.000Z"),
    ids: sequentialIds(),
    ...(resumable === undefined || resumable === "" ? {} : { resumableSessionIds: resumable.split(",") }),
  });
  // FakeRuntime has no signed-in account; onboarding's checks give it one (`engine.account`).
  if (preconditions !== undefined) Object.assign(runtime, { account: fakeCopilotAccount(preconditions) });
  const composed = composeEngine({
    homeDir,
    userName: "tester",
    env: {},
    log,
    runtime,
    managedPolicy: testManagedPolicy(process.env["PICA_TEST_MANAGED_POLICY"]),
    ...(mcpFetch === undefined ? {} : { mcpFetch }),
    ...(github === undefined ? {} : { github: github.access }),
    ...(preconditions === undefined ? {} : { gitInstall: fakeGitInstall(preconditions) }),
  });
  const listener = await startEngine({ socketPath, log, ...composed.options });
  const stop = (): void => {
    void listener
      .close()
      .then(() => composed.close())
      .then(() => github?.stub.close())
      .then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
}

export const fakePicadMcpToken = "pica-ui-test-token";

async function stubMcpFetch(): Promise<McpHttpFetch> {
  const stub = await startStubMcpServer({
    tools: [
      { name: "search_code", description: "Search code across repositories.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      { name: "get_issue", description: "Read an issue.", inputSchema: { type: "object", properties: { number: { type: "integer" } } } },
    ],
    bearerToken: fakePicadMcpToken,
  });
  return redirectingFetch({ "https://api.githubcopilot.com": stub.url });
}

function gitHubMode(fixed: string | undefined, preconditions: string | undefined): (() => FakeGitHubMode) | undefined {
  if (fixed !== undefined) {
    if (fixed !== "signed-in" && fixed !== "signed-out") {
      throw new Error(`PICA_TEST_GITHUB must be signed-in or signed-out, not ${JSON.stringify(fixed)}`);
    }
    return () => fixed;
  }
  if (preconditions === undefined) return undefined;
  return () => readFakePreconditions(preconditions).github;
}

async function fakeGitHub(mode: (() => FakeGitHubMode) | undefined): Promise<Awaited<ReturnType<typeof startFakeGitHub>> | undefined> {
  return mode === undefined ? undefined : startFakeGitHub(mode);
}

function testManagedPolicy(path: string | undefined): ManagedPolicyLoader {
  if (path === undefined) return new ManagedPolicyLoader([]);
  const rootOwned: ManagedPolicyFileSystem = {
    ...nodeManagedPolicyFileSystem,
    ownership: (target) => ({ uid: 0, mode: nodeManagedPolicyFileSystem.ownership(target).mode & ~0o022 }),
  };
  return new ManagedPolicyLoader([{ format: "jsonc", path }], rootOwned);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
