// Whether git can be run at all (A-15's onboarding check). `missing` carries what running it answered,
// e.g. macOS's `/usr/bin/git` stub asking for the Command Line Tools.
export interface GitInstallation {
  readonly status: "installed" | "missing";
  readonly version: string | null;
  readonly message: string | null;
}

// "git version 2.39.5 (Apple Git-154)\n" → "2.39.5 (Apple Git-154)"
export function parseGitVersion(stdout: string): string | null {
  const version = /^git version (.+)$/m.exec(stdout)?.[1]?.trim();
  return version === undefined || version === "" ? null : version;
}
