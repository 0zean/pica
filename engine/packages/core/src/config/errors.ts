export type ConfigErrorCode = "config.read_failed" | "config.parse_error" | "config.invalid" | "config.inline_secret";

export interface ConfigIssue {
  readonly keyPath: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  readonly file: string;
  readonly issues: readonly ConfigIssue[];
}

export function configError(code: ConfigErrorCode, file: string, issues: readonly ConfigIssue[]): ConfigError {
  const lines = issues.map((issue) => `${file}${position(issue)}: ${issue.keyPath || "(root)"}: ${issue.message}`);
  return { code, file, issues, message: lines.join("\n") };
}

function position(issue: ConfigIssue): string {
  if (issue.line === undefined) {
    return "";
  }
  return issue.column === undefined ? `:${String(issue.line)}` : `:${String(issue.line)}:${String(issue.column)}`;
}
