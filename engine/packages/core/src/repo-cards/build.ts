import { detectCommands } from "./commands.ts";
import { detectEntryPoints } from "./entry-points.ts";
import { countLanguages } from "./languages.ts";
import { findManifests } from "./manifests.ts";
import { detectOwners } from "./owners.ts";
import { parsePackageJson } from "./package-json.ts";
import type { RepoCard, RepoSnapshot } from "./types.ts";

// Pure: the same snapshot always yields the same card, whatever order its paths arrive in.
export function buildRepoCard(snapshot: RepoSnapshot): RepoCard {
  const paths = [...new Set(snapshot.paths)].sort();
  const pathSet = new Set(paths);
  const packageText = snapshot.files.get("package.json");
  const packageJson = packageText === undefined ? undefined : parsePackageJson(packageText);
  const commands = detectCommands({ paths: pathSet, files: snapshot.files, packageJson });
  return {
    name: snapshot.name,
    commit: snapshot.commit,
    languages: countLanguages(paths),
    manifests: findManifests(paths),
    build: commands.build,
    test: commands.test,
    owners: detectOwners(snapshot.files),
    entryPoints: detectEntryPoints({ paths, files: snapshot.files, packageJson }),
  };
}
