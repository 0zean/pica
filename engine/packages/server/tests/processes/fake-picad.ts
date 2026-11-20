// `picad` as `main.ts` composes it, with a FakeRuntime in place of the Copilot runtime, for the
// app's tests (A-01). The app starts it the way it starts the real engine: `--socket <path>`, the
// ready line on stdout, JSON log lines on stderr, SIGTERM to stop, exit code 1 when the
// composition fails. PICA_TEST_HOME stands in for the home directory, so the data directory is
// `$PICA_TEST_HOME/Library/Application Support/Pica/`. PICA_TEST_SCENARIO names the FakeRuntime's
// scenario in `fake-picad-scenarios.ts` (default `empty`). PICA_TEST_MANAGED_POLICY names a policy
// file (JSONC, docs/managed-policy.md) to load as if root owned it (A-14). PICA_TEST_GITHUB (`signed-in` or
// `signed-out`) points GitHub discovery at the stub server in `fake-github.ts` (A-12).
import { parseArgs } from "node:util";
import { ManagedPolicyLoader, nodeManagedPolicyFileSystem } from "@pica/adapters";
import type { ManagedPolicyFileSystem } from "@pica/adapters";
import { createSecretScrubber, createStructuredLog } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { composeEngine, startEngine } from "../../src/index.ts";
import { fakePicadScenarios } from "./fake-picad-scenarios.ts";
import { startFakeGitHub } from "./fake-github.ts";

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
  const github = await fakeGitHub(process.env["PICA_TEST_GITHUB"]);
  const composed = composeEngine({
    homeDir,
    userName: "tester",
    env: {},
    log,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: testManagedPolicy(process.env["PICA_TEST_MANAGED_POLICY"]),
    ...(github === undefined ? {} : { github: github.access }),
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

async function fakeGitHub(mode: string | undefined): Promise<Awaited<ReturnType<typeof startFakeGitHub>> | undefined> {
  if (mode === undefined) return undefined;
  if (mode !== "signed-in" && mode !== "signed-out") {
    throw new Error(`PICA_TEST_GITHUB must be signed-in or signed-out, not ${JSON.stringify(mode)}`);
  }
  return startFakeGitHub(mode);
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
