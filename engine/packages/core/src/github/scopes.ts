// Classic OAuth scopes that grant a narrower scope (docs.github.com, "Scopes for OAuth apps").
const impliedBy: Readonly<Record<string, readonly string[]>> = {
  "read:org": ["write:org", "admin:org"],
  "write:org": ["admin:org"],
  public_repo: ["repo"],
  "repo:status": ["repo"],
  repo_deployment: ["repo"],
  "repo:invite": ["repo"],
  security_events: ["repo"],
  "read:user": ["user"],
  "user:email": ["user"],
  "user:follow": ["user"],
  "read:public_key": ["write:public_key", "admin:public_key"],
  "write:public_key": ["admin:public_key"],
  "read:repo_hook": ["write:repo_hook", "admin:repo_hook"],
  "write:repo_hook": ["admin:repo_hook"],
  "read:gpg_key": ["write:gpg_key", "admin:gpg_key"],
  "write:gpg_key": ["admin:gpg_key"],
  "read:packages": ["write:packages"],
  "read:project": ["project"],
};

// Parses `X-OAuth-Scopes` / `X-Accepted-OAuth-Scopes`. An absent header means the token type has no
// classic scopes (fine-grained PAT, GitHub App), which is reported as null rather than "no scopes".
export function parseScopeHeader(value: string | null | undefined): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

export function hasScope(granted: readonly string[], needed: string): boolean {
  return granted.includes(needed) || (impliedBy[needed] ?? []).some((wider) => granted.includes(wider));
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !hasScope(granted, scope));
}

// GitHub lists every scope that would have worked; the read-only one is the least to ask for.
export function narrowestScope(accepted: readonly string[]): string | undefined {
  return accepted.find((scope) => scope.startsWith("read:")) ?? accepted[0];
}
