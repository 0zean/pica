import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

const CLI_MAIN = join(import.meta.dirname, "..", "src", "main.ts");
export const FAKE_ENGINE = join(import.meta.dirname, "processes", "fake-engine.ts");
export const README_SCENARIO = join(import.meta.dirname, "scenarios", "readme.jsonc");

// Each command is a fresh Node process; on a loaded machine one test can take several seconds.
export const PROCESS_TEST_TIMEOUT_MS = 60_000;

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliHarness {
  readonly dir: string;
  readonly socketPath: string;
  // `cwd` is the directory `pica` runs in; relative paths in its arguments resolve against it.
  run(args: readonly string[], env?: Readonly<Record<string, string>>, cwd?: string): Promise<CliRun>;
  // The pid of every engine the CLI started, in order.
  engineStarts(): Promise<string[]>;
  stop(): Promise<void>;
}

export async function cliHarness(scenarioPath = README_SCENARIO): Promise<CliHarness> {
  const dir = await mkdtemp(join(tmpdir(), "pica-cli-"));
  const socketPath = join(dir, "run", "picad.sock");
  const startsPath = join(dir, "starts.log");
  await writeFile(startsPath, "");
  const baseEnv = {
    PICA_SOCKET: socketPath,
    PICA_ENGINE_ENTRY: FAKE_ENGINE,
    PICA_TEST_DB: join(dir, "pica.db"),
    PICA_TEST_SCENARIO: scenarioPath,
    PICA_TEST_STARTS: startsPath,
  };
  let stopped = false;
  return {
    dir,
    socketPath,
    // A test that timed out keeps running; refusing here stops it starting engines after teardown.
    run: (args, env = {}, cwd = process.cwd()) =>
      stopped ? Promise.reject(new Error("the harness is stopped")) : runCli(args, { ...baseEnv, ...env }, cwd),
    engineStarts: async () => (await readFile(startsPath, "utf8")).split("\n").filter((line) => line !== ""),
    stop: async () => {
      stopped = true;
      stopEngines(dir);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function runCli(args: readonly string[], env: Readonly<Record<string, string>>, cwd: string): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", CLI_MAIN, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : (error.code as number), stdout, stderr });
      },
    );
  });
}

// Engines the CLI starts outlive it by design; every one of them has the test's directory in its argv.
function stopEngines(dir: string): void {
  try {
    execFileSync("pkill", ["-f", dir]);
  } catch {
    // pkill exits 1 when nothing matched.
  }
}

export async function expectGolden(name: string, actual: string): Promise<void> {
  const path = join(import.meta.dirname, "golden", name);
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await writeFile(path, actual);
  }
  expect(actual).toBe(await readFile(path, "utf8"));
}
