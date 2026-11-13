import { err } from "../result.ts";

export type GitErrorCode =
  | "git.not_installed"
  | "git.not_a_repository"
  | "git.invalid_argument"
  | "git.unknown_revision"
  | "git.nothing_to_commit"
  | "git.push_rejected"
  | "git.command_failed"
  | "git.parse_failed";

export interface GitError {
  readonly code: GitErrorCode;
  readonly message: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

export function parseFailed(what: string, detail: string): { readonly ok: false; readonly error: GitError } {
  return err({ code: "git.parse_failed", message: `could not parse ${what}: ${detail}` });
}
