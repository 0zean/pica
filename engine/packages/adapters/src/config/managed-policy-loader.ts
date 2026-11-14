import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { compileManagedPolicy, configError, err, ok, ownershipProblem } from "@pica/core";
import type {
  ConfigError,
  FileOwnership,
  LoadedManagedPolicy,
  ManagedPolicySource,
  ManagedPolicyWarning,
  Result,
} from "@pica/core";
import { locateIssues, parseConfigFile } from "./jsonc.ts";

export interface ManagedPolicyCandidate {
  readonly format: "plist" | "jsonc";
  readonly path: string;
}

// File-system access, injectable so tests can fake root ownership.
export interface ManagedPolicyFileSystem {
  // Throws with code ENOENT when the path does not exist.
  realpath(path: string): string;
  ownership(path: string): FileOwnership;
  readText(path: string): string;
  // Returns the property list as JSON-compatible values.
  readPlist(path: string): unknown;
}

export const nodeManagedPolicyFileSystem: ManagedPolicyFileSystem = {
  realpath: (path) => realpathSync(path),
  ownership: (path) => {
    const stats = statSync(path);
    return { uid: stats.uid, mode: stats.mode };
  },
  readText: (path) => readFileSync(path, "utf8"),
  readPlist: (path) => {
    const json = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", path], { encoding: "utf8" });
    return JSON.parse(json) as unknown;
  },
};

// Reads the first trusted candidate. A candidate anyone but root could have written is skipped
// with a warning; later candidates that also exist are reported as shadowed.
export class ManagedPolicyLoader implements ManagedPolicySource {
  readonly #candidates: readonly ManagedPolicyCandidate[];
  readonly #fs: ManagedPolicyFileSystem;

  constructor(candidates: readonly ManagedPolicyCandidate[], fs: ManagedPolicyFileSystem = nodeManagedPolicyFileSystem) {
    this.#candidates = candidates;
    this.#fs = fs;
  }

  load(): Result<LoadedManagedPolicy, ConfigError> {
    const warnings: ManagedPolicyWarning[] = [];
    let chosen: ManagedPolicyCandidate | undefined;
    for (const candidate of this.#candidates) {
      const realPath = this.#realPath(candidate.path);
      if (!realPath.ok) {
        return realPath;
      }
      if (realPath.value === undefined) {
        continue;
      }
      if (chosen !== undefined) {
        warnings.push({ code: "managed_policy.shadowed", message: `ignoring managed policy ${candidate.path}: ${chosen.path} takes precedence` });
        continue;
      }
      const problem = this.#trustProblem(realPath.value);
      if (problem !== undefined) {
        warnings.push({ code: "managed_policy.untrusted_file", message: `ignoring managed policy ${candidate.path}: ${problem}` });
        continue;
      }
      chosen = { ...candidate, path: realPath.value };
    }
    if (chosen === undefined) {
      return ok({ policy: undefined, warnings });
    }
    const policy = this.#read(chosen);
    return policy.ok ? ok({ policy: policy.value, warnings }) : policy;
  }

  #realPath(path: string): Result<string | undefined, ConfigError> {
    try {
      return ok(this.#fs.realpath(path));
    } catch (thrown) {
      return isMissing(thrown) ? ok(undefined) : err(readFailed(path, thrown));
    }
  }

  // Root must own both the file and its directory, or another user could swap the file.
  #trustProblem(path: string): string | undefined {
    for (const checked of [path, dirname(path)]) {
      let ownership: FileOwnership;
      try {
        ownership = this.#fs.ownership(checked);
      } catch (thrown) {
        return thrown instanceof Error ? thrown.message : String(thrown);
      }
      const problem = ownershipProblem(checked, ownership);
      if (problem !== undefined) {
        return problem;
      }
    }
    return undefined;
  }

  #read(candidate: ManagedPolicyCandidate): ReturnType<typeof compileManagedPolicy> {
    if (candidate.format === "plist") {
      let value: unknown;
      try {
        value = this.#fs.readPlist(candidate.path);
      } catch (thrown) {
        return err(readFailed(candidate.path, thrown));
      }
      return compileManagedPolicy(candidate.path, value);
    }
    let text: string;
    try {
      text = this.#fs.readText(candidate.path);
    } catch (thrown) {
      return err(readFailed(candidate.path, thrown));
    }
    const parsed = parseConfigFile(candidate.path, text);
    if (!parsed.ok) {
      return parsed;
    }
    const compiled = compileManagedPolicy(candidate.path, parsed.value.value);
    return compiled.ok ? compiled : err(locateIssues(compiled.error, parsed.value));
  }
}

function readFailed(path: string, thrown: unknown): ConfigError {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return configError("config.read_failed", path, [{ keyPath: "", message }]);
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT";
}
