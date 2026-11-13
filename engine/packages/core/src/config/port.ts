import type { Result } from "../result.ts";
import type { ConfigError } from "./errors.ts";
import type { ResolvedConfig } from "./resolve.ts";

export type ConfigResult<T> = Result<T, ConfigError>;

export interface ConfigWatch {
  close(): void;
}

export interface ConfigLoader {
  load(): ConfigResult<ResolvedConfig>;
  // Called with the reloaded configuration, or the error, each time a watched file changes.
  watch(onChange: (result: ConfigResult<ResolvedConfig>) => void): ConfigWatch;
}
