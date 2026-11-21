import type { CustomizationItem, CustomizationKind, CustomizationLocation } from "@pica/protocol";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { describeFile, isValidItemName } from "./describe.ts";
import { customizationError } from "./errors.ts";
import type { CustomizationError } from "./errors.ts";
import { customizationLocations, publicLocation } from "./locations.ts";
import type { LocationSpec } from "./locations.ts";
import type { CustomizationDeps, CustomizationScope } from "./ports.ts";
import { resolveCustomizations } from "./resolve.ts";

export interface CustomizationListing {
  readonly items: readonly CustomizationItem[];
  readonly locations: readonly CustomizationLocation[];
}

export interface CustomizationCreate {
  readonly kind: CustomizationKind;
  readonly locationId: string;
  readonly name?: string | undefined;
  readonly text: string;
}

export interface CustomizationService {
  list(kind: CustomizationKind, scope: CustomizationScope): Result<CustomizationListing, CustomizationError>;
  create(request: CustomizationCreate, scope: CustomizationScope): Result<CustomizationItem, CustomizationError>;
  save(kind: CustomizationKind, path: string, text: string, scope: CustomizationScope): Result<CustomizationItem, CustomizationError>;
  remove(kind: CustomizationKind, path: string, scope: CustomizationScope): Result<undefined, CustomizationError>;
}

// X-02: discovery and editing of agents, skills and instruction files (docs/agents.md). Nothing
// is written that does not validate as the readers of that kind read it.
export function createCustomizationService(deps: CustomizationDeps): CustomizationService {
  const specsFor = (kind: CustomizationKind, scope: CustomizationScope): Result<LocationSpec[], CustomizationError> => {
    const roots = deps.roots(scope);
    return roots.ok ? ok(customizationLocations(kind, roots.value, deps.lockedBy(kind))) : roots;
  };

  const listSpecs = (specs: readonly LocationSpec[]): Result<CustomizationListing, CustomizationError> => {
    const described = [];
    for (const spec of specs) {
      const files = deps.files.list(spec.path, spec.layout);
      if (!files.ok) return files;
      described.push(...files.value.map((file) => describeFile(spec, file.path, file.text, deps.parse)));
    }
    return ok({ items: resolveCustomizations(described), locations: specs.map(publicLocation) });
  };

  const list = (kind: CustomizationKind, scope: CustomizationScope): Result<CustomizationListing, CustomizationError> => {
    const specs = specsFor(kind, scope);
    return specs.ok ? listSpecs(specs.value) : specs;
  };

  const writeChecked = (
    spec: LocationSpec,
    path: string,
    text: string,
    scope: CustomizationScope,
  ): Result<CustomizationItem, CustomizationError> => {
    const writable = checkWritable(spec);
    if (!writable.ok) return writable;
    const described = describeFile(spec, path, text, deps.parse);
    if (described.problems.length > 0) {
      const lines = described.problems.map((entry) => `${entry.field || "(file)"}: ${entry.message}`);
      return err(customizationError("customization.invalid", lines.join("\n"), { problems: described.problems }));
    }
    const written = deps.files.write(path, text);
    if (!written.ok) return written;
    return itemAt(list(spec.kind, scope), path);
  };

  return {
    list,
    create: (request, scope) => {
      const specs = specsFor(request.kind, scope);
      if (!specs.ok) return specs;
      const spec = specs.value.find((entry) => entry.id === request.locationId);
      if (spec === undefined) {
        return err(customizationError("customization.not_found", `no ${request.kind} location ${request.locationId} here`));
      }
      const path = newItemPath(spec, request.name);
      if (!path.ok) return path;
      const taken = takenPaths(spec, request.name).find((candidate) => deps.files.exists(candidate));
      if (taken !== undefined) {
        return err(customizationError("customization.already_exists", `${taken} already exists`));
      }
      return writeChecked(spec, path.value, request.text, scope);
    },
    save: (kind, path, text, scope) => {
      const found = findItem(kind, path, scope);
      return found.ok ? writeChecked(found.value.spec, path, text, scope) : found;
    },
    remove: (kind, path, scope) => {
      const found = findItem(kind, path, scope);
      if (!found.ok) return found;
      const writable = checkWritable(found.value.spec);
      return writable.ok ? deps.files.remove(path, found.value.spec.layout === "skill-folders") : writable;
    },
  };

  function findItem(kind: CustomizationKind, path: string, scope: CustomizationScope): Result<{ spec: LocationSpec }, CustomizationError> {
    const specs = specsFor(kind, scope);
    if (!specs.ok) return specs;
    const listed = listSpecs(specs.value);
    if (!listed.ok) return listed;
    const item = listed.value.items.find((entry) => entry.path === path);
    const spec = specs.value.find((entry) => entry.id === item?.locationId);
    if (item === undefined || spec === undefined) {
      return err(customizationError("customization.not_found", `no ${kind} file ${path} here`));
    }
    return ok({ spec });
  }
}

function checkWritable(spec: LocationSpec): Result<undefined, CustomizationError> {
  if (spec.lockedBy !== undefined) {
    return err(customizationError("customization.locked", `${spec.kind} files are locked by managed policy "${spec.lockedBy}"`, { lockedBy: spec.lockedBy }));
  }
  if (!spec.writable) {
    return err(customizationError("customization.read_only", `${spec.label} cannot be edited in Pica`));
  }
  return ok(undefined);
}

function newItemPath(spec: LocationSpec, name: string | undefined): Result<string, CustomizationError> {
  if (spec.singleFile) {
    return ok(spec.path);
  }
  if (name === undefined || !isValidItemName(name)) {
    const shown = name === undefined ? "" : ` "${name}"`;
    return err(customizationError("customization.invalid", `name${shown}: use letters, digits, ".", "_" and "-", starting with a letter or digit`, {
      problems: [{ field: "name", message: "use letters, digits, \".\", \"_\" and \"-\", starting with a letter or digit" }],
    }));
  }
  return ok(`${spec.path}/${name}${spec.newFileSuffix}`);
}

// An agent is its file name with or without `.agent`, so either file takes the name (C-02).
function takenPaths(spec: LocationSpec, name: string | undefined): string[] {
  if (spec.singleFile || name === undefined) return [spec.path];
  if (spec.layout === "agent-files") return [`${spec.path}/${name}.md`, `${spec.path}/${name}.agent.md`];
  if (spec.layout === "skill-folders") return [`${spec.path}/${name}`];
  return [`${spec.path}/${name}${spec.newFileSuffix}`];
}

function itemAt(listed: Result<CustomizationListing, CustomizationError>, path: string): Result<CustomizationItem, CustomizationError> {
  if (!listed.ok) return listed;
  const item = listed.value.items.find((entry) => entry.path === path);
  return item === undefined ? err(customizationError("customization.io_failed", `${path} was written but is not listed`)) : ok(item);
}
