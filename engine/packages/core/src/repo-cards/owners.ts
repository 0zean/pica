import { codeownersPaths } from "./manifests.ts";
import type { OwnerRule } from "./types.ts";

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [pattern, ...rest] = trimmed.split(/\s+/);
    const comment = rest.findIndex((token) => token.startsWith("#"));
    const owners = comment === -1 ? rest : rest.slice(0, comment);
    if (pattern !== undefined && owners.length > 0) rules.push({ pattern, owners });
  }
  return rules;
}

// Only the first CODEOWNERS file in GitHub's lookup order applies, as on GitHub.
export function detectOwners(files: ReadonlyMap<string, string>): OwnerRule[] {
  for (const path of codeownersPaths) {
    const text = files.get(path);
    if (text !== undefined) return parseCodeowners(text);
  }
  return [];
}
