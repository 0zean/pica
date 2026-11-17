// `picad` as `main.ts` composes it, with a FakeRuntime in place of the Copilot runtime, for the
// app's tests (A-01). The app starts it the way it starts the real engine: `--socket <path>`, the
// ready line on stdout, JSON log lines on stderr, SIGTERM to stop, exit code 1 when the
// composition fails. PICA_TEST_HOME stands in for the home directory, so the data directory is
// `$PICA_TEST_HOME/Library/Application Support/Pica/`. PICA_TEST_SCENARIO names the FakeRuntime's
// scenario in `fake-picad-scenarios.ts` (default `empty`).
import { parseArgs } from "node:util";
import { ManagedPolicyLoader } from "@pica/adapters";
import { createSecretScrubber, createStructuredLog } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { composeEngine, startEngine } from "../../src/index.ts";
import { fakePicadScenarios } from "./fake-picad-scenarios.ts";

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
  const composed = composeEngine({
    homeDir,
    userName: "tester",
    env: {},
    log,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener = await startEngine({ socketPath, log, ...composed.options });
  const stop = (): void => {
    void listener
      .close()
      .then(() => composed.close())
      .then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
