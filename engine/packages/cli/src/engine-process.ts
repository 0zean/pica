import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { EngineConnection } from "./client.ts";
import { EngineError } from "./errors.ts";

export interface EngineLocation {
  readonly socketPath: string;
  // The `picad` entry script to run when no engine is listening.
  readonly entry: string;
  readonly startTimeoutMs: number;
}

export interface ConnectedEngine {
  readonly connection: EngineConnection;
  readonly started: boolean;
}

// Reuses the engine listening on the socket, or starts one that outlives this command.
export async function connectToEngine(location: EngineLocation): Promise<ConnectedEngine> {
  const existing = await tryOpen(location.socketPath);
  if (existing !== undefined) {
    return { connection: await handshake(existing), started: false };
  }
  const failure = await startEngine(location);
  const started = await tryOpen(location.socketPath);
  if (started === undefined) {
    throw failure ?? new EngineError("engine_unreachable", `The engine started but ${location.socketPath} does not answer.`);
  }
  // A failed start is fine when another `pica` won the race and its engine now answers.
  return { connection: await handshake(started), started: failure === undefined };
}

async function tryOpen(socketPath: string): Promise<EngineConnection | undefined> {
  try {
    return await EngineConnection.open(socketPath);
  } catch {
    return undefined;
  }
}

async function handshake(connection: EngineConnection): Promise<EngineConnection> {
  try {
    await connection.hello();
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function logPath(socketPath: string): string {
  return join(dirname(socketPath), "picad.log");
}

// Resolves once `picad` prints its ready line; returns the reason when it exits first instead.
async function startEngine(location: EngineLocation): Promise<EngineError | undefined> {
  mkdirSync(dirname(location.socketPath), { recursive: true, mode: 0o700 });
  const log = openSync(logPath(location.socketPath), "a", 0o600);
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", location.entry, "--socket", location.socketPath],
    { detached: true, stdio: ["ignore", "pipe", log] },
  );
  closeSync(log);
  const stdout = child.stdout;
  if (stdout === null) {
    throw new Error("spawn did not open the stdout pipe it was asked for");
  }
  const exited = new Promise<EngineError>((resolve) => {
    child.once("error", (error) => {
      resolve(new EngineError("engine_start_failed", `Could not start picad: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      const how = signal === null ? `code ${String(code)}` : `signal ${signal}`;
      resolve(
        new EngineError("engine_start_failed", `picad exited with ${how} before it was ready; see ${logPath(location.socketPath)}.`),
      );
    });
  });
  const ready = readyLine(stdout);
  const timedOut = new Promise<EngineError>((resolve) => {
    setTimeout(() => {
      resolve(new EngineError("engine_start_timeout", `picad was not ready within ${String(location.startTimeoutMs)} ms.`));
    }, location.startTimeoutMs).unref();
  });
  const outcome = await Promise.race([ready.then(() => undefined), exited, timedOut]);
  stdout.destroy();
  if (outcome !== undefined && child.exitCode === null) {
    child.kill();
  }
  child.unref();
  return outcome;
}

async function readyLine(stdout: Readable): Promise<void> {
  for await (const line of createInterface({ input: stdout })) {
    if (isReady(line)) {
      return;
    }
  }
  return new Promise(() => undefined);
}

function isReady(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && "ready" in parsed && parsed.ready === true;
  } catch {
    return false;
  }
}
