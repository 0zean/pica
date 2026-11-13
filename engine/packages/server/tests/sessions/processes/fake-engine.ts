// An engine whose runtime is a FakeRuntime, run as its own process so a test can kill it.
// Usage: fake-engine.ts --socket <path> --db <path> --scenario <file> [--resumable <id,...>]
import { parseArgs } from "node:util";
// The store and runtime entries, not the package indexes: those also load Copilot modules whose
// parameter properties Node's type stripping rejects.
import { openSqliteStore } from "../../../../adapters/src/store/index.ts";
import { FakeRuntime, formatScenarioError, loadScenarioFile, sequentialIds } from "../../../../testkit/src/runtime/index.ts";
import { silentLogger, startEngine } from "../../../src/index.ts";

const { values } = parseArgs({
  options: {
    socket: { type: "string" },
    db: { type: "string" },
    scenario: { type: "string" },
    resumable: { type: "string", default: "" },
  },
});

function required(name: string, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

const scenario = loadScenarioFile(required("scenario", values.scenario));
if (!scenario.ok) {
  throw new Error(formatScenarioError(scenario.error));
}
const store = openSqliteStore(required("db", values.db));
if (!store.ok) {
  throw new Error(store.error.message);
}
const ids = sequentialIds();
const listener = await startEngine({
  socketPath: required("socket", values.socket),
  log: silentLogger,
  sessions: {
    store: store.value,
    runtime: new FakeRuntime({
      scenario: scenario.value,
      resumableSessionIds: values.resumable === "" ? [] : values.resumable.split(","),
    }),
    newSessionId: () => ids("session"),
  },
});
process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
