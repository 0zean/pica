import { spawn } from "node:child_process";
import type { HookProcessOutcome, HookProcessRequest, HookProcessRunner } from "@pica/core";

// Starts a timer and returns a function that cancels it. Tests pass one they fire themselves.
export type HookTimer = (ms: number, onTimeout: () => void) => () => void;

export interface ShellHookRunnerOptions {
  readonly shell?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timer?: HookTimer;
  readonly maxOutputBytes?: number;
}

const defaultMaxOutputBytes = 64 * 1024;

const realTimer: HookTimer = (ms, onTimeout) => {
  const handle = setTimeout(onTimeout, ms);
  return () => {
    clearTimeout(handle);
  };
};

export function createShellHookRunner(options: ShellHookRunnerOptions = {}): HookProcessRunner {
  const shell = options.shell ?? "/bin/sh";
  const timer = options.timer ?? realTimer;
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  return {
    run: (request) => runHook(shell, options.env ?? process.env, timer, maxOutputBytes, request),
  };
}

function runHook(
  shell: string,
  baseEnv: Readonly<Record<string, string | undefined>>,
  timer: HookTimer,
  maxOutputBytes: number,
  request: HookProcessRequest,
): Promise<HookProcessOutcome> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout kills whatever the hook started as well.
    const child = spawn(shell, ["-c", request.command], {
      cwd: request.cwd,
      env: { ...baseEnv, ...request.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const output: Buffer[] = [];
    const collect = (chunk: Buffer): void => {
      output.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const cancel = timer(request.timeoutMs, () => {
      timedOut = true;
      killGroup(child.pid);
    });
    child.on("error", (error) => {
      cancel();
      resolve({ kind: "not_started", message: error.message });
    });
    child.on("close", (code, signal) => {
      cancel();
      const text = tail(Buffer.concat(output), maxOutputBytes);
      if (timedOut) {
        resolve({ kind: "timed_out", output: text });
        return;
      }
      resolve({ kind: "exited", exitCode: code ?? signalExitCode(signal), output: text });
    });
  });
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}

// The shell convention: 128 plus the signal number, or 1 when it is unknown.
function signalExitCode(signal: NodeJS.Signals | null): number {
  const signals: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
  const number = signal === null ? undefined : signals[signal];
  return number === undefined ? 1 : 128 + number;
}

function tail(buffer: Buffer, maxBytes: number): string {
  if (buffer.length <= maxBytes) {
    return buffer.toString("utf8");
  }
  return `[… ${String(buffer.length - maxBytes)} bytes trimmed]\n${buffer.subarray(buffer.length - maxBytes).toString("utf8")}`;
}
