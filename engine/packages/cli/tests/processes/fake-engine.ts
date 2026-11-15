// `picad` with a FakeRuntime, for CLI end-to-end tests. The CLI starts it with `--socket`, the
// way it starts the real engine; the rest comes from the environment the test gives the CLI:
// PICA_TEST_DB, PICA_TEST_SCENARIO, and PICA_TEST_STARTS (a file that gets one line per start).
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
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
import { workspaceOptions } from "../../../server/src/composition-workspaces.ts";

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

// Credits per million tokens; model-a is priced as the reasoning tier, model-b as a worker.
const reasoningPrices = { input: 300, cachedInput: 30, output: 1500 };
const prices = new Map([
  ["model-a", reasoningPrices],
  ["model-b", { input: 25, cachedInput: 2.5, output: 125 }],
]);

const ids = sequentialIds();
// E-11: workspaces and the repo registry as `picad` composes them, so `pica workspace` and `pica repo` work.
const workspaceIds = sequentialIds();
const listener = await startEngine({
  socketPath: required("--socket", values.socket),
  log: silentLogger,
  ...workspaceOptions({
    store: store.value,
    dataDir: dirname(required("PICA_TEST_DB", process.env["PICA_TEST_DB"])),
    env: process.env,
    newId: () => workspaceIds("id"),
  }),
  sessions: {
    store: store.value,
    runtime: new FakeRuntime({
      scenario: scenario.value,
      clock: steppingClock("2026-11-14T10:00:00.000Z"),
      ids: sequentialIds(),
    }),
    clock: steppingClock("2026-11-14T09:00:00.000Z"),
    newSessionId: () => ids("session"),
    usage: { pricesFor: (model) => prices.get(model) ?? null, reasoningPrices: () => reasoningPrices },
  },
});
appendFileSync(required("PICA_TEST_STARTS", process.env["PICA_TEST_STARTS"]), `${String(process.pid)}\n`);
process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
