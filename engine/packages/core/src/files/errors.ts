export type FilesErrorCode =
  | "files.repo_not_found"
  | "files.workspace_not_found"
  | "files.not_cloned"
  | "files.outside_repo"
  | "files.not_found"
  | "files.binary"
  | "files.io_failed";

export interface FilesError {
  readonly code: FilesErrorCode;
  readonly message: string;
}

export function filesError(code: FilesErrorCode, message: string): FilesError {
  return { code, message };
}
