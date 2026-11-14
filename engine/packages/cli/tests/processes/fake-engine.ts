// `picad` with a FakeRuntime, for CLI end-to-end tests. The CLI starts it with `--socket`, the
// way it starts the real engine; the rest comes from the environment the test gives the CLI:
// PICA_TEST_DB, PICA_TEST_SCENARIO, and PICA_TEST_STARTS (a file that gets one line per start).
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
// The store and runtime entries, not the package indexes: those also load Copilot modules whose
// parameter properties Node's type stripping rejects.
import { openSqliteStore } from "../../../adapters/src/store/index.ts";
import {
  FakeRuntime,
  formatScenarioError,
  loadScenarioFile,
  sequentialIds,
  steppingClock,
} from "../../../testkit/src/runtime/index.ts";
import { silentLogger, startEngine } from "../../../server/src/index.ts";

function required(name: string, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const { values } = parseArgs({ options: { socket: { type: "string" } } });
const scenario = loadScenarioFile(required("PICA_TEST_SCENARIO", process.env["PICA_TEST_SCENARIO"]));
if (!scenario.ok) {
  throw new Error(formatScenarioError(scenario.error));
}
const store = openSqliteStore(required("PICA_TEST_DB", process.env["PICA_TEST_DB"]));
if (!store.ok) {
  throw new Error(store.error.message);
}
store.value.repos.save({
  id: "repo-1",
  remoteUrl: "https://github.com/acme/api",
  localPath: "/src/acme/api",
  managed: false,
  defaultBranch: "main",
  cloneState: "ready",
});
store.value.workspaces.save({ id: "ws-1", name: "Payments", sources: [], pinnedRepoIds: [], settingsOverrides: {} });

const ids = sequentialIds();
const listener = await startEngine({
  socketPath: required("--socket", values.socket),
  log: silentLogger,
  sessions: {
    store: store.value,
    runtime: new FakeRuntime({
      scenario: scenario.value,
      clock: steppingClock("2026-11-14T10:00:00.000Z"),
      ids: sequentialIds(),
    }),
    clock: steppingClock("2026-11-14T09:00:00.000Z"),
    newSessionId: () => ids("session"),
  },
});
appendFileSync(required("PICA_TEST_STARTS", process.env["PICA_TEST_STARTS"]), `${String(process.pid)}\n`);
process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
