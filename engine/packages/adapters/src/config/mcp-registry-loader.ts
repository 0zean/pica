import { readFileSync } from "node:fs";
import type { McpScope } from "@pica/protocol";
import { configError, err, resolveMcpServers } from "@pica/core";
import type {
  ConfigError,
  ConfigResult,
  ConfigWatch,
  McpLayerInput,
  McpRegistryLoader,
  ResolvedMcpRegistry,
  Result,
} from "@pica/core";
import { locateIssues, parseConfigFile } from "./jsonc.ts";
import type { ParsedConfigFile } from "./jsonc.ts";
import type { McpFileSource } from "./mcp-paths.ts";
import { watchFiles } from "./watch-files.ts";

// A file in any supported format, or Pica-format definitions held elsewhere (the store).
export type McpRegistrySource =
  | McpFileSource
  | { readonly scope: McpScope; readonly label: string; readonly value: unknown };

export class JsoncMcpRegistryLoader implements McpRegistryLoader {
  readonly #sources: readonly McpRegistrySource[];

  constructor(sources: readonly McpRegistrySource[]) {
    this.#sources = sources;
  }

  load(): ConfigResult<ResolvedMcpRegistry> {
    const inputs: McpLayerInput[] = [];
    const parsedFiles = new Map<string, ParsedConfigFile>();
    for (const source of this.#sources) {
      if (!("file" in source)) {
        inputs.push({ scope: source.scope, format: "pica", source: source.label, value: source.value });
        continue;
      }
      const parsed = readMcpFile(source.file);
      if (!parsed.ok) {
        return parsed;
      }
      if (parsed.value !== undefined) {
        parsedFiles.set(source.file, parsed.value);
        inputs.push(layerInput(source, parsed.value.value));
      }
    }
    const resolved = resolveMcpServers(inputs);
    if (resolved.ok) {
      return resolved;
    }
    const parsed = parsedFiles.get(resolved.error.file);
    return parsed === undefined ? resolved : err(locateIssues(resolved.error, parsed));
  }

  watch(onChange: (result: ConfigResult<ResolvedMcpRegistry>) => void): ConfigWatch {
    let last = JSON.stringify(this.load());
    const reload = (): void => {
      const result = this.load();
      const next = JSON.stringify(result);
      if (next !== last) {
        last = next;
        onChange(result);
      }
    };
    const files = this.#sources.flatMap((source) => ("file" in source ? [source.file] : []));
    return watchFiles(files, reload);
  }
}

function layerInput(source: McpFileSource, value: unknown): McpLayerInput {
  return {
    scope: source.scope,
    format: source.format,
    source: source.file,
    value,
    ...(source.root === undefined ? {} : { root: source.root }),
    ...(source.home === undefined ? {} : { home: source.home }),
  };
}

// A missing file is an absent source, not an error.
function readMcpFile(file: string): Result<ParsedConfigFile | undefined, ConfigError> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (thrown) {
    if (typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT") {
      return { ok: true, value: undefined };
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return err(configError("config.read_failed", file, [{ keyPath: "", message }]));
  }
  return parseConfigFile(file, text);
}
