import { join } from "node:path";
import type { ManagedPolicyCandidate } from "./managed-policy-loader.ts";

// The app's bundle identifier; MDM profiles target it as the preferences domain.
export const managedPreferencesDomain = "dev.pica.Pica";

export const managedPolicyFilePath = "/Library/Application Support/Pica/policy.jsonc";

const managedPreferencesRoot = "/Library/Managed Preferences";

// Device-wide payloads first, then payloads scoped to the user.
export function managedPreferencesPaths(userName: string, domain: string = managedPreferencesDomain): string[] {
  return [join(managedPreferencesRoot, `${domain}.plist`), join(managedPreferencesRoot, userName, `${domain}.plist`)];
}

// Managed preferences (MDM) take precedence over the policy file.
export function managedPolicyCandidates(userName: string): ManagedPolicyCandidate[] {
  return [
    ...managedPreferencesPaths(userName).map((path) => ({ format: "plist" as const, path })),
    { format: "jsonc" as const, path: managedPolicyFilePath },
  ];
}
