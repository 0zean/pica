import type { CustomizationKind } from "@pica/protocol";
import type { Result } from "../result.ts";
import type { FrontmatterParser } from "./describe.ts";
import type { CustomizationError } from "./errors.ts";
import type { CustomizationRoots, LocationLayout } from "./locations.ts";

export interface CustomizationScope {
  readonly workspaceId?: string | undefined;
  readonly repoId?: string | undefined;
}

export interface CustomizationFile {
  readonly path: string;
  readonly text: string;
}

export interface CustomizationFiles {
  // The files of one location, sorted by path; a missing folder or file is an empty location.
  list(path: string, layout: LocationLayout): Result<readonly CustomizationFile[], CustomizationError>;
  exists(path: string): boolean;
  // Creates the folders above `path` and replaces the file atomically.
  write(path: string, text: string): Result<undefined, CustomizationError>;
  // Removes the file, then its folder when `pruneFolder` is set and the folder is left empty.
  remove(path: string, pruneFolder: boolean): Result<undefined, CustomizationError>;
}

export interface CustomizationDeps {
  readonly roots: (scope: CustomizationScope) => Result<CustomizationRoots, CustomizationError>;
  readonly files: CustomizationFiles;
  readonly parse: FrontmatterParser;
  // The managed policy id that locks this kind (H-01), if any.
  readonly lockedBy: (kind: CustomizationKind) => string | undefined;
}
