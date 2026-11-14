export interface LanguageShare {
  readonly name: string;
  readonly files: number;
}

export interface OwnerRule {
  readonly pattern: string;
  readonly owners: readonly string[];
}

export interface RepoCard {
  readonly name: string;
  readonly commit: string;
  readonly languages: readonly LanguageShare[];
  readonly manifests: readonly string[];
  readonly build: readonly string[];
  readonly test: readonly string[];
  readonly owners: readonly OwnerRule[];
  readonly entryPoints: readonly string[];
}

// Everything a card is computed from: the tracked paths at one commit and the contents of the
// files `cardInputFiles` asked for (absent when the file could not be read).
export interface RepoSnapshot {
  readonly name: string;
  readonly commit: string;
  readonly paths: readonly string[];
  readonly files: ReadonlyMap<string, string>;
}
