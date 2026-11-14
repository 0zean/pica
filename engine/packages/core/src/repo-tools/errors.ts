export type RepoToolErrorCode =
  | "repo_tools.repo_not_found"
  | "repo_tools.repo_ambiguous"
  | "repo_tools.outside_workspace"
  | "repo_tools.not_a_file"
  | "repo_tools.not_cloned"
  | "repo_tools.invalid_arguments"
  | "repo_tools.io_failed";

export interface RepoToolError {
  readonly code: RepoToolErrorCode;
  readonly message: string;
  // Set for `repo_tools.repo_ambiguous`: the qualified names that match.
  readonly candidates?: readonly string[];
}

export function repoToolError(code: RepoToolErrorCode, message: string): RepoToolError {
  return { code, message };
}
