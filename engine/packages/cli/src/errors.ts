// 1 is left to Node for uncaught exceptions, so a crash never looks like one of these.
export const ExitCode = {
  ok: 0,
  usage: 2,
  engine: 3,
  session: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// The command line could not be understood; nothing was sent to the engine.
export class UsageError extends Error {
  readonly exitCode = ExitCode.usage;
  readonly code = "usage";
}

// The engine could not be started or reached, or it answered a request with an error.
export class EngineError extends Error {
  readonly exitCode = ExitCode.engine;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// The engine worked, but the session did not: the turn reported an error, the session failed,
// or it would not accept the message.
export class SessionFailure extends Error {
  readonly exitCode = ExitCode.session;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type CliError = UsageError | EngineError | SessionFailure;

export function isCliError(error: unknown): error is CliError {
  return error instanceof UsageError || error instanceof EngineError || error instanceof SessionFailure;
}
