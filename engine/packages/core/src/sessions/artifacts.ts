import type { Result } from "../result.ts";

export interface SessionArtifactError {
  readonly code: "artifact.write_failed";
  readonly message: string;
}

// Files the engine keeps beside a session, such as tool output too large for the model's context.
export interface SessionArtifacts {
  /** Writes `content` as UTF-8 and returns the absolute path an agent can read it from. */
  write(sessionId: string, name: string, content: string): Promise<Result<{ readonly path: string }, SessionArtifactError>>;
}
