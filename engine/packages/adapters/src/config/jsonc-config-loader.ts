import { readFileSync } from "node:fs";
import { configError, err, resolveConfig } from "@pica/core";
import type {
  ConfigError,
  ConfigFileLayer,
  ConfigLayerInput,
  ConfigLoader,
  ConfigResult,
  ConfigWatch,
  ResolvedConfig,
  Result,
} from "@pica/core";
import { locateIssues, parseConfigFile } from "./jsonc.ts";
import type { ParsedConfigFile } from "./jsonc.ts";
import { watchFiles } from "./watch-files.ts";

// A layer read from a JSONC file, or one held elsewhere (workspace overrides live in the store).
export type ConfigSource =
  | { readonly layer: ConfigFileLayer; readonly file: string }
  | { readonly layer: ConfigFileLayer; readonly label: string; readonly value: unknown };

export class JsoncConfigLoader implements ConfigLoader {
  readonly #sources: readonly ConfigSource[];

  constructor(sources: readonly ConfigSource[]) {
    this.#sources = sources;
  }

  load(): ConfigResult<ResolvedConfig> {
    const inputs: ConfigLayerInput[] = [];
    const parsedFiles = new Map<string, ParsedConfigFile>();
    for (const source of this.#sources) {
      if (!("file" in source)) {
        inputs.push({ layer: source.layer, source: source.label, value: source.value });
        continue;
      }
      const parsed = readConfigFile(source.file);
      if (!parsed.ok) {
        return parsed;
      }
      if (parsed.value !== undefined) {
        parsedFiles.set(source.file, parsed.value);
        inputs.push({ layer: source.layer, source: source.file, value: parsed.value.value });
      }
    }
    const resolved = resolveConfig(inputs);
    if (resolved.ok) {
      return resolved;
    }
    const parsed = parsedFiles.get(resolved.error.file);
    return parsed === undefined ? resolved : err(locateIssues(resolved.error, parsed));
  }

  watch(onChange: (result: ConfigResult<ResolvedConfig>) => void): ConfigWatch {
    let last = fingerprint(this.load());
    const reload = (): void => {
      const result = this.load();
      const next = fingerprint(result);
      if (next !== last) {
        last = next;
        onChange(result);
      }
    };
    const files = this.#sources.flatMap((source) => ("file" in source ? [source.file] : []));
    return watchFiles(files, reload);
  }
}

// A missing file is an absent layer, not an error.
function readConfigFile(file: string): Result<ParsedConfigFile | undefined, ConfigError> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (thrown) {
    if (isMissing(thrown)) {
      return { ok: true, value: undefined };
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return err(configError("config.read_failed", file, [{ keyPath: "", message }]));
  }
  return parseConfigFile(file, text);
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT";
}

function fingerprint(result: ConfigResult<ResolvedConfig>): string {
  return JSON.stringify(result.ok ? [...result.value.values.entries()] : result.error);
}
