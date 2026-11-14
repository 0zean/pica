import { DEFAULT_SOCKET_PATH, ENGINE_ENTRY } from "@pica/server";
import { HELP, parseInvocation } from "./args.ts";
import type { Invocation } from "./args.ts";
import { runCommand } from "./commands.ts";
import { connectToEngine } from "./engine-process.ts";
import { ExitCode, isCliError } from "./errors.ts";
import type { ExitCodeValue } from "./errors.ts";

export interface CliEnvironment {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const START_TIMEOUT_MS = 10_000;

export async function runCli(argv: readonly string[], environment: CliEnvironment): Promise<ExitCodeValue> {
  let invocation: Invocation | undefined;
  try {
    invocation = parseInvocation(argv);
    const { command } = invocation;
    if (command.kind === "help") {
      environment.stdout(HELP);
      return ExitCode.ok;
    }
    const { connection } = await connectToEngine({
      socketPath: invocation.socketPath ?? environment.env["PICA_SOCKET"] ?? DEFAULT_SOCKET_PATH,
      entry: environment.env["PICA_ENGINE_ENTRY"] ?? ENGINE_ENTRY,
      startTimeoutMs: START_TIMEOUT_MS,
    });
    try {
      await runCommand(command, connection, {
        json: invocation.json,
        write: (line) => {
          environment.stdout(`${line}\n`);
        },
      });
    } finally {
      connection.close();
    }
    return ExitCode.ok;
  } catch (error) {
    if (!isCliError(error)) {
      throw error;
    }
    const json = invocation?.json ?? argv.includes("--json");
    environment.stderr(
      json ? `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n` : `pica: ${error.message}\n`,
    );
    return error.exitCode;
  }
}
